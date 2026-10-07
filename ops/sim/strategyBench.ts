/**
 * Benchmark bootstrapStrategy variants with N replicates each.
 *
 * Default: 9 strategies × 6 runs = 54 (1 control + 4B + 4C).
 *
 * Usage:
 *   npx tsx ops/sim/strategyBench.ts
 *   npx tsx ops/sim/strategyBench.ts --replicates 6 --ticks 50000 --concurrency 3
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOTSTRAP_STRATEGIES } from "../../src/earlyGame/experimentPolicy";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, ".sim-learn");
const LIVE_DIR = path.join(OUT_DIR, "live");
const KNOB = "bootstrapStrategy";

type Live = {
  ok?: boolean;
  reason?: string;
  tick?: number;
  done?: boolean;
};

type RunRow = {
  variant: string;
  rep: number;
  instance: string;
  ok: boolean;
  ticksRun: number;
  c2: number | null;
  firstRoad: number | null;
  rcl3: number | null;
  reason: string;
  exitCode: number;
  ms: number;
};

type VariantAgg = {
  variant: string;
  family: "control" | "B" | "C";
  n: number;
  okCount: number;
  rcl3Median: number | null;
  rcl3Mean: number | null;
  c2Median: number | null;
  firstRoadMedian: number | null;
  runs: RunRow[];
};

function parseArgs(argv: string[]) {
  let replicates = 6;
  let ticks = 50_000;
  let basePort = 26_000;
  let concurrency = 3;
  let skipBuild = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--replicates" && argv[i + 1]) replicates = Number(argv[++i]);
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--concurrency" && argv[i + 1]) concurrency = Number(argv[++i]);
    else if (a === "--skip-build") skipBuild = true;
  }
  return { replicates, ticks, basePort, concurrency, skipBuild };
}

function familyOf(variant: string): "control" | "B" | "C" {
  if (variant === "control") return "control";
  if (variant.startsWith("b_")) return "B";
  return "C";
}

function parseMetric(reason: string, key: string): number | null {
  const m = reason.match(new RegExp(`${key}[=@](-?\\d+|null|-)`));
  if (!m || m[1] === "-" || m[1] === "null") return null;
  return Number(m[1]);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function readLive(instance: string): Live | null {
  const p = path.join(LIVE_DIR, `${instance}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Live;
  } catch {
    return null;
  }
}

function runBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(ROOT, "ops/buildModules.ts")],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.on("close", (c) =>
      c === 0 ? resolve() : reject(new Error(`build exit ${c}`)),
    );
  });
}

function runOne(
  instance: string,
  port: number,
  ticks: number,
  variant: string,
): Promise<{ code: number; ms: number; out: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/realClimb.ts"),
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
        "--road-policy",
        "parallel",
        "--ab-knob",
        KNOB,
        "--ab-variant",
        variant,
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
    );
    let out = "";
    child.stdout?.on("data", (b) => {
      out += String(b);
    });
    child.stderr?.on("data", (b) => {
      out += String(b);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, ms: Date.now() - started, out });
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

function writeStatus(payload: unknown) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, "strategy-bench-status.json"),
    JSON.stringify(payload, null, 2),
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const variants = [...BOOTSTRAP_STRATEGIES];
  const jobs = variants.flatMap((variant) =>
    Array.from({ length: opts.replicates }, (_, rep) => ({ variant, rep })),
  );

  mkdirSync(LIVE_DIR, { recursive: true });
  if (!opts.skipBuild) {
    console.log("[strategy-bench] build…");
    await runBuild();
  }

  console.log(
    `[strategy-bench] variants=${variants.length} replicates=${opts.replicates} ` +
      `total=${jobs.length} ticks=${opts.ticks} concurrency=${opts.concurrency}`,
  );
  writeStatus({
    at: new Date().toISOString(),
    phase: "running",
    total: jobs.length,
    done: 0,
    variants,
    replicates: opts.replicates,
  });

  const t0 = Date.now();
  let done = 0;
  const rows = await mapPool(jobs, opts.concurrency, async (job, i) => {
    const instance = `real-${KNOB}.${job.variant}.r${job.rep}`;
    const port = opts.basePort + i;
    console.log(`[strategy-bench] start ${instance} port=${port}`);
    const { code, ms, out } = await runOne(
      instance,
      port,
      opts.ticks,
      job.variant,
    );
    const live = readLive(instance);
    const reason =
      live?.reason ??
      out.match(/"reason":\s*"([^"]*)"/)?.[1] ??
      "";
    const row: RunRow = {
      variant: job.variant,
      rep: job.rep,
      instance,
      ok: live?.ok === true,
      ticksRun: live?.tick ?? opts.ticks,
      c2: parseMetric(reason, "c2"),
      firstRoad: parseMetric(reason, "firstRoad") ?? parseMetric(reason, "road"),
      rcl3: parseMetric(reason, "rcl3"),
      reason,
      exitCode: code,
      ms,
    };
    done += 1;
    console.log(
      `[strategy-bench] ${done}/${jobs.length} ${instance} ok=${row.ok} rcl3=${row.rcl3} ${ms}ms`,
    );
    writeStatus({
      at: new Date().toISOString(),
      phase: "running",
      total: jobs.length,
      done,
      last: row,
      wallMs: Date.now() - t0,
    });
    return row;
  });

  const byVariant: VariantAgg[] = variants.map((variant) => {
    const runs = rows.filter((r) => r.variant === variant);
    const rcl3s = runs
      .filter((r) => r.ok && r.rcl3 != null)
      .map((r) => r.rcl3 as number);
    const c2s = runs
      .filter((r) => r.c2 != null)
      .map((r) => r.c2 as number);
    const roads = runs
      .filter((r) => r.firstRoad != null)
      .map((r) => r.firstRoad as number);
    return {
      variant,
      family: familyOf(variant),
      n: runs.length,
      okCount: runs.filter((r) => r.ok).length,
      rcl3Median: median(rcl3s),
      rcl3Mean: mean(rcl3s),
      c2Median: median(c2s),
      firstRoadMedian: median(roads),
      runs,
    };
  });

  byVariant.sort((a, b) => {
    const aa = a.rcl3Median ?? 1e9;
    const bb = b.rcl3Median ?? 1e9;
    if (aa !== bb) return aa - bb;
    return b.okCount - a.okCount;
  });

  const winner = byVariant.find((v) => v.rcl3Median != null) ?? null;
  const report = {
    at: new Date().toISOString(),
    ticks: opts.ticks,
    replicates: opts.replicates,
    concurrency: opts.concurrency,
    totalRuns: rows.length,
    wallMs: Date.now() - t0,
    winner: winner?.variant ?? null,
    note: winner
      ? `winner=${winner.variant} by median rcl3@ among OK runs`
      : "no OK winner",
    ranking: byVariant.map((v) => ({
      variant: v.variant,
      family: v.family,
      okCount: v.okCount,
      n: v.n,
      rcl3Median: v.rcl3Median,
      rcl3Mean: v.rcl3Mean,
      c2Median: v.c2Median,
      firstRoadMedian: v.firstRoadMedian,
    })),
    byVariant,
  };

  const outFile = path.join(OUT_DIR, "strategy-bench.json");
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  writeStatus({
    at: new Date().toISOString(),
    phase: "done",
    total: jobs.length,
    done: jobs.length,
    winner: report.winner,
    outFile,
    wallMs: report.wallMs,
  });

  console.log("\n[strategy-bench] ranking (median rcl3@):");
  for (const v of byVariant) {
    console.log(
      `  ${v.family.padEnd(7)} ${v.variant.padEnd(12)} ok=${v.okCount}/${v.n} ` +
        `rcl3Med=${v.rcl3Median ?? "-"} c2Med=${v.c2Median ?? "-"}`,
    );
  }
  console.log(`[strategy-bench] wrote ${outFile} winner=${report.winner}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
