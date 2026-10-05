/**
 * Master agent: run sims → evaluate → fix via Cursor SDK → repeat
 * until RCL8 climb (+ foundation + RCL survive ladder) is green.
 *
 * Usage:
 *   npx tsx ops/sim/masterAgent.ts
 *   npx tsx ops/sim/masterAgent.ts --max-rounds 20 --workers 8
 *
 * Requires CURSOR_API_KEY for auto-fix rounds; without it, still runs
 * sims and exits non-zero on failure (manual fix).
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { Agent, CursorAgentError } from "@cursor/sdk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, ".sim-learn");
const MASTER_LATEST = path.join(OUT_DIR, "master-latest.json");
const MASTER_HISTORY = path.join(OUT_DIR, "master-history.jsonl");

type StepResult = {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
};

type MasterReport = {
  round: number;
  at: string;
  steps: StepResult[];
  allGreen: boolean;
  reachedRcl8: boolean;
  nextFocus: string;
};

function parseArgs(argv: string[]) {
  let workers = 8;
  let maxRounds = 50;
  let climbTicks = 2500;
  let surviveTicks = 150;
  let fix = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workers" && argv[i + 1]) workers = Number(argv[++i]);
    else if (a === "--max-rounds" && argv[i + 1]) maxRounds = Number(argv[++i]);
    else if (a === "--climb-ticks" && argv[i + 1])
      climbTicks = Number(argv[++i]);
    else if (a === "--survive-ticks" && argv[i + 1])
      surviveTicks = Number(argv[++i]);
    else if (a === "--no-fix") fix = false;
  }
  return { workers, maxRounds, climbTicks, surviveTicks, fix };
}

function runCmd(
  label: string,
  args: string[],
): Promise<StepResult> {
  const started = Date.now();
  return new Promise((resolve) => {
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
      const ms = Date.now() - started;
      const okJson = /"ok":\s*true/.test(out);
      const farmOk = /\[farm\] done ok=\d+ fail=0/.test(out);
      const learnOk = /All scenarios green/.test(out) || /fail=0/.test(out);
      const ok =
        code === 0 && (okJson || farmOk || (label.startsWith("learn") && learnOk));
      const reason =
        out.match(/"reason":\s*"([^"]+)"/)?.[1] ??
        out.match(/\[learn\] nextFocus: (.+)/)?.[1] ??
        (code === 0 ? "exit 0" : `exit ${code}`);
      console.log(
        `[master] ${label} → ${ok ? "OK" : "FAIL"} (${ms}ms) ${reason}`,
      );
      resolve({
        name: label,
        ok,
        detail: reason.slice(0, 300),
        ms,
      });
    });
  });
}

async function build(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(ROOT, "ops/buildModules.ts")],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.on("close", (c) =>
      c === 0 ? resolve() : reject(new Error(`build failed ${c}`)),
    );
  });
}

async function runSuite(opts: {
  workers: number;
  climbTicks: number;
  surviveTicks: number;
}): Promise<MasterReport> {
  await build();
  const steps: StepResult[] = [];

  steps.push(
    await runCmd("learn-foundation", [
      "--import",
      "tsx",
      path.join(ROOT, "ops/sim/learnLoop.ts"),
      "--workers",
      String(opts.workers),
      "--ticks",
      "120",
      "--curriculum",
      "softlock,boot,economy,surround,miners",
    ]),
  );

  for (let rcl = 1; rcl <= 8; rcl++) {
    steps.push(
      await runCmd(`rclSurvive-${rcl}`, [
        "--import",
        "tsx",
        path.join(ROOT, "ops/sim/rclSurvive.ts"),
        "--rcl",
        String(rcl),
        "--instance",
        `master-rcl${rcl}`,
        "--port",
        String(21100 + rcl),
        "--ticks",
        String(opts.surviveTicks),
      ]),
    );
  }

  steps.push(
    await runCmd("rclClimb-8", [
      "--import",
      "tsx",
      path.join(ROOT, "ops/sim/rclClimb.ts"),
      "--instance",
      "master-climb",
      "--port",
      "21200",
      "--ticks",
      String(opts.climbTicks),
    ]),
  );

  const allGreen = steps.every((s) => s.ok);
  const climb = steps.find((s) => s.name === "rclClimb-8");
  const reachedRcl8 = Boolean(climb?.ok);
  const failed = steps.filter((s) => !s.ok).map((s) => s.name);
  const nextFocus = allGreen
    ? "RCL8 suite green — master objective met"
    : `Fix failing steps: ${failed.join(", ")}`;

  return {
    round: 0,
    at: new Date().toISOString(),
    steps,
    allGreen,
    reachedRcl8,
    nextFocus,
  };
}

async function agentFix(report: MasterReport): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log(
      "[master] CURSOR_API_KEY missing — skip auto-fix; apply nextFocus manually",
    );
    return;
  }

  const failed = report.steps.filter((s) => !s.ok);
  const prompt = `You are the AutoGrowingScreeps MASTER sim agent.
Goal: make the mockup bot reach and hold RCL8 in ops/sim without soft-locks.

Failed steps this round:
${failed.map((f) => `- ${f.name}: ${f.detail}`).join("\n")}

Full report JSON:
${JSON.stringify(report, null, 2)}

Do this:
1. Diagnose root cause in src/ (spawn, earlyGame policy, roles, construction).
2. Implement the smallest durable fix.
3. Run relevant sims: npm run sim:learn, npx tsx ops/sim/rclSurvive.ts --rcl <n>, npx tsx ops/sim/rclClimb.ts
4. Run npm test && npm run typecheck
5. Commit and push to main if green enough for the failing step.

Constraints: TypeScript bot in src/; sims in ops/sim/; no secrets; keep RCL8 path robust (economy before vanity builds; never seal spawn exit ring).`;

  console.log("[master] invoking Cursor Agent for fix…");
  try {
    const result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: "composer-2.5" },
      local: { cwd: ROOT },
    });
    console.log("[master] agent status=", result.status);
    if (result.result) console.log(String(result.result).slice(0, 2000));
  } catch (err) {
    if (err instanceof CursorAgentError) {
      console.error("[master] agent error", err.message);
    } else {
      throw err;
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(
    `[master] start maxRounds=${opts.maxRounds} workers=${opts.workers} climbTicks=${opts.climbTicks} fix=${opts.fix}`,
  );

  for (let round = 1; round <= opts.maxRounds; round++) {
    console.log(`\n======== MASTER ROUND ${round}/${opts.maxRounds} ========`);
    const report = await runSuite(opts);
    report.round = round;
    writeFileSync(MASTER_LATEST, JSON.stringify(report, null, 2));
    appendFileSync(MASTER_HISTORY, `${JSON.stringify(report)}\n`);
    console.log(`[master] nextFocus: ${report.nextFocus}`);

    if (report.allGreen && report.reachedRcl8) {
      console.log("[master] SUCCESS — RCL8 suite green");
      process.exit(0);
    }

    if (opts.fix) {
      await agentFix(report);
    } else {
      console.log("[master] --no-fix set; stopping after first failure suite");
      process.exit(1);
    }
  }

  console.error("[master] exhausted max rounds without RCL8 green");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
