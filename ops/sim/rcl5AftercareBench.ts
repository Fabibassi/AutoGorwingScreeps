/**
 * Benchmark early RCL5 aftercare modes (live-like seed).
 *
 * Usage:
 *   npx tsx ops/sim/rcl5AftercareBench.ts --replicates 2 --ticks 20000 --concurrency 2
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
import { RCL5_MODES } from "../../src/earlyGame/rcl5Mode";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, ".sim-learn");
const LIVE_DIR = path.join(OUT_DIR, "live");

type Live = {
  ok?: boolean;
  reason?: string;
  done?: boolean;
};

type RunRow = {
  mode: string;
  rep: number;
  instance: string;
  ok: boolean;
  ticksRun: number;
  hub: number | null;
  tower2: number | null;
  ext30: number | null;
  gained: number | null;
  minStorage: number | null;
  reason: string;
  exitCode: number;
  ms: number;
};

function parseArgs(argv: string[]) {
  let replicates = 2;
  let ticks = 20_000;
  let basePort = 27_600;
  let concurrency = 2;
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
  mode: string,
): Promise<{ exitCode: number; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/rcl5Aftercare.ts"),
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
        "--mode",
        mode,
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
  writeFileSync(
    path.join(OUT_DIR, "rcl5-aftercare-status.json"),
    JSON.stringify({ phase: "start", at: new Date().toISOString(), opts }, null, 2),
  );

  if (!opts.skipBuild) {
    console.log("[rcl5-aftercare-bench] build…");
    await runBuild();
  }

  const modes = [...RCL5_MODES];
  console.log(
    `[rcl5-aftercare-bench] modes=${modes.join(",")} replicates=${opts.replicates} ` +
      `ticks=${opts.ticks} concurrency=${opts.concurrency}`,
  );

  type Job = { mode: string; rep: number };
  const jobs: Job[] = [];
  for (const mode of modes) {
    for (let rep = 0; rep < opts.replicates; rep++) {
      jobs.push({ mode, rep });
    }
  }

  let done = 0;
  const rows = await mapPool(jobs, opts.concurrency, async (job, index) => {
    const instance = `rcl5ac-${job.mode}.r${job.rep}`;
    const port = opts.basePort + index;
    console.log(`[rcl5-aftercare-bench] start ${instance} port=${port}`);
    const { exitCode, ms } = await runOne(
      instance,
      port,
      opts.ticks,
      job.mode,
    );
    const live = readLive(instance);
    const reason = live?.reason ?? `exit=${exitCode}`;
    const row: RunRow = {
      mode: job.mode,
      rep: job.rep,
      instance,
      ok: live?.ok === true || /hub@\d+/.test(reason),
      ticksRun: parseMetric(reason, "gained") != null ? opts.ticks : opts.ticks,
      hub: parseMetric(reason, "hub"),
      tower2: parseMetric(reason, "tower2"),
      ext30: parseMetric(reason, "ext30"),
      gained: parseMetric(reason, "gained"),
      minStorage: parseMetric(reason, "minStorage"),
      reason,
      exitCode,
      ms,
    };
    done++;
    console.log(
      `[rcl5-aftercare-bench] ${done}/${jobs.length} ${instance} ok=${row.ok} ` +
        `hub=${row.hub} tower2=${row.tower2} ext30=${row.ext30} ${ms}ms`,
    );
    writeFileSync(
      path.join(OUT_DIR, "rcl5-aftercare-status.json"),
      JSON.stringify(
        { phase: "running", done, total: jobs.length, last: row, at: new Date().toISOString() },
        null,
        2,
      ),
    );
    return row;
  });

  const ranking = modes
    .map((mode) => {
      const runs = rows.filter((r) => r.mode === mode);
      const hubs = runs
        .filter((r) => r.hub != null)
        .map((r) => r.hub as number);
      const gained = runs
        .filter((r) => r.gained != null)
        .map((r) => r.gained as number);
      return {
        mode,
        okCount: runs.filter((r) => r.ok).length,
        n: runs.length,
        hubMedian: median(hubs),
        tower2Median: median(
          runs.filter((r) => r.tower2 != null).map((r) => r.tower2 as number),
        ),
        ext30Median: median(
          runs.filter((r) => r.ext30 != null).map((r) => r.ext30 as number),
        ),
        gainedMedian: median(gained),
        minStorageMedian: median(
          runs
            .filter((r) => r.minStorage != null)
            .map((r) => r.minStorage as number),
        ),
        runs,
      };
    })
    .sort((a, b) => {
      // Prefer earlier hub-ready; else more progress; else higher storage floor.
      if (a.hubMedian != null && b.hubMedian != null) {
        return a.hubMedian - b.hubMedian;
      }
      if (a.hubMedian != null) return -1;
      if (b.hubMedian != null) return 1;
      const ag = a.gainedMedian ?? 0;
      const bg = b.gainedMedian ?? 0;
      if (bg !== ag) return bg - ag;
      return (b.minStorageMedian ?? 0) - (a.minStorageMedian ?? 0);
    });

  const report = {
    at: new Date().toISOString(),
    ticks: opts.ticks,
    replicates: opts.replicates,
    ranking,
    winner: ranking[0]?.mode ?? null,
    note: "Early RCL5 aftercare (~48h window); hub-ready = towers≥2 && extensions≥30.",
  };
  writeFileSync(
    path.join(OUT_DIR, "rcl5-aftercare-bench.json"),
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    path.join(OUT_DIR, "rcl5-aftercare-status.json"),
    JSON.stringify({ phase: "done", winner: report.winner, at: report.at }, null, 2),
  );

  console.log("\n[rcl5-aftercare-bench] ranking (best first):");
  for (const r of ranking) {
    console.log(
      `  ${r.mode}: ok=${r.okCount}/${r.n} hubMedian=${r.hubMedian ?? "-"} ` +
        `tower2=${r.tower2Median ?? "-"} ext30=${r.ext30Median ?? "-"} ` +
        `gainedMedian=${r.gainedMedian ?? "-"}`,
    );
  }
  console.log(`[rcl5-aftercare-bench] winner=${report.winner}`);
  console.log(`[rcl5-aftercare-bench] wrote .sim-learn/rcl5-aftercare-bench.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
