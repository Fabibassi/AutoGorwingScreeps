/**
 * Benchmark RCL4→5 home spend modes (no remotes).
 *
 * Usage:
 *   npx tsx ops/sim/rcl5Bench.ts --replicates 2 --ticks 20000 --concurrency 2
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
  tick?: number;
  done?: boolean;
  rcl?: number;
  progress?: number;
};

type RunRow = {
  mode: string;
  rep: number;
  instance: string;
  ok: boolean;
  ticksRun: number;
  rcl5: number | null;
  gained: number | null;
  reason: string;
  exitCode: number;
  ms: number;
};

function parseArgs(argv: string[]) {
  let replicates = 2;
  let ticks = 20_000;
  let basePort = 27_400;
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
): Promise<{ code: number; ms: number; out: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/rcl5Climb.ts"),
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
        "--mode",
        mode,
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
    path.join(OUT_DIR, "rcl5-bench-status.json"),
    JSON.stringify(payload, null, 2),
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const modes = [...RCL5_MODES];
  const jobs = modes.flatMap((mode) =>
    Array.from({ length: opts.replicates }, (_, rep) => ({ mode, rep })),
  );

  mkdirSync(LIVE_DIR, { recursive: true });
  if (!opts.skipBuild) {
    console.log("[rcl5-bench] build…");
    await runBuild();
  }

  console.log(
    `[rcl5-bench] modes=${modes.join(",")} replicates=${opts.replicates} ` +
      `total=${jobs.length} ticks=${opts.ticks} concurrency=${opts.concurrency}`,
  );
  writeStatus({
    at: new Date().toISOString(),
    phase: "running",
    total: jobs.length,
    done: 0,
    modes,
  });

  const t0 = Date.now();
  let done = 0;
  const rows = await mapPool(jobs, opts.concurrency, async (job, i) => {
    const instance = `rcl5-${job.mode}.r${job.rep}`;
    const port = opts.basePort + i;
    console.log(`[rcl5-bench] start ${instance} port=${port}`);
    const { code, ms, out } = await runOne(
      instance,
      port,
      opts.ticks,
      job.mode,
    );
    const live = readLive(instance);
    const reason =
      live?.reason ??
      out.match(/"reason":\s*"([^"]*)"/)?.[1] ??
      "";
    const row: RunRow = {
      mode: job.mode,
      rep: job.rep,
      instance,
      ok: live?.ok === true || /rcl5@\d+/.test(reason),
      ticksRun: live?.tick ?? opts.ticks,
      rcl5: parseMetric(reason, "rcl5"),
      gained: parseMetric(reason, "gained"),
      reason,
      exitCode: code,
      ms,
    };
    done += 1;
    console.log(
      `[rcl5-bench] ${done}/${jobs.length} ${instance} ok=${row.ok} rcl5=${row.rcl5} gained=${row.gained} ${ms}ms`,
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

  const ranking = modes
    .map((mode) => {
      const runs = rows.filter((r) => r.mode === mode);
      const rcl5s = runs
        .filter((r) => r.rcl5 != null)
        .map((r) => r.rcl5 as number);
      const gains = runs
        .filter((r) => r.gained != null)
        .map((r) => r.gained as number);
      return {
        mode,
        okCount: runs.filter((r) => r.ok).length,
        n: runs.length,
        rcl5Median: median(rcl5s),
        gainedMedian: median(gains),
        runs,
      };
    })
    .sort((a, b) => {
      // Prefer modes that hit RCL5 sooner; else higher progress gained.
      if (a.rcl5Median != null && b.rcl5Median != null) {
        return a.rcl5Median - b.rcl5Median;
      }
      if (a.rcl5Median != null) return -1;
      if (b.rcl5Median != null) return 1;
      return (b.gainedMedian ?? 0) - (a.gainedMedian ?? 0);
    });

  const report = {
    at: new Date().toISOString(),
    ticks: opts.ticks,
    replicates: opts.replicates,
    ranking,
    winner: ranking[0]?.mode ?? null,
    note: "Home-only RCL4→5; remotes deferred until hub climb is stable.",
  };
  writeFileSync(
    path.join(OUT_DIR, "rcl5-bench.json"),
    JSON.stringify(report, null, 2),
  );
  writeStatus({ ...report, phase: "done", done: jobs.length });

  console.log("\n[rcl5-bench] ranking (best first):");
  for (const r of ranking) {
    console.log(
      `  ${r.mode}: ok=${r.okCount}/${r.n} rcl5Median=${r.rcl5Median ?? "-"} gainedMedian=${r.gainedMedian ?? "-"}`,
    );
  }
  console.log(`[rcl5-bench] winner=${report.winner}`);
  console.log(`[rcl5-bench] wrote .sim-learn/rcl5-bench.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
