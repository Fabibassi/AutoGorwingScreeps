/**
 * Keep overnight A/B suite alive until final report or local 08:00.
 * Restarts with --resume if the overnight process disappears.
 *
 * Usage: npx tsx ops/sim/overnightWatch.ts
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEARN = path.join(ROOT, ".sim-learn");
const POLL_MS = 60_000;
const DEADLINE_HOUR = 8;

function status(): { phase?: string; finishedAt?: string; startedAt?: string } {
  const p = path.join(LEARN, "overnight-status.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(
      fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""),
    ) as { phase?: string; finishedAt?: string; startedAt?: string };
  } catch {
    return {};
  }
}

function overnightRunning(): boolean {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'overnightAb' } | Measure-Object | Select-Object -ExpandProperty Count"`,
      { encoding: "utf8" },
    ).trim();
    return Number(out) > 0;
  } catch {
    return false;
  }
}

function pastDeadline(now = new Date(), startedAt = now): boolean {
  const deadline = new Date(startedAt);
  deadline.setHours(DEADLINE_HOUR, 0, 0, 0);
  if (startedAt.getTime() >= deadline.getTime()) {
    deadline.setDate(deadline.getDate() + 1);
  }
  return now.getTime() >= deadline.getTime();
}

function startResume(): void {
  console.log(`[watch] starting sim:overnight:resume at ${new Date().toISOString()}`);
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "sim:overnight:resume"],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      shell: true,
      env: { ...process.env },
    },
  );
  child.unref();
}

function listAbCaches(): string[] {
  if (!fs.existsSync(LEARN)) return [];
  return fs
    .readdirSync(LEARN)
    .filter((f) => f.startsWith("ab-") && f.endsWith(".json"))
    .map((f) => f.replace(/^ab-/, "").replace(/\.json$/, ""));
}

function liveSnapshot(phase: string | undefined): void {
  const liveDir = path.join(LEARN, "live");
  const live: Array<Record<string, unknown>> = [];
  const freshMs = 120_000;
  const now = Date.now();
  if (fs.existsSync(liveDir)) {
    for (const f of fs.readdirSync(liveDir)) {
      if (!f.startsWith("real-") || !f.endsWith(".json")) continue;
      // Only current experiment instances (skip stale hyphen names).
      if (!f.includes(".")) continue;
      const full = path.join(liveDir, f);
      const age = now - fs.statSync(full).mtimeMs;
      if (age > freshMs) continue; // ignore leftover runs from killed farms
      try {
        const j = JSON.parse(
          fs.readFileSync(full, "utf8").replace(/^\uFEFF/, ""),
        ) as {
          instance?: string;
          tick?: number;
          rcl?: number;
          progress?: number;
          progressTotal?: number;
          extensions?: number;
          containers?: number;
          roads?: number;
          done?: boolean;
          ok?: boolean;
          reason?: string;
        };
        if (j.done) continue; // finished rows live in ab-*.json
        live.push({
          instance: j.instance,
          tick: j.tick,
          rcl: j.rcl,
          progress: j.progress,
          progressTotal: j.progressTotal,
          extensions: j.extensions,
          containers: j.containers,
          roads: j.roads,
          reason: j.reason,
        });
      } catch {
        /* ignore */
      }
    }
  }
  const winnersSoFar: Record<string, string> = {};
  for (const knob of listAbCaches()) {
    try {
      const j = JSON.parse(
        fs
          .readFileSync(path.join(LEARN, `ab-${knob}.json`), "utf8")
          .replace(/^\uFEFF/, ""),
      ) as {
        results?: Array<{ variant: string; ok: boolean; rcl3: number | null }>;
      };
      const ok = (j.results ?? [])
        .filter((r) => r.ok && r.rcl3 != null)
        .sort((a, b) => (a.rcl3 ?? 1e9) - (b.rcl3 ?? 1e9));
      if (ok[0]) winnersSoFar[knob] = ok[0].variant;
    } catch {
      /* ignore */
    }
  }
  const snap = {
    updatedAt: new Date().toISOString(),
    phase: phase ?? null,
    completedKnobs: listAbCaches(),
    winnersSoFar,
    live,
    finalExists: fs.existsSync(path.join(LEARN, "overnight-final.json")),
  };
  fs.writeFileSync(
    path.join(LEARN, "bench-live.json"),
    JSON.stringify(snap, null, 2),
  );
}

async function main() {
  console.log(`[watch] overnight watchdog started deadline=${DEADLINE_HOUR}:00`);
  // Ensure one overnight is up.
  if (!overnightRunning() && !fs.existsSync(path.join(LEARN, "overnight-final.json"))) {
    startResume();
  }

  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const st = status();
    liveSnapshot(st.phase);
    if (st.phase === "done" || fs.existsSync(path.join(LEARN, "overnight-final.json"))) {
      console.log("[watch] overnight finished — exiting");
      process.exit(0);
    }
    if (pastDeadline(new Date(), st.startedAt ? new Date(st.startedAt) : new Date())) {
      console.log("[watch] past deadline — exiting (overnight may still write final)");
      process.exit(0);
    }
    if (!overnightRunning()) {
      console.log(`[watch] overnight missing (phase=${st.phase ?? "?"}) — resume`);
      startResume();
    } else {
      console.log(`[watch] ok phase=${st.phase ?? "?"} ${new Date().toISOString()}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
