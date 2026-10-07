/**
 * Local browser dashboard for parallel mockup sims.
 * Reads `.sim-learn/live/*.json` and optional `latest.json`.
 *
 * Usage: npm run sim:gui
 * Opens http://127.0.0.1:8787
 */
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveStatus } from "./harness";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIVE_DIR = path.join(ROOT, ".sim-learn", "live");
const LATEST = path.join(ROOT, ".sim-learn", "latest.json");

function parseArgs(argv: string[]) {
  let port = 8787;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) port = Number(argv[++i]);
  }
  return { port };
}

function readLive(): LiveStatus[] {
  const rows: LiveStatus[] = [];
  if (!existsSync(LIVE_DIR)) return rows;
  for (const name of readdirSync(LIVE_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      rows.push(
        JSON.parse(readFileSync(path.join(LIVE_DIR, name), "utf8")) as LiveStatus,
      );
    } catch {
      /* partial write */
    }
  }
  rows.sort((a, b) => a.instance.localeCompare(b.instance));
  return rows;
}

function readLatest(): Record<string, unknown> | null {
  if (!existsSync(LATEST)) return null;
  try {
    return JSON.parse(readFileSync(LATEST, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const PAGE = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sim Live</title>
<style>
  :root {
    --bg: #12151c;
    --panel: #1a1f2b;
    --line: #2a3344;
    --text: #e8edf7;
    --muted: #8b97ad;
    --ok: #3ecf8e;
    --fail: #f07178;
    --run: #6cb6ff;
    --accent: #c9a227;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px/1.45 "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(1200px 600px at 10% -10%, #1e2738, var(--bg));
    color: var(--text);
    min-height: 100vh;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;
    align-items: baseline;
    justify-content: space-between;
    padding: 18px 22px 10px;
    border-bottom: 1px solid var(--line);
  }
  h1 { margin: 0; font-size: 1.25rem; letter-spacing: 0.02em; }
  .meta { color: var(--muted); font-size: 0.9rem; }
  .focus {
    margin: 10px 22px 0;
    padding: 10px 14px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--muted);
  }
  .focus strong { color: var(--accent); font-weight: 600; }
  .stats {
    display: flex; gap: 10px; flex-wrap: wrap;
    margin: 14px 22px 0;
  }
  .stat {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 12px;
    min-width: 90px;
  }
  .stat b { display: block; font-size: 1.2rem; }
  .stat span { color: var(--muted); font-size: 0.8rem; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    padding: 16px 22px 28px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card.done-ok { border-color: color-mix(in srgb, var(--ok) 45%, var(--line)); }
  .card.done-fail { border-color: color-mix(in srgb, var(--fail) 45%, var(--line)); }
  .top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .name { font-weight: 650; font-size: 1rem; }
  .badge {
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--muted);
  }
  .badge.run { color: var(--run); border-color: color-mix(in srgb, var(--run) 40%, var(--line)); }
  .badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, var(--line)); }
  .badge.fail { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 40%, var(--line)); }
  .bar {
    height: 6px; background: #0d1118; border-radius: 99px; overflow: hidden;
  }
  .bar > i {
    display: block; height: 100%; background: linear-gradient(90deg, #3a6ea5, var(--run));
    width: 0%;
  }
  .kv {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 10px;
    font-variant-numeric: tabular-nums;
  }
  .kv div { display: flex; justify-content: space-between; gap: 8px; }
  .kv span { color: var(--muted); }
  .roles { color: var(--text); font-size: 0.9rem; word-break: break-word; }
  .reason { color: var(--muted); font-size: 0.82rem; min-height: 1.2em; }
  .empty { margin: 40px 22px; color: var(--muted); }
</style>
</head>
<body>
  <header>
    <h1>Sim Live</h1>
    <div class="meta" id="clock">—</div>
  </header>
  <div class="focus" id="focus">Lade…</div>
  <div class="stats" id="stats"></div>
  <div class="grid" id="grid"></div>
  <div class="empty" id="empty" hidden>Noch keine Worker — starte z.B. <code>npm run sim:farm</code> oder <code>npm run sim:learn</code>.</div>
<script>
function pct(n, d) {
  if (!d || d <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * n) / d)));
}
function rolesText(roles) {
  if (!roles) return "—";
  return Object.entries(roles)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => r + "×" + n)
    .join(" · ") || "—";
}
function badge(r) {
  if (r.done && r.ok) return ['ok', 'OK'];
  if (r.done && !r.ok) return ['fail', 'FAIL'];
  return ['run', 'running'];
}
function card(r) {
  const [cls, label] = badge(r);
  const tickPct = pct(r.tick, r.ticksCap);
  const progPct = pct(r.progress || 0, r.progressTotal || 0);
  const rcl = r.rcl != null ? r.rcl : (r.roles && r.roles._rcl);
  const doneCls = r.done ? (r.ok ? "done-ok" : "done-fail") : "";
  const rclLabel = rcl != null ? rcl : "—";
  const cont = r.containers != null ? r.containers : "—";
  const roads = r.roads != null ? r.roads : "—";
  const sites = r.sites != null ? r.sites : "—";
  const ext = r.extensions != null ? r.extensions : "—";
  const reason = r.reason
    ? r.reason
    : (r.updatedAt ? "upd " + new Date(r.updatedAt).toLocaleTimeString() : "");
  return (
    '<article class="card ' + doneCls + '">' +
      '<div class="top">' +
        '<div class="name">' + r.instance + '</div>' +
        '<span class="badge ' + cls + '">' + label + '</span>' +
      '</div>' +
      '<div class="bar" title="tick ' + r.tick + '/' + r.ticksCap + '"><i style="width:' + tickPct + '%"></i></div>' +
      '<div class="kv">' +
        '<div><span>tick</span><b>' + r.tick + '/' + r.ticksCap + '</b></div>' +
        '<div><span>RCL</span><b>' + rclLabel + '</b></div>' +
        '<div><span>creeps</span><b>' + (r.creeps ?? 0) + '</b></div>' +
        '<div><span>spawn</span><b>' + (r.spawnEnergy ?? 0) + '</b></div>' +
        '<div><span>store</span><b>' + (r.storageEnergy ?? 0) + '</b></div>' +
        '<div><span>progress</span><b>' + progPct + '%</b></div>' +
        '<div><span>cont</span><b>' + cont + '</b></div>' +
        '<div><span>roads</span><b>' + roads + '</b></div>' +
        '<div><span>sites</span><b>' + sites + '</b></div>' +
        '<div><span>ext</span><b>' + ext + '</b></div>' +
      '</div>' +
      '<div class="roles">' + rolesText(r.roles) + '</div>' +
      '<div class="reason">' + reason + '</div>' +
    '</article>'
  );
}
async function refresh() {
  try {
    const res = await fetch("/api/live");
    const data = await res.json();
    const rows = data.workers || [];
    const latest = data.latest;
    document.getElementById("clock").textContent =
      "poll " + new Date().toLocaleTimeString() + " · " + rows.length + " files";
    const focus = document.getElementById("focus");
    if (latest) {
      focus.innerHTML =
        "<strong>last learn</strong> green=" + !!latest.allGreen +
        " streak=" + (latest.consecutiveGreen ?? 0) +
        " · <strong>next</strong> " + (latest.nextFocus || "—");
    } else {
      focus.textContent = "Kein latest.json — nur Live-Worker-Dateien.";
    }
    const running = rows.filter(r => !r.done).length;
    const ok = rows.filter(r => r.done && r.ok).length;
    const fail = rows.filter(r => r.done && !r.ok).length;
    document.getElementById("stats").innerHTML =
      '<div class="stat"><b>' + running + '</b><span>running</span></div>' +
      '<div class="stat"><b>' + ok + '</b><span>ok</span></div>' +
      '<div class="stat"><b>' + fail + '</b><span>fail</span></div>' +
      '<div class="stat"><b>' + rows.length + '</b><span>total</span></div>';
    document.getElementById("empty").hidden = rows.length > 0;
    document.getElementById("grid").innerHTML = rows.map(card).join("");
  } catch (e) {
    document.getElementById("focus").textContent = "Fehler: " + e;
  }
}
refresh();
setInterval(refresh, 500);
</script>
</body>
</html>`;

async function main() {
  const { port } = parseArgs(process.argv.slice(2));
  const server = createServer((req, res) => {
    const url = req.url?.split("?")[0] ?? "/";
    if (url === "/api/live") {
      const body = JSON.stringify({
        workers: readLive(),
        latest: readLatest(),
        at: new Date().toISOString(),
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }
    res.writeHead(404).end("not found");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[sim:gui] http://127.0.0.1:${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
