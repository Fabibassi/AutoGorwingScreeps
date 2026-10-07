/**
 * Run early-game A/B benchmarks (one knob at a time) and write results.
 *
 * Usage:
 *   npx tsx ops/sim/abExperiment.ts --knob extensionBootstrap
 *   npx tsx ops/sim/abExperiment.ts --knob extensionBootstrap --variants 0,2,5
 *   npx tsx ops/sim/abExperiment.ts --all
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AB_KNOBS, AB_VARIANTS, type AbKnob } from "../../src/earlyGame/experimentPolicy";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, ".sim-learn");
const LIVE_DIR = path.join(OUT_DIR, "live");

type BenchRow = {
  variant: string;
  ok: boolean;
  ticksRun: number;
  firstRoad: number | null;
  c2: number | null;
  rcl3: number | null;
  reason: string;
  exitCode: number;
  ms: number;
};

function parseArgs(argv: string[]) {
  let knob = "";
  let variants = "";
  let ticks = 50_000;
  let basePort = 23300;
  let concurrency = 2;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--knob" && argv[i + 1]) knob = argv[++i];
    else if (a === "--variants" && argv[i + 1]) variants = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--concurrency" && argv[i + 1]) concurrency = Number(argv[++i]);
    else if (a === "--all") all = true;
  }
  return { knob, variants, ticks, basePort, concurrency, all };
}

function parseMetric(reason: string, key: string): number | null {
  const m = reason.match(new RegExp(`${key}=(-?\\d+|null|-)`));
  if (!m) {
    const at = reason.match(new RegExp(`${key}@(-?\\d+|null|-)`));
    if (!at || at[1] === "-" || at[1] === "null") return null;
    return Number(at[1]);
  }
  if (m[1] === "-" || m[1] === "null") return null;
  return Number(m[1]);
}

function readLive(instance: string): {
  ok?: boolean;
  reason?: string;
  tick?: number;
  done?: boolean;
} | null {
  const p = path.join(LIVE_DIR, `${instance}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as {
      ok?: boolean;
      reason?: string;
      tick?: number;
      done?: boolean;
    };
  } catch {
    return null;
  }
}

function runFarm(
  knob: AbKnob,
  variants: string[],
  ticks: number,
  basePort: number,
  concurrency: number,
): Promise<{ code: number; out: string }> {
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
        String(variants.length),
        "--ticks",
        String(ticks),
        "--base-port",
        String(basePort),
        "--concurrency",
        String(concurrency),
        "--ab-knob",
        knob,
        "--ab-variants",
        variants.join(","),
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
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

function pickWinner(rows: BenchRow[]): string | null {
  const okRows = rows.filter((r) => r.ok && r.rcl3 != null);
  if (okRows.length === 0) return null;
  okRows.sort((a, b) => {
    const ra = a.rcl3 ?? 1e9;
    const rb = b.rcl3 ?? 1e9;
    if (ra !== rb) return ra - rb;
    return a.ticksRun - b.ticksRun;
  });
  return okRows[0].variant;
}

async function runKnob(
  knob: AbKnob,
  variants: string[],
  ticks: number,
  basePort: number,
  concurrency: number,
): Promise<{
  knob: AbKnob;
  winner: string | null;
  results: BenchRow[];
}> {
  console.log(`\n[ab] ===== ${knob} variants=${variants.join("|")} =====`);
  const started = Date.now();
  const { code, out } = await runFarm(knob, variants, ticks, basePort, concurrency);

  const rows: BenchRow[] = variants.map((variant, i) => {
    const instance = `real-${knob}.${variant}`;
    const live = readLive(instance);
    const reason =
      live?.reason ??
      out.match(new RegExp(`${instance}[^\\n]*reason.:\\s*"([^"]*)"`))?.[1] ??
      out.match(new RegExp(`ab=${knob}:${variant}[^"]*`))?.[0] ??
      "";
    const farmLine = out
      .split("\n")
      .find((l) => l.includes(instance) || l.includes(`ab=${knob}:${variant}`));
    const exitFromLine = farmLine?.match(/exit=(\d+)/);
    return {
      variant,
      ok: live?.ok === true,
      ticksRun: live?.tick ?? ticks,
      firstRoad: parseMetric(reason, "firstRoad") ?? parseMetric(reason, "road"),
      c2: parseMetric(reason, "c2"),
      rcl3: parseMetric(reason, "rcl3"),
      reason,
      exitCode: exitFromLine ? Number(exitFromLine[1]) : code,
      ms: Date.now() - started,
    };
  });

  const winner = pickWinner(rows);
  const report = {
    at: new Date().toISOString(),
    knob,
    ticks,
    variants,
    winner,
    note:
      winner != null
        ? `winner=${winner} by lowest rcl3@ among OK runs`
        : "no OK winner",
    results: rows,
    farmExit: code,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `bench-${knob}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`[ab] wrote ${outFile} winner=${winner}`);
  return { knob, winner, results: rows };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log("[ab] build…");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(ROOT, "ops/buildModules.ts")],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`build ${c}`))));
  });

  const knobs: AbKnob[] = opts.all
    ? [...AB_KNOBS]
    : opts.knob && (AB_KNOBS as readonly string[]).includes(opts.knob)
      ? [opts.knob as AbKnob]
      : [];
  if (knobs.length === 0) {
    console.error(
      `[ab] need --knob <${AB_KNOBS.join("|")}> or --all`,
    );
    process.exit(2);
  }

  const summary: {
    at: string;
    winners: Partial<Record<AbKnob, string | null>>;
    knobs: Array<{ knob: AbKnob; winner: string | null }>;
  } = {
    at: new Date().toISOString(),
    winners: {},
    knobs: [],
  };

  for (let i = 0; i < knobs.length; i++) {
    const knob = knobs[i];
    const variants = opts.variants
      ? opts.variants.split(",").map((s) => s.trim()).filter(Boolean)
      : [...AB_VARIANTS[knob]];
    const port = opts.basePort + i * 40;
    const result = await runKnob(
      knob,
      variants,
      opts.ticks,
      port,
      opts.concurrency,
    );
    summary.winners[knob] = result.winner;
    summary.knobs.push({ knob, winner: result.winner });
    writeFileSync(
      path.join(OUT_DIR, "bench-summary.json"),
      JSON.stringify(summary, null, 2),
    );
  }

  console.log("\n[ab] summary", summary);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
