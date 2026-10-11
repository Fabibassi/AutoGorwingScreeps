/**
 * Benchmark remotePlan arms × haul ranges on post-RCL6 seed.
 *
 * Usage:
 *   npx tsx ops/sim/remoteIncomeBench.ts --replicates 1 --ticks 15000 --concurrency 2
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, ".sim-learn");
const LIVE_DIR = path.join(OUT_DIR, "live");
const STORAGE_FLOOR = 20_000;

const PLANS = [
  "off",
  "drop_unreserved",
  "reserved_drop",
  "reserved_container",
] as const;
const RANGES = ["short", "mid"] as const;

type Live = { ok?: boolean; reason?: string; done?: boolean };

type RunRow = {
  plan: string;
  range: string;
  key: string;
  rep: number;
  instance: string;
  ok: boolean;
  netDelta: number | null;
  netPerTick: number | null;
  minStorage: number | null;
  reason: string;
  exitCode: number;
  ms: number;
};

function parseArgs(argv: string[]) {
  let replicates = 1;
  let ticks = 15_000;
  let basePort = 28_500;
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
    path.join(OUT_DIR, "remote-income-status.json"),
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
  range: string,
): Promise<{ exitCode: number; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/remoteIncome.ts"),
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
        "--plan",
        plan,
        "--haul-range",
        range,
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
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return out;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(LIVE_DIR, { recursive: true });
  if (!opts.skipBuild) {
    console.log("[remote-income-bench] build…");
    await runBuild();
  }

  type Job = {
    plan: string;
    range: string;
    key: string;
    rep: number;
    instance: string;
    port: number;
  };
  const jobs: Job[] = [];
  let port = opts.basePort;
  for (const plan of PLANS) {
    for (const range of RANGES) {
      for (let rep = 0; rep < opts.replicates; rep++) {
        const key = `${plan}.${range}`;
        jobs.push({
          plan,
          range,
          key,
          rep,
          instance: `remoteIncome-${plan}-${range}.r${rep}`,
          port: port++,
        });
      }
    }
  }

  console.log(
    `[remote-income-bench] jobs=${jobs.length} ticks=${opts.ticks} concurrency=${opts.concurrency}`,
  );
  writeStatus({
    phase: "start",
    at: new Date().toISOString(),
    opts,
    total: jobs.length,
  });

  let done = 0;
  const rows = await mapPool(jobs, opts.concurrency, async (job) => {
    console.log(
      `[remote-income-bench] start ${job.instance} port=${job.port}`,
    );
    const { exitCode, ms } = await runOne(
      job.instance,
      job.port,
      opts.ticks,
      job.plan,
      job.range,
    );
    const live = readLive(job.instance);
    const reason = live?.reason ?? `exit=${exitCode}`;
    const row: RunRow = {
      plan: job.plan,
      range: job.range,
      key: job.key,
      rep: job.rep,
      instance: job.instance,
      ok: live?.ok === true || exitCode === 0,
      netDelta: parseMetric(reason, "netDelta"),
      netPerTick: parseMetric(reason, "netPerTick"),
      minStorage: parseMetric(reason, "minStorage"),
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

  const keys = [...new Set(rows.map((r) => r.key))];
  const ranking = keys
    .map((key) => {
      const runs = rows.filter((r) => r.key === key);
      const floorOk = runs.every(
        (r) => r.minStorage == null || r.minStorage >= STORAGE_FLOOR,
      );
      return {
        key,
        plan: runs[0]?.plan ?? key,
        range: runs[0]?.range ?? "",
        okCount: runs.filter((r) => r.ok).length,
        n: runs.length,
        floorOk,
        netPerTickMedian: median(
          runs
            .filter((r) => r.netPerTick != null)
            .map((r) => r.netPerTick as number),
        ),
        netDeltaMedian: median(
          runs.filter((r) => r.netDelta != null).map((r) => r.netDelta as number),
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
      const an = a.netPerTickMedian ?? Number.NEGATIVE_INFINITY;
      const bn = b.netPerTickMedian ?? Number.NEGATIVE_INFINITY;
      if (bn !== an) return bn - an;
      return (b.minStorageMedian ?? 0) - (a.minStorageMedian ?? 0);
    });

  const winner = ranking[0] ?? null;
  const report = {
    at: new Date().toISOString(),
    ticks: opts.ticks,
    replicates: opts.replicates,
    ranking,
    winner: winner?.key ?? null,
    winnerPlan: winner?.plan ?? null,
    winnerRange: winner?.range ?? null,
    note: "Post-RCL6 remote income; primary netPerTick; gate minStorage≥20000.",
  };
  writeFileSync(
    path.join(OUT_DIR, "remote-income-bench.json"),
    JSON.stringify(report, null, 2),
  );
  writeStatus({
    phase: "done",
    winner: report.winner,
    ranking: ranking.map((r) => ({
      key: r.key,
      netPerTickMedian: r.netPerTickMedian,
      floorOk: r.floorOk,
    })),
    at: report.at,
  });

  console.log("\n[remote-income-bench] ranking (best first):");
  for (const r of ranking) {
    console.log(
      `  ${r.key}: ok=${r.okCount}/${r.n} floorOk=${r.floorOk} ` +
        `netPerTick=${r.netPerTickMedian ?? "-"} minStorage=${r.minStorageMedian ?? "-"}`,
    );
  }
  console.log(`[remote-income-bench] winner=${report.winner}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
