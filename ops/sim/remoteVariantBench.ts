/**
 * Tune reserved_drop (mid) across remoteVariant knobs.
 *
 * Usage:
 *   npx tsx ops/sim/remoteVariantBench.ts --replicates 1 --ticks 12000 --concurrency 2
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
import { REMOTE_VARIANTS } from "../../src/earlyGame/remoteVariant";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, ".sim-learn");
const LIVE_DIR = path.join(OUT_DIR, "live");
const STORAGE_FLOOR = 20_000;
const PLAN = "reserved_drop";
const RANGE = "mid";

type Live = { ok?: boolean; reason?: string; done?: boolean };

type RunRow = {
  variant: string;
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
  let ticks = 12_000;
  let basePort = 28_600;
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
    path.join(OUT_DIR, "remote-variant-status.json"),
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
  variant: string,
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
        PLAN,
        "--haul-range",
        RANGE,
        "--variant",
        variant,
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
    console.log("[remote-variant-bench] build…");
    await runBuild();
  }

  type Job = {
    variant: string;
    rep: number;
    instance: string;
    port: number;
  };
  const jobs: Job[] = [];
  let port = opts.basePort;
  for (const variant of REMOTE_VARIANTS) {
    for (let rep = 0; rep < opts.replicates; rep++) {
      jobs.push({
        variant,
        rep,
        instance: `remoteVar-${variant}.r${rep}`,
        port: port++,
      });
    }
  }

  console.log(
    `[remote-variant-bench] plan=${PLAN} range=${RANGE} jobs=${jobs.length} ` +
      `ticks=${opts.ticks} concurrency=${opts.concurrency}`,
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
      `[remote-variant-bench] start ${job.instance} port=${job.port}`,
    );
    const { exitCode, ms } = await runOne(
      job.instance,
      job.port,
      opts.ticks,
      job.variant,
    );
    const live = readLive(job.instance);
    const reason = live?.reason ?? `exit=${exitCode}`;
    const row: RunRow = {
      variant: job.variant,
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

  const ranking = REMOTE_VARIANTS.map((variant) => {
    const runs = rows.filter((r) => r.variant === variant);
    const floorOk = runs.every(
      (r) => r.minStorage == null || r.minStorage >= STORAGE_FLOOR,
    );
    return {
      variant,
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
  }).sort((a, b) => {
    if (a.floorOk !== b.floorOk) return a.floorOk ? -1 : 1;
    const an = a.netPerTickMedian ?? Number.NEGATIVE_INFINITY;
    const bn = b.netPerTickMedian ?? Number.NEGATIVE_INFINITY;
    if (bn !== an) return bn - an;
    return (b.minStorageMedian ?? 0) - (a.minStorageMedian ?? 0);
  });

  const winner = ranking[0]?.variant ?? null;
  const report = {
    at: new Date().toISOString(),
    plan: PLAN,
    range: RANGE,
    ticks: opts.ticks,
    replicates: opts.replicates,
    ranking,
    winner,
    note: "reserved_drop mid tune; primary netPerTick; gate minStorage≥20000.",
  };
  writeFileSync(
    path.join(OUT_DIR, "remote-variant-bench.json"),
    JSON.stringify(report, null, 2),
  );
  writeStatus({
    phase: "done",
    winner: report.winner,
    ranking: ranking.map((r) => ({
      variant: r.variant,
      netPerTickMedian: r.netPerTickMedian,
      floorOk: r.floorOk,
    })),
    at: report.at,
  });

  console.log("\n[remote-variant-bench] ranking (best first):");
  for (const r of ranking) {
    console.log(
      `  ${r.variant}: ok=${r.okCount}/${r.n} floorOk=${r.floorOk} ` +
        `netPerTick=${r.netPerTickMedian ?? "-"} minStorage=${r.minStorageMedian ?? "-"}`,
    );
  }
  console.log(`[remote-variant-bench] winner=${report.winner}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
