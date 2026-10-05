/**
 * Live terminal dashboard for parallel mockup sims.
 * Reads `.sim-learn/live/*.json` written by running workers.
 *
 * Usage (2 terminals):
 *   npm run sim:learn
 *   npm run sim:watch
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveStatus } from "./harness";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIVE_DIR = path.join(ROOT, ".sim-learn", "live");
const LATEST = path.join(ROOT, ".sim-learn", "latest.json");

function parseArgs(argv: string[]) {
  let intervalMs = 500;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--interval" && argv[i + 1]) {
      intervalMs = Number(argv[++i]);
    }
  }
  return { intervalMs };
}

function rolesShort(roles: Record<string, number>): string {
  const parts = Object.entries(roles)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${r[0]}${n}`);
  return parts.length ? parts.join(" ") : "-";
}

function render(): void {
  const rows: LiveStatus[] = [];
  if (existsSync(LIVE_DIR)) {
    for (const name of readdirSync(LIVE_DIR)) {
      if (!name.endsWith(".json")) continue;
      try {
        rows.push(
          JSON.parse(
            readFileSync(path.join(LIVE_DIR, name), "utf8"),
          ) as LiveStatus,
        );
      } catch {
        /* partial write */
      }
    }
  }
  rows.sort((a, b) => a.instance.localeCompare(b.instance));

  // Clear screen + home cursor (Windows terminals too).
  process.stdout.write("\x1Bc");
  const now = new Date().toLocaleTimeString();
  console.log(`Sim Live  ${now}  (Ctrl+C zum Beenden)`);
  console.log("─".repeat(78));

  if (existsSync(LATEST)) {
    try {
      const latest = JSON.parse(readFileSync(LATEST, "utf8")) as {
        allGreen?: boolean;
        consecutiveGreen?: number;
        nextFocus?: string;
        at?: string;
      };
      console.log(
        `last learn: green=${latest.allGreen} streak=${latest.consecutiveGreen ?? 0} @ ${latest.at ?? "?"}`,
      );
      console.log(`nextFocus: ${latest.nextFocus ?? "-"}`);
      console.log("─".repeat(78));
    } catch {
      /* ignore */
    }
  }

  if (rows.length === 0) {
    console.log("Noch keine Worker — starte z.B. npm run sim:learn in einem anderen Terminal.");
    return;
  }

  console.log(
    "instance".padEnd(16) +
      "tick".padStart(6) +
      "creep".padStart(6) +
      "spawn".padStart(7) +
      "store".padStart(7) +
      "  roles".padEnd(14) +
      "status",
  );
  for (const r of rows) {
    const status = r.done
      ? r.ok
        ? `OK ${r.reason ?? ""}`
        : `FAIL ${r.reason ?? ""}`
      : "running";
    console.log(
      r.instance.padEnd(16) +
        String(r.tick).padStart(6) +
        String(r.creeps).padStart(6) +
        String(r.spawnEnergy).padStart(7) +
        String(r.storageEnergy).padStart(7) +
        `  ${rolesShort(r.roles)}`.padEnd(14) +
        status.slice(0, 28),
    );
  }
  const running = rows.filter((r) => !r.done).length;
  const ok = rows.filter((r) => r.done && r.ok).length;
  const fail = rows.filter((r) => r.done && !r.ok).length;
  console.log("─".repeat(78));
  console.log(`running=${running} ok=${ok} fail=${fail} total=${rows.length}`);
}

async function main() {
  const { intervalMs } = parseArgs(process.argv.slice(2));
  render();
  setInterval(render, intervalMs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
