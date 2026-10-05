/**
 * Sim learn loop round: run farm scenarios → score → write history → exit.
 *
 * Usage:
 *   npx tsx ops/sim/learnLoop.ts
 *   npx tsx ops/sim/learnLoop.ts --workers 20 --rounds 1
 *   npx tsx ops/sim/learnLoop.ts --curriculum softlock,boot
 *
 * History: .sim-learn/history.jsonl + .sim-learn/latest.json
 */
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEARN_DIR = path.join(ROOT, ".sim-learn");
const HISTORY = path.join(LEARN_DIR, "history.jsonl");
const LATEST = path.join(LEARN_DIR, "latest.json");

/** Ordered curriculum — harder later. */
const DEFAULT_CURRICULUM = [
  "softlock",
  "boot",
  "economy",
  "surround",
  "miners",
] as const;

type ScenarioResult = {
  scenario: string;
  ok: number;
  fail: number;
  wallMs: number;
  avgWorkerMs: number;
  exitCode: number;
  rawTail: string;
};

type RoundReport = {
  round: number;
  at: string;
  workers: number;
  concurrency: number;
  ticks: number;
  curriculum: string[];
  scenarios: ScenarioResult[];
  allGreen: boolean;
  consecutiveGreen: number;
  nextFocus: string;
  notes: string[];
};

function parseArgs(argv: string[]) {
  let workers = 8;
  let ticks = 80;
  let concurrency = 0;
  let rounds = 1;
  let curriculum = [...DEFAULT_CURRICULUM];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workers" && argv[i + 1]) workers = Number(argv[++i]);
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--concurrency" && argv[i + 1])
      concurrency = Number(argv[++i]);
    else if (a === "--rounds" && argv[i + 1]) rounds = Number(argv[++i]);
    else if (a === "--curriculum" && argv[i + 1]) {
      curriculum = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (concurrency <= 0) concurrency = workers;
  return { workers, ticks, concurrency, rounds, curriculum };
}

function runFarm(
  scenario: string,
  workers: number,
  ticks: number,
  concurrency: number,
): Promise<ScenarioResult> {
  return new Promise((resolve) => {
    const args = [
      "--import",
      "tsx",
      path.join(ROOT, "ops/sim/farm.ts"),
      "--scenario",
      scenario,
      "--workers",
      String(workers),
      "--ticks",
      String(ticks),
      "--concurrency",
      String(concurrency),
      "--quiet",
    ];
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let out = "";
    child.stdout?.on("data", (b) => {
      out += String(b);
    });
    child.stderr?.on("data", (b) => {
      out += String(b);
    });
    child.on("close", (code) => {
      const done = out.match(
        /\[farm\] done ok=(\d+) fail=(\d+) wall=(\d+)ms avgWorker=(\d+)ms/,
      );
      resolve({
        scenario,
        ok: done ? Number(done[1]) : 0,
        fail: done ? Number(done[2]) : workers,
        wallMs: done ? Number(done[3]) : 0,
        avgWorkerMs: done ? Number(done[4]) : 0,
        exitCode: code ?? 1,
        rawTail: out.slice(-2500),
      });
    });
  });
}

function loadConsecutiveGreen(): number {
  if (!existsSync(LATEST)) return 0;
  try {
    const prev = JSON.parse(readFileSync(LATEST, "utf8")) as RoundReport;
    return prev.allGreen ? (prev.consecutiveGreen ?? 1) : 0;
  } catch {
    return 0;
  }
}

function evaluate(report: Omit<RoundReport, "nextFocus" | "notes" | "consecutiveGreen">): {
  consecutiveGreen: number;
  nextFocus: string;
  notes: string[];
} {
  const notes: string[] = [];
  const failed = report.scenarios.filter((s) => s.fail > 0 || s.exitCode !== 0);
  let consecutiveGreen = 0;
  if (failed.length === 0) {
    consecutiveGreen = loadConsecutiveGreen() + 1;
    notes.push(`All scenarios green (streak=${consecutiveGreen}).`);
  } else {
    consecutiveGreen = 0;
    for (const f of failed) {
      notes.push(
        `FAIL ${f.scenario}: ok=${f.ok} fail=${f.fail} — inspect bot spawn/economy policy.`,
      );
    }
  }

  let nextFocus: string;
  if (failed.length > 0) {
    nextFocus = `fix failing scenario(s): ${failed.map((f) => f.scenario).join(", ")}`;
  } else if (consecutiveGreen >= 3) {
    nextFocus =
      "Streak≥3 — next harden: longer multi-phase runs (containers built from scratch) or RCL progression sim.";
    notes.push(
      "Curriculum stable (softlock/boot/economy/surround/miners); extend further.",
    );
  } else {
    nextFocus =
      "Re-run full curriculum to build confidence streak before harder scenarios.";
  }

  return { consecutiveGreen, nextFocus, notes };
}

async function oneRound(
  round: number,
  opts: {
    workers: number;
    ticks: number;
    concurrency: number;
    curriculum: string[];
  },
): Promise<RoundReport> {
  // Build once per round so all workers share fresh dist.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(ROOT, "ops/buildModules.ts")],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`build exit ${code}`)),
    );
  });

  const scenarios: ScenarioResult[] = [];
  for (const scenario of opts.curriculum) {
    console.log(`[learn] round=${round} running scenario=${scenario}…`);
    const result = await runFarm(
      scenario,
      opts.workers,
      opts.ticks,
      opts.concurrency,
    );
    console.log(
      `[learn] ${scenario} ok=${result.ok} fail=${result.fail} wall=${result.wallMs}ms`,
    );
    scenarios.push(result);
  }

  const base = {
    round,
    at: new Date().toISOString(),
    workers: opts.workers,
    concurrency: opts.concurrency,
    ticks: opts.ticks,
    curriculum: opts.curriculum,
    scenarios,
    allGreen: scenarios.every((s) => s.fail === 0 && s.exitCode === 0),
  };
  const { consecutiveGreen, nextFocus, notes } = evaluate(base);
  const report: RoundReport = {
    ...base,
    consecutiveGreen,
    nextFocus,
    notes,
  };

  mkdirSync(LEARN_DIR, { recursive: true });
  appendFileSync(HISTORY, `${JSON.stringify(report)}\n`);
  writeFileSync(LATEST, JSON.stringify(report, null, 2));
  console.log(`[learn] wrote ${LATEST}`);
  console.log(`[learn] nextFocus: ${nextFocus}`);
  for (const n of notes) console.log(`[learn] note: ${n}`);
  return report;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(LEARN_DIR, { recursive: true });
  let last: RoundReport | null = null;
  for (let r = 1; r <= opts.rounds; r++) {
    last = await oneRound(r, opts);
    if (!last.allGreen) break;
  }
  process.exit(last?.allGreen ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
