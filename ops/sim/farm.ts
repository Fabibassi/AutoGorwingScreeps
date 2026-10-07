/**
 * Run N sims in parallel (separate mockup ports/dirs).
 * Usage:
 *   npx tsx ops/sim/farm.ts --workers 20 --ticks 80
 *   npx tsx ops/sim/farm.ts --scenario boot --workers 20
 *   npx tsx ops/sim/farm.ts --scenario softlock --workers 20 --concurrency 10
 *   npx tsx ops/sim/farm.ts --scenario real --road-policies parallel,source_first
 *   npx tsx ops/sim/farm.ts --scenario real --ab-knob extensionBootstrap --ab-variants 0,2,5
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SCENARIOS: Record<string, string> = {
  softlock: "ops/sim/softLock.ts",
  boot: "ops/sim/boot.ts",
  economy: "ops/sim/economy.ts",
  surround: "ops/sim/surround.ts",
  miners: "ops/sim/miners.ts",
  containers: "ops/sim/containers.ts",
  real: "ops/sim/realClimb.ts",
};

function parseArgs(argv: string[]) {
  let workers = 8;
  let ticks = 80;
  let basePort = 22100;
  let scenario = "softlock";
  /** Max simultaneous mockup processes (RAM/CPU throttle). 0 = all at once. */
  let concurrency = 0;
  let quiet = false;
  /** Comma-separated road policies; worker i gets policies[i % len]. */
  let roadPolicies = "";
  let abKnob = "";
  let abVariants = "";
  let profile = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workers" && argv[i + 1]) workers = Number(argv[++i]);
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--scenario" && argv[i + 1]) scenario = argv[++i];
    else if (a === "--concurrency" && argv[i + 1]) concurrency = Number(argv[++i]);
    else if (a === "--road-policies" && argv[i + 1]) roadPolicies = argv[++i];
    else if (a === "--ab-knob" && argv[i + 1]) abKnob = argv[++i];
    else if (a === "--ab-variants" && argv[i + 1]) abVariants = argv[++i];
    else if (a === "--profile" && argv[i + 1]) profile = argv[++i];
    else if (a === "--quiet") quiet = true;
  }
  const policies = roadPolicies
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const variants = abVariants
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // When A/B variants are set, default workers to variant count unless overridden.
  if (variants.length > 0 && !argv.includes("--workers")) {
    workers = variants.length;
  }
  if (concurrency <= 0) concurrency = workers;
  return {
    workers,
    ticks,
    basePort,
    scenario,
    concurrency,
    quiet,
    policies,
    abKnob,
    variants,
    profile,
  };
}

function runOne(
  script: string,
  instance: string,
  port: number,
  ticks: number,
  quiet: boolean,
  opts: {
    roadPolicy?: string;
    abKnob?: string;
    abVariant?: string;
    profile?: string;
  },
): Promise<{ instance: string; code: number; ms: number; tail: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const args = [
      "--import",
      "tsx",
      path.join(ROOT, script),
      "--instance",
      instance,
      "--port",
      String(port),
      "--ticks",
      String(ticks),
    ];
    if (opts.roadPolicy) {
      args.push("--road-policy", opts.roadPolicy);
    }
    if (opts.abKnob) {
      args.push("--ab-knob", opts.abKnob);
    }
    if (opts.abVariant != null && opts.abVariant !== "") {
      args.push("--ab-variant", opts.abVariant);
    }
    if (opts.profile) {
      args.push("--profile", opts.profile);
    }
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let out = "";
    child.stdout?.on("data", (b) => {
      out += String(b);
    });
    child.stderr?.on("data", (b) => {
      out += String(b);
    });
    child.on("close", (code) => {
      const ms = Date.now() - started;
      const tail = out.slice(-1500);
      if (!quiet) {
        console.log(`\n===== ${instance} exit=${code} ${ms}ms =====\n${tail}`);
      } else {
        const okLine = out.match(/"ok":\s*(true|false)/)?.[0] ?? "";
        const reason = out.match(/"reason":\s*"([^"]*)"/)?.[1] ?? "";
        console.log(
          `[farm] ${instance} exit=${code} ${ms}ms ${okLine} ${reason}`.trim(),
        );
      }
      resolve({ instance, code: code ?? 1, ms, tail });
    });
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function main() {
  const {
    workers,
    ticks,
    basePort,
    scenario,
    concurrency,
    quiet,
    policies,
    abKnob,
    variants,
    profile,
  } = parseArgs(process.argv.slice(2));
  const script = SCENARIOS[scenario];
  if (!script) {
    console.error(
      `[farm] unknown scenario=${scenario}; known: ${Object.keys(SCENARIOS).join(", ")}`,
    );
    process.exit(2);
  }
  const t0 = Date.now();
  console.log(
    `[farm] scenario=${scenario} workers=${workers} concurrency=${concurrency} ticks=${ticks} basePort=${basePort}` +
      (policies.length ? ` policies=${policies.join("|")}` : "") +
      (abKnob ? ` ab=${abKnob}[${variants.join("|")}]` : "") +
      (profile ? ` profile=${profile}` : ""),
  );
  const indices = Array.from({ length: workers }, (_, i) => i);
  const results = await mapPool(indices, concurrency, (i) => {
    const roadPolicy = policies.length ? policies[i % policies.length] : undefined;
    const abVariant = variants.length ? variants[i % variants.length] : undefined;
    // Prefer profile over roadPolicy so baseline/optimized compares don't collide as real-parallel.
    const label = abKnob && abVariant != null
      ? `${abKnob}.${abVariant}`
      : profile
        ? profile
        : roadPolicy
          ? roadPolicy
          : String(i);
    // Unique instance dirs when several workers share the same variant label.
    const name =
      workers > Math.max(1, variants.length || policies.length || 1)
        ? `${scenario}-${label}-w${i}`
        : `${scenario}-${label}`;
    return runOne(script, name, basePort + i, ticks, quiet, {
      roadPolicy: roadPolicy ?? "parallel",
      abKnob: abKnob || undefined,
      abVariant,
      profile: profile || undefined,
    });
  });
  const failed = results.filter((r) => r.code !== 0).length;
  const ok = workers - failed;
  const ms = Date.now() - t0;
  const avg =
    results.reduce((s, r) => s + r.ms, 0) / Math.max(1, results.length);
  console.log(
    `[farm] done ok=${ok} fail=${failed} wall=${ms}ms avgWorker=${Math.round(avg)}ms`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
