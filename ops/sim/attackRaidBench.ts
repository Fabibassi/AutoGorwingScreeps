/**
 * Benchmark RCL3–6 × probe|drain|smash|swarm attack-raid matrix.
 *
 * Usage:
 *   npx tsx ops/sim/attackRaidBench.ts --ticks 1400 --concurrency 2 --base-port 28800
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
import { RCL_LEVELS, THREAT_IDS } from "./raidThreats";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, ".sim-learn");
const LIVE_DIR = path.join(OUT_DIR, "live");

type Live = {
  ok?: boolean;
  reason?: string;
  done?: boolean;
};

type RunRow = {
  key: string;
  rcl: number;
  threat: string;
  expectedPass: boolean;
  ok: boolean;
  matchExpectation: boolean;
  reason: string;
  exitCode: number;
  ms: number;
};

function parseArgs(argv: string[]) {
  let ticks = 1_400;
  let basePort = 28_800;
  let concurrency = 2;
  let skipBuild = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--concurrency" && argv[i + 1]) {
      concurrency = Number(argv[++i]);
    } else if (a === "--skip-build") skipBuild = true;
  }
  return { ticks, basePort, concurrency, skipBuild };
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
    path.join(OUT_DIR, "attack-raid-status.json"),
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
  rcl: number,
  threat: string,
): Promise<{ exitCode: number; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/attackRaid.ts"),
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
        "--rcl",
        String(rcl),
        "--threat",
        threat,
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
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      worker(),
    ),
  );
  return out;
}

function parseFlag(reason: string, key: string): boolean | null {
  const m = reason.match(new RegExp(`${key}=(\\d)`));
  if (!m) return null;
  return m[1] === "1";
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(LIVE_DIR, { recursive: true });
  if (!opts.skipBuild) {
    console.log("[attack-raid-bench] build…");
    await runBuild();
  }

  type Job = {
    rcl: number;
    threat: string;
    key: string;
    instance: string;
    port: number;
  };
  const jobs: Job[] = [];
  let port = opts.basePort;
  for (const rcl of RCL_LEVELS) {
    for (const threat of THREAT_IDS) {
      jobs.push({
        rcl,
        threat,
        key: `rcl${rcl}.${threat}`,
        instance: `attackRaid-rcl${rcl}-${threat}`,
        port: port++,
      });
    }
  }

  console.log(
    `[attack-raid-bench] jobs=${jobs.length} ticks=${opts.ticks} concurrency=${opts.concurrency}`,
  );
  writeStatus({
    phase: "start",
    at: new Date().toISOString(),
    opts,
    total: jobs.length,
  });

  let done = 0;
  const rows = await mapPool(jobs, opts.concurrency, async (job) => {
    console.log(`[attack-raid-bench] start ${job.instance} port=${job.port}`);
    const { exitCode, ms } = await runOne(
      job.instance,
      job.port,
      opts.ticks,
      job.rcl,
      job.threat,
    );
    const live = readLive(job.instance);
    const reason = live?.reason ?? `exit=${exitCode}`;
    const ok = Boolean(live?.ok);
    // Recompute expected from key (avoid importing async side effects).
    const { expectedPass } = await import("./raidThreats");
    const expect = expectedPass(
      job.rcl as 3 | 4 | 5 | 6,
      job.threat as "probe" | "drain" | "smash" | "swarm",
    );
    const row: RunRow = {
      key: job.key,
      rcl: job.rcl,
      threat: job.threat,
      expectedPass: expect,
      ok,
      matchExpectation: ok === expect,
      reason,
      exitCode,
      ms,
    };
    done++;
    writeStatus({
      phase: "running",
      at: new Date().toISOString(),
      done,
      total: jobs.length,
      last: row,
    });
    console.log(
      `[attack-raid-bench] done ${job.key} ok=${ok} expected=${expect} match=${row.matchExpectation} ${ms}ms`,
    );
    return row;
  });

  const matched = rows.filter((r) => r.matchExpectation).length;
  const requiredFails = rows.filter(
    (r) => r.expectedPass && !r.ok,
  );
  const report = {
    at: new Date().toISOString(),
    ticks: opts.ticks,
    matched,
    total: rows.length,
    gateOk: requiredFails.length === 0 && matched === rows.length,
    requiredFails: requiredFails.map((r) => r.key),
    rows,
  };
  writeFileSync(
    path.join(OUT_DIR, "attack-raid-bench.json"),
    JSON.stringify(report, null, 2),
  );
  writeStatus({ phase: "done", at: new Date().toISOString(), report });

  console.log("\n[attack-raid-bench] matrix");
  for (const r of rows) {
    const mark = r.matchExpectation ? "OK" : "MISS";
    console.log(
      `  ${mark} ${r.key.padEnd(14)} ok=${r.ok} expected=${r.expectedPass}  ${r.reason}`,
    );
  }
  console.log(
    `\n[attack-raid-bench] matched ${matched}/${rows.length} gateOk=${report.gateOk}`,
  );
  // Baseline: always exit 0 so we can collect results; gate enforced later.
  void parseFlag;
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
