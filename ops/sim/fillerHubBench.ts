/**
 * Benchmark fillerPlan thin | fat | duo_fat on hub-ready RCL5.
 *
 * Usage:
 *   npx tsx ops/sim/fillerHubBench.ts --replicates 1 --ticks 20000 --concurrency 3
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
import { FILLER_PLANS } from "../../src/earlyGame/fillerPlan";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, ".sim-learn");
const LIVE_DIR = path.join(OUT_DIR, "live");
const STORAGE_FLOOR = 20_000;

type Live = { ok?: boolean; reason?: string; done?: boolean };

type RunRow = {
  plan: string;
  rep: number;
  instance: string;
  ok: boolean;
  starve: number | null;
  meanHub: number | null;
  minHub: number | null;
  minStorage: number | null;
  progress: number | null;
  reason: string;
  exitCode: number;
  ms: number;
};

function parseArgs(argv: string[]) {
  let replicates = 1;
  let ticks = 20_000;
  let basePort = 28_300;
  let concurrency = 3;
  let skipBuild = false;
  let plansCsv = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--replicates" && argv[i + 1]) replicates = Number(argv[++i]);
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--concurrency" && argv[i + 1]) concurrency = Number(argv[++i]);
    else if (a === "--plans" && argv[i + 1]) plansCsv = argv[++i];
    else if (a === "--skip-build") skipBuild = true;
  }
  return { replicates, ticks, basePort, concurrency, skipBuild, plansCsv };
}

function parseMetric(reason: string, key: string): number | null {
  const m = reason.match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?|null|-)`));
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
    path.join(OUT_DIR, "filler-hub-status.json"),
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
  plan: string,
): Promise<{ exitCode: number; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/fillerHub.ts"),
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
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
  writeStatus({ phase: "start", at: new Date().toISOString(), opts });

  if (!opts.skipBuild) {
    console.log("[filler-hub-bench] build…");
    await runBuild();
  }

  const plans = opts.plansCsv
    ? opts.plansCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : [...FILLER_PLANS];
  console.log(
    `[filler-hub-bench] plans=${plans.join(",")} replicates=${opts.replicates} ` +
      `ticks=${opts.ticks} concurrency=${opts.concurrency}`,
  );

  type Job = { plan: string; rep: number };
  const jobs: Job[] = [];
  for (const plan of plans) {
    for (let rep = 0; rep < opts.replicates; rep++) {
      jobs.push({ plan, rep });
    }
  }

  let done = 0;
  const rows = await mapPool(jobs, opts.concurrency, async (job, index) => {
    const instance = `fillerHub-${job.plan}.r${job.rep}`;
    const port = opts.basePort + index;
    console.log(`[filler-hub-bench] start ${instance} port=${port}`);
    const { exitCode, ms } = await runOne(
      instance,
      port,
      opts.ticks,
      job.plan,
    );
    const live = readLive(instance);
    const reason = live?.reason ?? `exit=${exitCode}`;
    const row: RunRow = {
      plan: job.plan,
      rep: job.rep,
      instance,
      ok: live?.ok === true,
      starve: parseMetric(reason, "starve"),
      meanHub: parseMetric(reason, "meanHub"),
      minHub: parseMetric(reason, "minHub"),
      minStorage: parseMetric(reason, "minStorage"),
      progress: parseMetric(reason, "p"),
      reason,
      exitCode,
      ms,
    };
    done++;
    writeStatus({
      phase: "running",
      done,
      total: jobs.length,
      last: row,
      at: new Date().toISOString(),
    });
    return row;
  });

  const ranking = plans
    .map((plan) => {
      const runs = rows.filter((r) => r.plan === plan);
      const floorOk = runs.every(
        (r) => r.minStorage == null || r.minStorage >= STORAGE_FLOOR,
      );
      return {
        plan,
        okCount: runs.filter((r) => r.ok).length,
        n: runs.length,
        floorOk,
        starveMedian: median(
          runs.filter((r) => r.starve != null).map((r) => r.starve as number),
        ),
        meanHubMedian: median(
          runs.filter((r) => r.meanHub != null).map((r) => r.meanHub as number),
        ),
        minHubMedian: median(
          runs.filter((r) => r.minHub != null).map((r) => r.minHub as number),
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
      const as = a.starveMedian ?? Number.POSITIVE_INFINITY;
      const bs = b.starveMedian ?? Number.POSITIVE_INFINITY;
      if (as !== bs) return as - bs;
      const ah = a.meanHubMedian ?? 0;
      const bh = b.meanHubMedian ?? 0;
      if (bh !== ah) return bh - ah;
      return (b.minHubMedian ?? 0) - (a.minHubMedian ?? 0);
    });

  const report = {
    at: new Date().toISOString(),
    ticks: opts.ticks,
    replicates: opts.replicates,
    ranking,
    winner: ranking[0]?.plan ?? null,
    note: "Hub filler size; primary starveTicks; gate minStorage≥20000.",
  };
  writeFileSync(
    path.join(OUT_DIR, "filler-hub-bench.json"),
    JSON.stringify(report, null, 2),
  );
  writeStatus({
    phase: "done",
    winner: report.winner,
    ranking: ranking.map((r) => ({
      plan: r.plan,
      starveMedian: r.starveMedian,
      meanHubMedian: r.meanHubMedian,
      minHubMedian: r.minHubMedian,
      floorOk: r.floorOk,
    })),
    at: report.at,
  });

  console.log("\n[filler-hub-bench] ranking (best first):");
  for (const r of ranking) {
    console.log(
      `  ${r.plan}: ok=${r.okCount}/${r.n} floorOk=${r.floorOk} ` +
        `starveMedian=${r.starveMedian ?? "-"} meanHub=${r.meanHubMedian ?? "-"} ` +
        `minHub=${r.minHubMedian ?? "-"}`,
    );
  }
  console.log(`[filler-hub-bench] winner=${report.winner}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
