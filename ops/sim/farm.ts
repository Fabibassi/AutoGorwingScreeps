/**
 * Run N sims in parallel (separate mockup ports/dirs).
 * Usage:
 *   npx tsx ops/sim/farm.ts --workers 20 --ticks 80
 *   npx tsx ops/sim/farm.ts --scenario boot --workers 20
 *   npx tsx ops/sim/farm.ts --scenario softlock --workers 20 --concurrency 10
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
};

function parseArgs(argv: string[]) {
  let workers = 8;
  let ticks = 80;
  let basePort = 22100;
  let scenario = "softlock";
  /** Max simultaneous mockup processes (RAM/CPU throttle). 0 = all at once. */
  let concurrency = 0;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workers" && argv[i + 1]) workers = Number(argv[++i]);
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--scenario" && argv[i + 1]) scenario = argv[++i];
    else if (a === "--concurrency" && argv[i + 1]) concurrency = Number(argv[++i]);
    else if (a === "--quiet") quiet = true;
  }
  if (concurrency <= 0) concurrency = workers;
  return { workers, ticks, basePort, scenario, concurrency, quiet };
}

function runOne(
  script: string,
  instance: string,
  port: number,
  ticks: number,
  quiet: boolean,
): Promise<{ instance: string; code: number; ms: number; tail: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, script),
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
      ],
      {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      },
    );
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
  const { workers, ticks, basePort, scenario, concurrency, quiet } = parseArgs(
    process.argv.slice(2),
  );
  const script = SCENARIOS[scenario];
  if (!script) {
    console.error(
      `[farm] unknown scenario=${scenario}; known: ${Object.keys(SCENARIOS).join(", ")}`,
    );
    process.exit(2);
  }
  const t0 = Date.now();
  console.log(
    `[farm] scenario=${scenario} workers=${workers} concurrency=${concurrency} ticks=${ticks} basePort=${basePort}`,
  );
  const indices = Array.from({ length: workers }, (_, i) => i);
  const results = await mapPool(indices, concurrency, (i) =>
    runOne(script, `${scenario}-${i}`, basePort + i, ticks, quiet),
  );
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
