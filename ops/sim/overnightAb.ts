/**
 * Overnight early-game A/B suite:
 *   1) Run each AB_KNOB × variants (realClimb, parallel roads)
 *   2) Pick winners (fastest green unlock / rcl3)
 *   3) Merge into OPTIMIZED_PROFILE
 *   4) Baseline vs optimized compare
 *   5) Write .sim-learn/bench-summary.json + overnight-final.json
 *
 * Deadline: keep running until ~08:00 local; write best-known final report then.
 *
 * Usage: npx tsx ops/sim/overnightAb.ts [--ticks 50000] [--concurrency 2] [--base-port 24000]
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AB_KNOBS,
  AB_VARIANTS,
  BASELINE_PROFILE,
  type AbKnob,
  type ExperimentProfile,
  profileForVariant,
} from "../../src/earlyGame/experimentPolicy";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEARN = path.join(ROOT, ".sim-learn");
const DEADLINE_HOUR = 8; // local morning

type VariantResult = {
  knob: AbKnob;
  variant: string;
  ok: boolean;
  ticksRun: number;
  /** Tick when 2 source containers finished (from reason). */
  c2: number | null;
  /** Tick when first road finished. */
  firstRoad: number | null;
  rcl3: number | null;
  unlock: number | null;
  reason: string;
  ms: number;
};

function parseArgs(argv: string[]) {
  let ticks = 50_000;
  let concurrency = 2;
  let basePort = 24_000;
  let skipBuild = false;
  let resume = false;
  let finalizeOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--concurrency" && argv[i + 1]) concurrency = Number(argv[++i]);
    else if (a === "--base-port" && argv[i + 1]) basePort = Number(argv[++i]);
    else if (a === "--skip-build") skipBuild = true;
    else if (a === "--resume") resume = true;
    else if (a === "--finalize-only") finalizeOnly = true;
  }
  return { ticks, concurrency, basePort, skipBuild, resume, finalizeOnly };
}

/** Load prior ab-<knob>.json results when resuming a crashed overnight. */
function loadCachedKnob(knob: AbKnob): VariantResult[] | null {
  const p = path.join(LEARN, `ab-${knob}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    // Strip UTF-8 BOM (PowerShell Set-Content often adds it).
    const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
    const j = JSON.parse(raw) as { results?: VariantResult[] };
    if (!Array.isArray(j.results) || j.results.length === 0) return null;
    return j.results;
  } catch (e) {
    console.log(`[overnight] resume cache unreadable for ${knob}: ${e}`);
    return null;
  }
}

function ensureLearnDir() {
  fs.mkdirSync(LEARN, { recursive: true });
  fs.mkdirSync(path.join(LEARN, "live"), { recursive: true });
}

/** First 08:00 local strictly after `startedAt`. Morning start → same day; afternoon start → next morning. */
export function pastDeadline(now = new Date(), startedAt = now): boolean {
  const deadline = new Date(startedAt);
  deadline.setHours(DEADLINE_HOUR, 0, 0, 0);
  if (startedAt.getTime() >= deadline.getTime()) {
    deadline.setDate(deadline.getDate() + 1);
  }
  return now.getTime() >= deadline.getTime();
}

function extractMetric(reason: string, key: string): number | null {
  const m = reason.match(new RegExp(`${key}[=@](\\d+)`));
  return m ? Number(m[1]) : null;
}

function score(r: VariantResult): number {
  // Lower is better. Prefer green; then earliest rcl3; then unlock; then ticksRun.
  if (!r.ok) return 1_000_000_000 + (r.ticksRun || 999_999);
  return r.rcl3 ?? r.unlock ?? r.ticksRun;
}

function runFarm(opts: {
  workers: number;
  ticks: number;
  basePort: number;
  concurrency: number;
  abKnob?: string;
  abVariants?: string;
  profile?: string;
  roadPolicies?: string;
}): Promise<{ code: number; out: string; ms: number }> {
  const started = Date.now();
  const args = [
    path.join(ROOT, "ops/sim/farm.ts"),
    "--scenario",
    "real",
    "--workers",
    String(opts.workers),
    "--ticks",
    String(opts.ticks),
    "--base-port",
    String(opts.basePort),
    "--concurrency",
    String(opts.concurrency),
    "--quiet",
  ];
  if (opts.abKnob) args.push("--ab-knob", opts.abKnob);
  if (opts.abVariants) args.push("--ab-variants", opts.abVariants);
  if (opts.profile) args.push("--profile", opts.profile);
  if (opts.roadPolicies) args.push("--road-policies", opts.roadPolicies);
  else args.push("--road-policies", "parallel");

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", ...args],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
    );
    let out = "";
    child.stdout?.on("data", (b) => {
      const s = String(b);
      out += s;
      process.stdout.write(s);
    });
    child.stderr?.on("data", (b) => {
      const s = String(b);
      out += s;
      process.stderr.write(s);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, out, ms: Date.now() - started });
    });
  });
}

function parseVariantFromLive(
  knob: AbKnob,
  variant: string,
): Partial<VariantResult> | null {
  const name = `real-${knob}.${variant}.json`;
  const p = path.join(LEARN, "live", name);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as {
      ok?: boolean;
      done?: boolean;
      reason?: string;
      tick?: number;
    };
    if (!j.done) return null;
    const reason = j.reason ?? "";
    return {
      ok: !!j.ok,
      ticksRun: j.tick ?? 0,
      reason,
      c2: extractMetric(reason, "c2"),
      firstRoad:
        extractMetric(reason, "firstRoad") ?? extractMetric(reason, "road"),
      rcl3: extractMetric(reason, "rcl3"),
      unlock: extractMetric(reason, "unlock"),
    };
  } catch {
    return null;
  }
}

function parseFarmTail(
  out: string,
  knob: AbKnob,
  variants: string[],
): VariantResult[] {
  const results: VariantResult[] = [];
  for (const variant of variants) {
    const live = parseVariantFromLive(knob, variant);
    // Prefer live JSON; fall back to farm log line.
    const line =
      out
        .split("\n")
        .reverse()
        .find((l) => l.includes(`${knob}.${variant}`)) ?? "";
    const okFromLog =
      /"ok":\s*true/.test(line) ||
      /\bok=true\b/.test(line) ||
      line.includes('"ok": true');
    const ok = live?.ok ?? okFromLog;
    const reason =
      live?.reason ??
      line.match(/reason[=:]\s*"?([^"\n]+)/)?.[1] ??
      line;
    const ticksRun =
      live?.ticksRun ??
      Number(line.match(/ticksRun[=:]\s*(\d+)/)?.[1] ?? 0);
    results.push({
      knob,
      variant,
      ok: !!ok && (live?.ok !== false),
      ticksRun,
      c2: live?.c2 ?? extractMetric(reason, "c2"),
      firstRoad:
        live?.firstRoad ??
        extractMetric(reason, "firstRoad") ??
        extractMetric(reason, "road"),
      rcl3: live?.rcl3 ?? extractMetric(reason, "rcl3"),
      unlock: live?.unlock ?? extractMetric(reason, "unlock"),
      reason,
      ms: 0,
    });
  }
  return results;
}

function writeOptimizedSource(profile: ExperimentProfile): void {
  const file = path.join(ROOT, "src/earlyGame/experimentPolicy.ts");
  let src = fs.readFileSync(file, "utf8");
  const hauler =
    profile.haulerMaxCost === undefined
      ? "undefined"
      : String(profile.haulerMaxCost);
  const block = `export const OPTIMIZED_PROFILE: ExperimentProfile = {
  containerTiming: "${profile.containerTiming}",
  upgraderQuotaClimb: ${profile.upgraderQuotaClimb},
  extensionBootstrap: ${profile.extensionBootstrap},
  builderInfra: ${profile.builderInfra},
  minerMinWork: ${profile.minerMinWork},
  haulerMaxCost: ${hauler},
  controllerContainer: "${profile.controllerContainer}",
  spawnBuffer: ${profile.spawnBuffer},
};`;
  if (/export const OPTIMIZED_PROFILE: ExperimentProfile = [\s\S]*?;/.test(src)) {
    src = src.replace(
      /export const OPTIMIZED_PROFILE: ExperimentProfile = [\s\S]*?;/,
      block,
    );
  } else {
    src += `\n${block}\n`;
  }
  fs.writeFileSync(file, src);
}

function writeJson(name: string, data: unknown) {
  fs.writeFileSync(path.join(LEARN, name), JSON.stringify(data, null, 2));
}

async function runKnobBench(
  knob: AbKnob,
  ticks: number,
  concurrency: number,
  basePort: number,
): Promise<VariantResult[]> {
  const variants = [...AB_VARIANTS[knob]];
  console.log(`\n[overnight] === knob=${knob} variants=${variants.join("|")} ===`);
  const { out, ms } = await runFarm({
    workers: variants.length,
    ticks,
    basePort,
    concurrency,
    abKnob: knob,
    abVariants: variants.join(","),
  });
  const parsed = parseFarmTail(out, knob, variants).map((r) => ({
    ...r,
    ms: Math.round(ms / variants.length),
  }));
  writeJson(`ab-${knob}.json`, { knob, variants, results: parsed, at: new Date().toISOString() });
  return parsed;
}

function baselineVariant(knob: AbKnob): string {
  // Match parseAbVariant defaults in experimentPolicy.ts
  const baseline: Record<AbKnob, string> = {
    containerTiming: "immediate",
    upgraderQuota: "3",
    extensionBootstrap: "2",
    builderCount: "4",
    minerBody: "early_1w",
    haulerCap: "fat",
    controllerContainer: "after_sources",
    spawnBuffer: "200",
  };
  return baseline[knob];
}

function pickWinners(all: VariantResult[]): Record<AbKnob, string> {
  const winners = {} as Record<AbKnob, string>;
  for (const knob of AB_KNOBS) {
    const rows = all.filter((r) => r.knob === knob);
    rows.sort((a, b) => score(a) - score(b));
    const best = rows[0];
    // Incomplete / all-fail knobs keep production baseline, not an arbitrary first variant.
    winners[knob] =
      best && best.ok ? best.variant : baselineVariant(knob);
    console.log(
      `[overnight] winner ${knob}=${winners[knob]} score=${best ? score(best) : "n/a"} ok=${best?.ok ?? false}`,
    );
  }
  return winners;
}

function mergeProfile(winners: Record<AbKnob, string>): ExperimentProfile {
  let p: ExperimentProfile = { ...BASELINE_PROFILE };
  for (const knob of AB_KNOBS) {
    p = { ...p, ...profileForVariant(knob, winners[knob]) };
    // profileForVariant resets to baseline then sets one field — merge field-wise:
  }
  // Rebuild properly field by field
  p = { ...BASELINE_PROFILE };
  for (const knob of AB_KNOBS) {
    const one = profileForVariant(knob, winners[knob]);
    switch (knob) {
      case "containerTiming":
        p.containerTiming = one.containerTiming;
        break;
      case "upgraderQuota":
        p.upgraderQuotaClimb = one.upgraderQuotaClimb;
        break;
      case "extensionBootstrap":
        p.extensionBootstrap = one.extensionBootstrap;
        break;
      case "builderCount":
        p.builderInfra = one.builderInfra;
        break;
      case "minerBody":
        p.minerMinWork = one.minerMinWork;
        break;
      case "haulerCap":
        p.haulerMaxCost = one.haulerMaxCost;
        break;
      case "controllerContainer":
        p.controllerContainer = one.controllerContainer;
        break;
      case "spawnBuffer":
        p.spawnBuffer = one.spawnBuffer;
        break;
    }
  }
  return p;
}

async function compareProfiles(
  ticks: number,
  concurrency: number,
  basePort: number,
): Promise<{ baseline: VariantResult; optimized: VariantResult }> {
  console.log("\n[overnight] === baseline vs optimized (parallel) ===");
  // Farm only supports one --profile per process → two farms in parallel.
  const [baseRun, optRun] = await Promise.all([
    runFarm({
      workers: 1,
      ticks,
      basePort,
      concurrency: 1,
      profile: "baseline",
    }),
    runFarm({
      workers: 1,
      ticks,
      basePort: basePort + 10,
      concurrency: 1,
      profile: "optimized",
    }),
  ]);
  void concurrency;

  const parseOne = (
    label: "baseline" | "optimized",
    farmOut: string,
  ): VariantResult => {
    const liveName =
      label === "baseline" ? "real-baseline.json" : "real-optimized.json";
    const p = path.join(LEARN, "live", liveName);
    let reason = "";
    let ok = false;
    let ticksRun = 0;
    if (fs.existsSync(p)) {
      try {
        const j = JSON.parse(
          fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""),
        ) as { ok?: boolean; reason?: string; tick?: number };
        ok = !!j.ok;
        reason = j.reason ?? "";
        ticksRun = j.tick ?? 0;
      } catch {
        /* ignore */
      }
    }
    if (!reason) {
      const line =
        farmOut.split("\n").reverse().find((l) => l.includes("real-")) ?? "";
      reason = line;
      ok = line.includes('"ok": true') || line.includes("ok=true");
    }
    return {
      knob: "containerTiming",
      variant: label,
      ok,
      ticksRun,
      c2: extractMetric(reason, "c2"),
      firstRoad:
        extractMetric(reason, "firstRoad") ?? extractMetric(reason, "road"),
      rcl3: extractMetric(reason, "rcl3"),
      unlock: extractMetric(reason, "unlock"),
      reason,
      ms: 0,
    };
  };

  return {
    baseline: parseOne("baseline", baseRun.out),
    optimized: parseOne("optimized", optRun.out),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  ensureLearnDir();
  const startedAt = new Date().toISOString();
  console.log(
    `[overnight] start ${startedAt} ticks=${opts.ticks} concurrency=${opts.concurrency} basePort=${opts.basePort} deadline=${DEADLINE_HOUR}:00 resume=${opts.resume} skipBuild=${opts.skipBuild} finalizeOnly=${opts.finalizeOnly}`,
  );

  writeJson("overnight-status.json", {
    phase: "build",
    startedAt,
    deadlineHour: DEADLINE_HOUR,
  });

  if (!opts.skipBuild) {
    console.log("[overnight] building modules…");
    execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  }

  const allResults: VariantResult[] = [];
  let port = opts.basePort;

  if (opts.finalizeOnly) {
    console.log("[overnight] finalize-only: load ab-*.json caches");
    for (const knob of AB_KNOBS) {
      const cached = loadCachedKnob(knob);
      if (!cached) {
        console.log(`[overnight] missing cache ab-${knob}.json — using baseline variant`);
        continue;
      }
      allResults.push(...cached);
    }
  } else {
    for (const knob of AB_KNOBS) {
      if (pastDeadline(new Date(), new Date(startedAt))) {
        console.log("[overnight] deadline reached mid-suite — stopping new knobs");
        break;
      }
      if (opts.resume) {
        const cached = loadCachedKnob(knob);
        if (cached) {
          console.log(
            `[overnight] resume skip ${knob} (${cached.length} cached variants)`,
          );
          allResults.push(...cached);
          port += 20;
          continue;
        }
      }
      writeJson("overnight-status.json", {
        phase: `ab:${knob}`,
        startedAt,
        knob,
        at: new Date().toISOString(),
      });
      // Fresh modules so mid-suite policy fixes apply to the next knob.
      try {
        console.log(`[overnight] rebuild before ${knob}…`);
        execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
      } catch (e) {
        console.log(`[overnight] rebuild failed (continuing): ${e}`);
      }
      const rows = await runKnobBench(knob, opts.ticks, opts.concurrency, port);
      allResults.push(...rows);
      port += 20; // keep ports unique across knobs
      writeJson("bench-partial.json", {
        results: allResults,
        at: new Date().toISOString(),
      });
    }
  }

  await finalizeSuite({
    startedAt,
    allResults,
    ticks: opts.ticks,
    concurrency: opts.concurrency,
    basePort: port + 50,
    skipCompare: pastDeadline(new Date(), new Date(startedAt)),
  });
}

async function finalizeSuite(opts: {
  startedAt: string;
  allResults: VariantResult[];
  ticks: number;
  concurrency: number;
  basePort: number;
  skipCompare: boolean;
}): Promise<void> {
  const winners = pickWinners(opts.allResults);
  const optimized = mergeProfile(winners);
  writeOptimizedSource(optimized);
  const winnerRows = AB_KNOBS.map((knob) => {
    const row = opts.allResults.find(
      (r) => r.knob === knob && r.variant === winners[knob],
    );
    return {
      knob,
      variant: winners[knob],
      ok: row?.ok ?? false,
      c2: row?.c2 ?? null,
      firstRoad: row?.firstRoad ?? null,
      rcl3: row?.rcl3 ?? null,
      ticksRun: row?.ticksRun ?? null,
    };
  });
  writeJson("bench-summary.json", {
    startedAt: opts.startedAt,
    finishedKnobs: [...new Set(opts.allResults.map((r) => r.knob))],
    winners,
    winnerRows,
    optimized,
    results: opts.allResults,
    at: new Date().toISOString(),
  });

  console.log("[overnight] rebuild with OPTIMIZED_PROFILE…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

  let compare: { baseline: VariantResult; optimized: VariantResult } | null =
    null;
  if (!opts.skipCompare) {
    writeJson("overnight-status.json", {
      phase: "compare",
      startedAt: opts.startedAt,
      at: new Date().toISOString(),
    });
    compare = await compareProfiles(
      opts.ticks,
      opts.concurrency,
      opts.basePort,
    );
  } else {
    console.log("[overnight] skip compare — past deadline");
  }

  const final = {
    startedAt: opts.startedAt,
    finishedAt: new Date().toISOString(),
    metrics: ["c2@", "firstRoad@", "rcl3@", "ticksRun", "sustainOK"],
    winners,
    winnerRows,
    optimized,
    results: opts.allResults,
    compare: compare
      ? {
          baseline: {
            ok: compare.baseline.ok,
            c2: compare.baseline.c2,
            firstRoad: compare.baseline.firstRoad,
            rcl3: compare.baseline.rcl3,
            ticksRun: compare.baseline.ticksRun,
            reason: compare.baseline.reason,
          },
          optimized: {
            ok: compare.optimized.ok,
            c2: compare.optimized.c2,
            firstRoad: compare.optimized.firstRoad,
            rcl3: compare.optimized.rcl3,
            ticksRun: compare.optimized.ticksRun,
            reason: compare.optimized.reason,
          },
        }
      : null,
    verdict: compare
      ? score(compare.optimized) < score(compare.baseline)
        ? "optimized_faster"
        : score(compare.optimized) === score(compare.baseline)
          ? "tie"
          : "baseline_faster"
      : "compare_skipped",
  };
  writeJson("overnight-final.json", final);
  writeJson("overnight-status.json", {
    phase: "done",
    startedAt: opts.startedAt,
    finishedAt: final.finishedAt,
    verdict: final.verdict,
  });

  console.log("\n[overnight] FINAL");
  console.log(JSON.stringify(final, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    writeJson("overnight-status.json", {
      phase: "error",
      error: String(err),
      at: new Date().toISOString(),
    });
    process.exit(1);
  });
}
