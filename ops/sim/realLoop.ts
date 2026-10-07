/**
 * Overnight real-climb loop: run 4-worker suite until consecutiveGreen>=3 or max rounds.
 * Usage: npx tsx ops/sim/realLoop.ts --max-rounds 20
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".sim-learn", "real-latest.json");
const HISTORY = path.join(ROOT, ".sim-learn", "real-history.jsonl");

function parseArgs(argv: string[]) {
  let maxRounds = 20;
  let workers = 4;
  let ticks = 25_000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-rounds" && argv[i + 1]) maxRounds = Number(argv[++i]);
    else if (a === "--workers" && argv[i + 1]) workers = Number(argv[++i]);
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
  }
  return { maxRounds, workers, ticks };
}

function readStreak(): number {
  if (!existsSync(OUT)) return 0;
  try {
    const j = JSON.parse(readFileSync(OUT, "utf8")) as { consecutiveGreen?: number };
    return Number(j.consecutiveGreen ?? 0);
  } catch {
    return 0;
  }
}

function runFarm(workers: number, ticks: number): Promise<{
  code: number;
  ok: number;
  fail: number;
  tail: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/farm.ts"),
        "--scenario",
        "real",
        "--workers",
        String(workers),
        "--ticks",
        String(ticks),
        "--base-port",
        "23000",
        "--quiet",
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
    );
    let out = "";
    child.stdout?.on("data", (b) => {
      out += String(b);
      process.stdout.write(b);
    });
    child.stderr?.on("data", (b) => {
      out += String(b);
      process.stderr.write(b);
    });
    child.on("close", (code) => {
      const ok = Number(out.match(/done ok=(\d+)/)?.[1] ?? 0);
      const fail = Number(out.match(/fail=(\d+)/)?.[1] ?? workers);
      resolve({ code: code ?? 1, ok, fail, tail: out.slice(-2000) });
    });
  });
}

async function main() {
  const { maxRounds, workers, ticks } = parseArgs(process.argv.slice(2));
  mkdirSync(path.dirname(OUT), { recursive: true });
  let streak = readStreak();
  console.log(`[realLoop] start streak=${streak} maxRounds=${maxRounds}`);

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`\n[realLoop] ===== round ${round} =====`);
    const started = Date.now();
    const result = await runFarm(workers, ticks);
    const allGreen = result.ok === workers && result.fail === 0 && result.code === 0;
    streak = allGreen ? streak + 1 : 0;
    const report = {
      round,
      at: new Date().toISOString(),
      workers,
      ticks,
      ok: result.ok,
      fail: result.fail,
      exitCode: result.code,
      allGreen,
      consecutiveGreen: streak,
      ms: Date.now() - started,
      nextFocus: allGreen
        ? streak >= 3
          ? "Goal met: 3 consecutive green real suites"
          : `streak=${streak}/3 — rerun`
        : "Investigate fails in .sim-learn/live/real-*.json",
    };
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    writeFileSync(HISTORY, JSON.stringify(report) + "\n", { flag: "a" });
    console.log(`[realLoop]`, report);

    if (streak >= 3) {
      console.log("[realLoop] GOAL STREAK MET");
      process.exit(0);
    }
  }
  console.log("[realLoop] max rounds reached without streak 3");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
