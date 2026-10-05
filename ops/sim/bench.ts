/**
 * Benchmark mockup farm throughput vs worker count.
 * Usage: npx tsx ops/sim/bench.ts --scenario softlock --ticks 80
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv: string[]) {
  let scenario = "softlock";
  let ticks = 80;
  let basePort = 23000;
  let counts = [1, 2, 4, 8, 12, 16, 20, 24];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario" && argv[i + 1]) scenario = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--counts" && argv[i + 1]) {
      counts = argv[++i].split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
    }
  }
  return { scenario, ticks, basePort, counts };
}

function runFarm(
  scenario: string,
  workers: number,
  ticks: number,
  basePort: number,
): Promise<{
  workers: number;
  ok: number;
  fail: number;
  wallMs: number;
  avgWorkerMs: number;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
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
        String(workers),
        "--base-port",
        String(basePort),
        "--quiet",
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
    );
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
        workers,
        ok: done ? Number(done[1]) : 0,
        fail: done ? Number(done[2]) : workers,
        wallMs: done ? Number(done[3]) : 0,
        avgWorkerMs: done ? Number(done[4]) : 0,
        exitCode: code ?? 1,
      });
    });
  });
}

type Row = {
  workers: number;
  ok: number;
  fail: number;
  wallMs: number;
  avgWorkerMs: number;
  /** Completions per wall-second (higher = better farm throughput). */
  jobsPerSec: number;
  /** Relative efficiency vs 1-worker baseline (1.0 = perfect scaling). */
  efficiency: number;
  exitCode: number;
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log(`[bench] build…`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(ROOT, "ops/buildModules.ts")],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`build ${c}`))));
  });

  console.log(
    `[bench] scenario=${opts.scenario} ticks=${opts.ticks} counts=${opts.counts.join(",")}`,
  );

  const rows: Row[] = [];
  let baselineJobsPerSec = 0;

  for (const workers of opts.counts) {
    const port = opts.basePort + workers * 40;
    console.log(`[bench] workers=${workers} …`);
    const r = await runFarm(opts.scenario, workers, opts.ticks, port);
    const jobsPerSec = r.wallMs > 0 ? (r.ok / r.wallMs) * 1000 : 0;
    if (workers === opts.counts[0]) baselineJobsPerSec = jobsPerSec / workers;
    const ideal = baselineJobsPerSec * workers;
    const efficiency = ideal > 0 ? jobsPerSec / ideal : 0;
    const row: Row = {
      workers: r.workers,
      ok: r.ok,
      fail: r.fail,
      wallMs: r.wallMs,
      avgWorkerMs: r.avgWorkerMs,
      jobsPerSec: Number(jobsPerSec.toFixed(2)),
      efficiency: Number(efficiency.toFixed(3)),
      exitCode: r.exitCode,
    };
    rows.push(row);
    console.log(
      `[bench] w=${workers} ok=${r.ok}/${workers} wall=${r.wallMs}ms avg=${r.avgWorkerMs}ms jobs/s=${row.jobsPerSec} eff=${row.efficiency}`,
    );
  }

  const best = [...rows].sort((a, b) => b.jobsPerSec - a.jobsPerSec)[0];
  // Prefer high throughput with efficiency still decent (>=0.5) if available.
  const sweet = [...rows]
    .filter((r) => r.fail === 0 && r.efficiency >= 0.5)
    .sort((a, b) => b.jobsPerSec - a.jobsPerSec)[0] ?? best;

  const report = {
    at: new Date().toISOString(),
    scenario: opts.scenario,
    ticks: opts.ticks,
    rows,
    bestThroughput: best,
    recommended: sweet,
    note:
      "jobs/s = successful workers finished per wall-second. efficiency vs perfect linear scaling from smallest count.",
  };

  const outDir = path.join(ROOT, ".sim-learn");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "bench.json");
  writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log("\n=== Benchmark summary ===");
  console.log(
    "workers".padStart(8) +
      "wallMs".padStart(10) +
      "avgMs".padStart(10) +
      "jobs/s".padStart(10) +
      "eff".padStart(8) +
      "  result",
  );
  for (const r of rows) {
    const mark =
      r.workers === sweet.workers ? " ← recommended" : r.workers === best.workers ? " ← max throughput" : "";
    console.log(
      String(r.workers).padStart(8) +
        String(r.wallMs).padStart(10) +
        String(r.avgWorkerMs).padStart(10) +
        String(r.jobsPerSec).padStart(10) +
        String(r.efficiency).padStart(8) +
        `  ${r.ok}/${r.workers}${mark}`,
    );
  }
  console.log(
    `\nRecommended workers: ${sweet.workers} (jobs/s=${sweet.jobsPerSec}, eff=${sweet.efficiency})`,
  );
  console.log(`Wrote ${outFile}`);
  process.exit(rows.every((r) => r.fail === 0) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
