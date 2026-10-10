/**
 * Benchmark post-hub RCL5 → RCL6 modes.
 *
 * Usage:
 *   npx tsx ops/sim/rcl5ToRcl6Bench.ts --replicates 2 --ticks 40000 --concurrency 2
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
import { RCL5_PLANS } from "../../src/earlyGame/rcl5Mode";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, ".sim-learn");
const LIVE_DIR = path.join(OUT_DIR, "live");
const STORAGE_FLOOR = 20_000;

type Live = {
  ok?: boolean;
  reason?: string;
  done?: boolean;
};

type RunRow = {
  mode: string;
  plan: string;
  key: string;
  rep: number;
  instance: string;
  ok: boolean;
  ticksRun: number;
  rcl6: number | null;
  eta: number | null;
  rate: number | null;
  progress: number | null;
  minStorage: number | null;
  reason: string;
  exitCode: number;
  ms: number;
};

function parseArgs(argv: string[]) {
  let replicates = 2;
  let ticks = 40_000;
  let basePort = 27_800;
  let concurrency = 2;
  let skipBuild = false;
  // Gameplan default: fat_first quotas × fat_first|link_boost plans.
  let modesCsv = "fat_first";
  let plansCsv = RCL5_PLANS.join(",");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--replicates" && argv[i + 1]) replicates = Number(argv[++i]);
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--concurrency" && argv[i + 1]) concurrency = Number(argv[++i]);
    else if (a === "--modes" && argv[i + 1]) modesCsv = argv[++i];
    else if (a === "--plans" && argv[i + 1]) plansCsv = argv[++i];
    else if (a === "--skip-build") skipBuild = true;
  }
  return {
    replicates,
    ticks,
    basePort,
    concurrency,
    skipBuild,
    modesCsv,
    plansCsv,
  };
}

function parseMetric(reason: string, key: string): number | null {
  const m = reason.match(new RegExp(`${key}[=@](-?\\d+(?:\\.\\d+)?|null|-)`));
  if (!m || m[1] === "-" || m[1] === "null") return null;
  return Number(m[1]);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
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

function writeStatus(payload: unknown): void {
  writeFileSync(
    path.join(OUT_DIR, "rcl5-to-rcl6-status.json"),
    JSON.stringify(payload, null, 2),
  );
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
  mode: string,
  plan: string,
): Promise<{ exitCode: number; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/rcl5ToRcl6.ts"),
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
        "--mode",
        mode,
        "--plan",
        plan,
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.on("close", (c) =>
      resolve({ exitCode: c ?? 1, ms: Date.now() - t0 }),
    );
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  writeStatus({
    phase: "start",
    wave: "mode-matrix",
    at: new Date().toISOString(),
    opts,
    deadlineHint: "48h wall-clock from campaign start",
  });

  if (!opts.skipBuild) {
    console.log("[rcl5-to-rcl6-bench] build…");
    await runBuild();
  }

  const modes = opts.modesCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const plans = opts.plansCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(
    `[rcl5-to-rcl6-bench] modes=${modes.join(",")} plans=${plans.join(",")} ` +
      `replicates=${opts.replicates} ticks=${opts.ticks} concurrency=${opts.concurrency}`,
  );

  type Job = { mode: string; plan: string; key: string; rep: number };
  const jobs: Job[] = [];
  for (const mode of modes) {
    for (const plan of plans) {
      const key = `${mode}+${plan}`;
      for (let rep = 0; rep < opts.replicates; rep++) {
        jobs.push({ mode, plan, key, rep });
      }
    }
  }

  let done = 0;
  const rows = await mapPool(jobs, opts.concurrency, async (job, index) => {
    const instance = `rcl5to6-${job.mode}-${job.plan}.r${job.rep}`;
    const port = opts.basePort + index;
    console.log(`[rcl5-to-rcl6-bench] start ${instance} port=${port}`);
    const { exitCode, ms } = await runOne(
      instance,
      port,
      opts.ticks,
      job.mode,
      job.plan,
    );
    const live = readLive(instance);
    const reason = live?.reason ?? `exit=${exitCode}`;
    const row: RunRow = {
      mode: job.mode,
      plan: job.plan,
      key: job.key,
      rep: job.rep,
      instance,
      ok: live?.ok === true || /rcl6@\d+/.test(reason),
      ticksRun: opts.ticks,
      rcl6: parseMetric(reason, "rcl6"),
      eta: parseMetric(reason, "eta"),
      rate: parseMetric(reason, "rate"),
      progress: parseMetric(reason, "p"),
      minStorage: parseMetric(reason, "minStorage"),
      reason,
      exitCode,
      ms,
    };
    done++;
    console.log(
      `[rcl5-to-rcl6-bench] ${done}/${jobs.length} ${instance} ok=${row.ok} ` +
        `rcl6=${row.rcl6 ?? "-"} rate=${row.rate ?? "-"} eta=${row.eta ?? "-"} ${ms}ms`,
    );
    writeStatus({
      phase: "running",
      wave: "gameplan",
      done,
      total: jobs.length,
      last: row,
      at: new Date().toISOString(),
    });
    writeFileSync(
      path.join(OUT_DIR, "rcl5-gameplan-status.json"),
      JSON.stringify(
        {
          phase: "sim-running",
          done,
          total: jobs.length,
          last: row,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return row;
  });

  const keys = [...new Set(jobs.map((j) => j.key))];
  const ranking = keys
    .map((key) => {
      const runs = rows.filter((r) => r.key === key);
      const floorOk = runs.every(
        (r) => r.minStorage == null || r.minStorage >= STORAGE_FLOOR,
      );
      return {
        key,
        mode: runs[0]?.mode ?? key,
        plan: runs[0]?.plan ?? "none",
        okCount: runs.filter((r) => r.ok).length,
        n: runs.length,
        floorOk,
        rcl6Median: median(
          runs.filter((r) => r.rcl6 != null).map((r) => r.rcl6 as number),
        ),
        etaMedian: median(
          runs.filter((r) => r.eta != null).map((r) => r.eta as number),
        ),
        rateMedian: median(
          runs.filter((r) => r.rate != null).map((r) => r.rate as number),
        ),
        progressMedian: median(
          runs
            .filter((r) => r.progress != null)
            .map((r) => r.progress as number),
        ),
        minStorageMedian: median(
          runs
            .filter((r) => r.minStorage != null)
            .map((r) => r.minStorage as number),
        ),
        runs,
      };
    })
    .sort((a, b) => {
      if (a.floorOk !== b.floorOk) return a.floorOk ? -1 : 1;
      if (a.rcl6Median != null && b.rcl6Median != null) {
        return a.rcl6Median - b.rcl6Median;
      }
      if (a.rcl6Median != null) return -1;
      if (b.rcl6Median != null) return 1;
      const ae = a.etaMedian ?? Number.POSITIVE_INFINITY;
      const be = b.etaMedian ?? Number.POSITIVE_INFINITY;
      if (ae !== be) return ae - be;
      const ar = a.rateMedian ?? 0;
      const br = b.rateMedian ?? 0;
      if (br !== ar) return br - ar;
      return (b.minStorageMedian ?? 0) - (a.minStorageMedian ?? 0);
    });

  const report = {
    at: new Date().toISOString(),
    ticks: opts.ticks,
    replicates: opts.replicates,
    ranking,
    winner: ranking[0]?.key ?? null,
    note:
      "Post-hub RCL5→RCL6; primary ticks_to_rcl6 / eta; gate minStorage≥20000; plans=fat_first|link_boost.",
  };
  writeFileSync(
    path.join(OUT_DIR, "rcl5-to-rcl6-bench.json"),
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    path.join(OUT_DIR, "rcl5-gameplan-bench.json"),
    JSON.stringify(report, null, 2),
  );
  writeStatus({
    phase: "done",
    wave: "gameplan",
    winner: report.winner,
    ranking: ranking.map((r) => ({
      key: r.key,
      mode: r.mode,
      plan: r.plan,
      rcl6Median: r.rcl6Median,
      etaMedian: r.etaMedian,
      rateMedian: r.rateMedian,
      floorOk: r.floorOk,
    })),
    at: report.at,
  });
  writeFileSync(
    path.join(OUT_DIR, "rcl5-gameplan-status.json"),
    JSON.stringify(
      {
        phase: "sim-done",
        winner: report.winner,
        ranking: ranking.map((r) => ({
          key: r.key,
          rcl6Median: r.rcl6Median,
          etaMedian: r.etaMedian,
          rateMedian: r.rateMedian,
          floorOk: r.floorOk,
          minStorageMedian: r.minStorageMedian,
        })),
        deliverable: "docs/superpowers/plans/2026-10-11-rcl5-gameplan.md",
        at: report.at,
      },
      null,
      2,
    ),
  );

  console.log("\n[rcl5-to-rcl6-bench] ranking (best first):");
  for (const r of ranking) {
    console.log(
      `  ${r.key}: ok=${r.okCount}/${r.n} floorOk=${r.floorOk} ` +
        `rcl6Median=${r.rcl6Median ?? "-"} etaMedian=${r.etaMedian ?? "-"} ` +
        `rateMedian=${r.rateMedian ?? "-"} minStorage=${r.minStorageMedian ?? "-"}`,
    );
  }
  console.log(`[rcl5-to-rcl6-bench] winner=${report.winner}`);
  console.log(`[rcl5-to-rcl6-bench] wrote .sim-learn/rcl5-to-rcl6-bench.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
