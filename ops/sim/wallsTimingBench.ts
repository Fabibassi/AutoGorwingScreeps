/**
 * Run wallsTiming modes pre | post | off sequentially and rank.
 *
 *   npx tsx ops/sim/wallsTimingBench.ts --ticks 600 --base-port 29000
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
const MODES = ["pre", "post", "off"] as const;

type Live = { ok?: boolean; reason?: string };

function parseArgs(argv: string[]) {
  let ticks = 600;
  let basePort = 29_000;
  let skipBuild = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--skip-build") skipBuild = true;
  }
  return { ticks, basePort, skipBuild };
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
  mode: string,
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
        path.join(ROOT, "ops/sim/wallsTiming.ts"),
        "--mode",
        mode,
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
  for (const mode of MODES) {
    const instance = `wallsTiming-${mode}`;
    console.log(`[wallsTiming-bench] start mode=${mode} port=${port}`);
    const exitCode = await runOne(mode, instance, port++, opts.ticks);
    const live = readLive(instance);
    const reason = live?.reason ?? `exit=${exitCode}`;
    const ok = Boolean(live?.ok);
    const minHitsM = reason.match(/minHits=(\d+)/);
    const rampartsM = reason.match(/ramparts=(\d+)/);
    const livedM = reason.match(/lived=(\d+)t/);
    const deadM = reason.match(/spawnDeadAt=(\d+)/);
    const minHits = minHitsM ? Number(minHitsM[1]) : null;
    const ramparts = rampartsM ? Number(rampartsM[1]) : null;
    const lived = livedM ? Number(livedM[1]) : ok ? opts.ticks : null;
    const spawnDeadAt = deadM ? Number(deadM[1]) : null;
    rows.push({
      mode,
      ok,
      minHits,
      ramparts,
      lived,
      spawnDeadAt,
      reason,
      exitCode,
    });
    console.log(
      `[wallsTiming-bench] ${mode} ok=${ok} lived=${lived} minHits=${minHits} ramparts=${ramparts}`,
    );
  }

  const pre = rows.find((r) => r.mode === "pre");
  const post = rows.find((r) => r.mode === "post");
  const off = rows.find((r) => r.mode === "off");
  const verdict =
    pre?.ok && !post?.ok && !off?.ok
      ? "POST_TOO_LATE"
      : pre?.ok && post?.ok && off?.ok
        ? "WALLS_OPTIONAL"
        : pre?.ok && !post?.ok
          ? "POST_TOO_LATE"
          : pre &&
              post &&
              off &&
              (pre.lived ?? 0) > (post.lived ?? 0) * 2 &&
              Math.abs((post.lived ?? 0) - (off.lived ?? 0)) <= 5
            ? "POST_TOO_LATE"
            : pre?.ok
              ? "PRE_HELPS"
              : "INCONCLUSIVE";

  const report = {
    at: new Date().toISOString(),
    ticks: opts.ticks,
    verdict,
    note:
      verdict === "POST_TOO_LATE"
        ? "Reactive wall arm after hostiles appear is too late vs hard smash; pre-build ramparts (or safe mode) — do not wait for the attack."
        : verdict === "PRE_HELPS"
          ? "Pre-built ramparts help; post/off weaker."
          : verdict === "WALLS_OPTIONAL"
            ? "All modes survived — threat too weak or towers/economy carried."
            : "No clear ranking.",
    rows,
  };
  writeFileSync(
    path.join(OUT_DIR, "walls-timing-bench.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(`\n[wallsTiming-bench] verdict=${verdict}`);
  for (const r of rows) {
    console.log(
      `  ${r.ok ? "OK" : "FAIL"} mode=${r.mode} lived=${r.lived}t minHits=${r.minHits} ramparts=${r.ramparts}`,
    );
  }
  console.log(report.note);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
