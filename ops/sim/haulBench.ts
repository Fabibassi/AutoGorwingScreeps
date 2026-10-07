/**
 * Short haul/economy gate suite after haul-order + b_chain defaults.
 * Score = ok / total across softlock + economy + miners replicates.
 * Target satisfaction: ≥97.5% (i.e. nearly all gates green).
 *
 * Usage: npx tsx ops/sim/haulBench.ts --replicates 4 --base-port 27100
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".sim-learn");

type Gate = "softlock" | "economy" | "miners";

const GATES: Array<{
  gate: Gate;
  script: string;
  ticks: number;
}> = [
  { gate: "softlock", script: "ops/sim/softLock.ts", ticks: 120 },
  { gate: "economy", script: "ops/sim/economy.ts", ticks: 250 },
  { gate: "miners", script: "ops/sim/miners.ts", ticks: 400 },
];

function parseArgs(argv: string[]) {
  let replicates = 4;
  let basePort = 27100;
  let skipBuild = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--replicates" && argv[i + 1]) replicates = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--skip-build") skipBuild = true;
  }
  return { replicates, basePort, skipBuild };
}

async function runBuild(): Promise<void> {
  await execFileAsync("npm", ["run", "build"], { cwd: ROOT, shell: true });
}

async function runOne(
  script: string,
  instance: string,
  port: number,
  ticks: number,
): Promise<{ ok: boolean; ms: number; out: string }> {
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      [
        "tsx",
        script,
        "--instance",
        instance,
        "--port",
        String(port),
        "--ticks",
        String(ticks),
      ],
      { cwd: ROOT, shell: true, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const out = `${stdout}\n${stderr}`;
    const ok = /"ok":\s*true/.test(out) || out.includes('"ok": true');
    return { ok, ms: Date.now() - t0, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const out = `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message ?? ""}`;
    return { ok: false, ms: Date.now() - t0, out };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.skipBuild) {
    console.log("[haul-bench] build…");
    await runBuild();
  }

  const rows: Array<{
    gate: Gate;
    rep: number;
    ok: boolean;
    ms: number;
  }> = [];
  let port = opts.basePort;
  for (const g of GATES) {
    for (let rep = 0; rep < opts.replicates; rep++) {
      const instance = `haul-${g.gate}.r${rep}`;
      console.log(`[haul-bench] start ${instance} port=${port}`);
      const { ok, ms } = await runOne(g.script, instance, port, g.ticks);
      rows.push({ gate: g.gate, rep, ok, ms });
      console.log(
        `[haul-bench] ${rows.length}/${GATES.length * opts.replicates} ${instance} ok=${ok} ${ms}ms`,
      );
      port++;
    }
  }

  const total = rows.length;
  const okCount = rows.filter((r) => r.ok).length;
  const score = total === 0 ? 0 : okCount / total;
  const report = {
    at: new Date().toISOString(),
    replicates: opts.replicates,
    total,
    okCount,
    score,
    satisfied: score >= 0.975,
    byGate: GATES.map((g) => {
      const subset = rows.filter((r) => r.gate === g.gate);
      const ok = subset.filter((r) => r.ok).length;
      return { gate: g.gate, ok, n: subset.length };
    }),
    rows,
  };

  mkdirSync(OUT, { recursive: true });
  const outFile = path.join(OUT, "haul-bench.json");
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(
    `[haul-bench] score=${(score * 100).toFixed(1)}% ok=${okCount}/${total} satisfied=${report.satisfied}`,
  );
  console.log(`[haul-bench] wrote ${outFile}`);
  process.exit(report.satisfied ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
