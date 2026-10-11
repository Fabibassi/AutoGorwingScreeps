/**
 * Bench post-RCL6 spend arms.
 *
 *   npx tsx ops/sim/rcl6SpendBench.ts --ticks 12000 --base-port 29600
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

const ARMS: Array<{ mode: string; remote: string; walls: string; key: string }> =
  [
    { mode: "fat_first", remote: "off", walls: "off", key: "home.fat" },
    {
      mode: "fat_first",
      remote: "reserved_drop",
      walls: "off",
      key: "remote.fat",
    },
    {
      mode: "upgrade_rush",
      remote: "reserved_drop",
      walls: "off",
      key: "remote.rush",
    },
    {
      mode: "fat_first",
      remote: "reserved_drop",
      walls: "force",
      key: "remote.fat.walls",
    },
  ];

function parseArgs(argv: string[]) {
  let ticks = 12_000;
  let basePort = 29_600;
  let skipBuild = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--skip-build") skipBuild = true;
  }
  return { ticks, basePort, skipBuild };
}

function readLive(instance: string): { ok?: boolean; reason?: string } | null {
  const p = path.join(LIVE_DIR, `${instance}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
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
  arm: (typeof ARMS)[0],
  instance: string,
  port: number,
  ticks: number,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/rcl6Spend.ts"),
        "--mode",
        arm.mode,
        "--remote",
        arm.remote,
        "--walls",
        arm.walls,
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.on("close", (c) => resolve(c ?? 1));
  });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(LIVE_DIR, { recursive: true });
  if (!opts.skipBuild) await runBuild();

  const rows = [];
  let port = opts.basePort;
  for (const arm of ARMS) {
    const instance = `rcl6Spend-${arm.key}`;
    console.log(`[rcl6Spend-bench] start ${arm.key}`);
    const exitCode = await runOne(arm, instance, port++, opts.ticks);
    const live = readLive(instance);
    const reason = live?.reason ?? `exit=${exitCode}`;
    const net = Number(reason.match(/netPerTick=(-?[\d.]+)/)?.[1] ?? NaN);
    const minStorage = Number(reason.match(/minStorage=(\d+)/)?.[1] ?? NaN);
    const progressGain = Number(reason.match(/progressGain=(\d+)/)?.[1] ?? NaN);
    const floorOk = /floorOk=1/.test(reason);
    rows.push({
      key: arm.key,
      ...arm,
      ok: Boolean(live?.ok),
      floorOk,
      netPerTick: net,
      minStorage,
      progressGain,
      reason,
      exitCode,
    });
  }

  const ranked = [...rows].sort((a, b) => {
    if (a.floorOk !== b.floorOk) return a.floorOk ? -1 : 1;
    return b.netPerTick - a.netPerTick;
  });
  const winner = ranked[0];
  const report = {
    at: new Date().toISOString(),
    ticks: opts.ticks,
    winner: winner?.key,
    note:
      "Primary: floorOk then highest netStoragePerTick. Remotes should beat home_only drain.",
    ranked,
    rows,
  };
  writeFileSync(
    path.join(OUT_DIR, "rcl6-spend-bench.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(`\n[rcl6Spend-bench] winner=${winner?.key}`);
  for (const r of ranked) {
    console.log(
      `  ${r.floorOk ? "OK" : "FAIL"} ${r.key.padEnd(18)} net=${r.netPerTick} min=${r.minStorage} prog=${r.progressGain}`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
