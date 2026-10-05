# AutoGorwingScreeps (AGS)

Autonomer Screeps-Bot mit Cloud-Loop: GitHub Actions baut und deployt den Bot zu Screeps, zieht Metriken aus `Memory.ags`, öffnet bei Bedarf Evolve-/Rollback-Issues und startet Cursor Cloud Agents — **ohne Heim-PC zur Laufzeit**.

## Voraussetzungen

- Screeps-Account (MMO) und Auth-Token
- GitHub-Repo mit Actions aktiviert
- Cursor API Key für Cloud Agents
- Issue-Labels einmalig anlegen: `evolve`, `rollback`, `automerge` (sonst schlägt Issue-Create mit 422 fehl)

Secrets und Tokens **nie** committen.

**Empfohlen:** Branch Protection auf `main` mit Required Check **CI** — Automerge wartet auf grüne Checks.

## Secrets & Variablen

Unter **Settings → Secrets and variables → Actions**:

### Secrets

| Name | Pflicht | Beschreibung |
|------|---------|--------------|
| `SCREEPS_TOKEN` | ja | Screeps Auth-Token (Account → Auth Tokens) |
| `CURSOR_API_KEY` | ja | Cursor API Key für den Evolve-Agent |
| `AGS_GH_TOKEN` | optional | PAT mit `contents`/`pull-requests`, falls `GITHUB_TOKEN` für Auto-Merge (z. B. mit Branch Protection) nicht reicht |

### Variables

| Name | Empfehlung | Beschreibung |
|------|------------|--------------|
| `SCREEPS_BRANCH` | `default` | Ziel-Branch in Screeps (Code-Push) |
| `SCREEPS_SHARD` | z. B. `shard3` | Shard; leer lassen, wenn der Header weggelassen werden soll |
| `SCREEPS_HOSTNAME` | leer | Optional; leer = `https://screeps.com`. Nur setzen, wenn die World-API umgeleitet wird |

Optional für **Dedicated/Private Server** (Workflow **Deploy Private Server**) — nicht der Browser-Sim:

| Name | Typ | Beschreibung |
|------|-----|--------------|
| `SCREEPS_PRIVATE_HOSTNAME` | Variable | z. B. `http://127.0.0.1:21025` (nur mit **self-hosted Runner** erreichbar) oder öffentliche URL |
| `SCREEPS_PRIVATE_BRANCH` | Variable | meist `default` |
| `SCREEPS_PRIVATE_RUNNER` | Variable | z. B. `self-hosted` — sonst `ubuntu-latest` |
| `SCREEPS_PRIVATE_TOKEN` | Secret | Token am Private Server (z. B. via screepsmod-auth) |
| `SCREEPS_PRIVATE_EMAIL` / `SCREEPS_PRIVATE_PASSWORD` | Secrets | Alternative Auth per `/api/auth/signin` |

## Erster Deploy

1. Secrets/Variablen setzen (oben).
2. Nach `main` pushen → Workflow **Deploy Screeps** läuft automatisch (auch manuell per `workflow_dispatch`).
3. In der **Screeps UI** den Code-Branch `default` aktivieren (muss zu `SCREEPS_BRANCH` passen).
4. Im Code-Editor sollten **mehrere Module** sichtbar sein (nicht nur `main`) — z. B. `roles`, `roles.harvester`, `spawn`, `telemetry`.
5. Im Screeps-Console prüfen: `Memory.ags` (Telemetrie erscheint nach ein paar Ticks).

## Handy-Test (Evolve)

1. Neues Issue mit Template **Evolve** öffnen (oder Label `evolve` setzen).
2. Workflow **Evolve** startet den Cursor Cloud Agent (Rate Limit: **max. 4 Läufe / Stunde**).
3. Agent öffnet einen PR → Automerge (Label `automerge` oder Branch `cursor/…`) → Push auf `main` → erneutes Deploy.

## Konflikt-Resolver (Agent-PRs)

Workflow **Resolve Conflicts** (`pull_request_target`) für Branches `cursor/…` oder Labels `evolve` / `automerge`:

1. Wenn der PR bereits mit `main` mergebar ist → nichts tun.
2. Bei Konflikten: `origin/main` **in den PR-Branch mergen** (kein Force-Push, kein Rewrite).
3. Nur Allowlist-Konflikte (z. B. `.github/workflows/*`, `package-lock.json`) werden zugunsten von `main` gelöst; Quellcode-Konflikte → PR-Kommentar + Job-Fail.
4. Führt **keinen** Build/Test aus dem PR-Tree aus (Sicherheit bei `pull_request_target`).

Manuell: Actions → **Resolve Conflicts** → PR-Nummer. Optional `AGS_GH_TOKEN`, falls `GITHUB_TOKEN` zum Push nicht reicht.

## Metriken

- Cron: alle **15 Minuten** (`Metrics`-Workflow).
- Manuell: Actions → **Metrics** → **Run workflow** (`workflow_dispatch`).
- Bei Stagnation/Fehlern werden Issues mit Label `evolve` bzw. `rollback` angelegt.
- Test-Force: Actions → **Metrics** → **Run workflow** → Input `force_action` = `evolve` (legt ein Evolve-Issue an, auch ohne Stagnation; überspringt, wenn schon ein offenes `evolve`-Issue existiert).

## Rollback

1. Bevorzugt: Issue mit Label `rollback` (Agent-Pfad).
2. Fallback: Actions → **Rollback** → **Run workflow**, Input `sha` = **schlechter Commit**, der reverted werden soll (nicht ein „bekannter guter“ SHA).

## Umgebungen (nicht verwechseln)

| Umgebung | Was es ist | Tickrate | Unser Deploy |
|----------|------------|----------|--------------|
| **Screeps World** | Öffentlicher MMO | fest | `Deploy Screeps` → `screeps.com` |
| **Dedicated / Private Server** | Echter Server (Steam/lokal/VPS), HTTP-API meist `:21025` | einstellbar (`system.setTickDuration`) | `deploy:private` / Workflow **Deploy Private Server** |
| **Sim / Training** (Browser) | In-Browser-Simulator auf screeps.com | im UI änderbar | **kein** API-Deploy — Code manuell in den Sim-Editor; Globals/CPU weichen ab |

## Dedicated / Private Server (schnelle Ticks)

Derselbe Bot-Code. Ziel-URL über `SCREEPS_HOSTNAME` (z. B. `http://127.0.0.1:21025`).

**Wichtig:** GitHub-hosted Actions erreichen **nicht** `127.0.0.1` auf deinem PC.

1. **Lokal deployen:**
   ```powershell
   $env:SCREEPS_HOSTNAME="http://127.0.0.1:21025"
   $env:SCREEPS_TOKEN="..."   # oder SCREEPS_EMAIL + SCREEPS_PASSWORD
   $env:SCREEPS_SHARD=""      # kein Shard auf Private Server
   npm run deploy:private
   ```
2. **Oder** Self-hosted GitHub Runner auf dem PC + Workflow **Deploy Private Server** mit `SCREEPS_PRIVATE_*`.

World-Deploy bleibt unverändert.

## Multi-Sim Farm (lokal, schnelle Ticks)

Deterministische Szenarien mit **screeps-server-mockup** (Tick-für-Tick, parallel).  
Live-World bleibt Canary — Soft-Lock & Early-Game hier üben.

```powershell
npm run sim:softlock                        # Soft-Lock (Storage voll, Spawn leer)
npm run sim:boot                            # Empty-Room Boot (RCL2, Spawn voll)
npm run sim:farm -- --workers 8 --quiet     # Sweet-Spot laut Bench (~max jobs/s bei guter Eff.)
npm run sim:farm -- --scenario boot --workers 8 --quiet
npm run sim:learn                           # Run → Score (Default 8 Worker)
npm run sim:watch                           # Live-Dashboard (2. Terminal neben Learn/Farm)
npm run sim:bench                           # Worker-Sweep Throughput-Benchmark
```

Nach jedem Learn-Round: `.sim-learn/latest.json` + `history.jsonl` (`nextFocus`, Fail-Notizen).  
Live: Worker schreiben Tick-Snapshots nach `.sim-learn/live/` — `sim:watch` zeigt Tabelle (Creeps, Spawn, Storage, Roles).

| Hardware (dieser PC) | Empfehlung |
|----------------------|------------|
| ~20 Threads / ~64 GB | **8 Worker** Sweet-Spot (Bench); bis 16 ok, darüber kaum schneller |
| Voller Private Server (Steam/`screeps`) | eher **2–4** gleichzeitig |

Pro Worker: eigener Ordner unter `.sim-servers/` + eigener Port (`--base-port`, Default 22100).  
`--concurrency N` startet max. N Prozesse gleichzeitig (Queue für den Rest). `--quiet` nur One-Liner pro Worker.

World-Deploy bleibt unverändert. RCL8-Escort ist zugunsten der Sim-Farm pausiert.

## Lokal entwickeln (optional)

```bash
npm ci
npm test
npm run typecheck
npm run build   # erzeugt mehrere Dateien unter dist/*.js (Screeps-Module)
```

### Screeps-Module (Multi-Modul-Build)

`npm run build` kompiliert jedes `src/**/*.ts` zu einem eigenen CommonJS-Modul unter `dist/`. Deploy lädt **alle** Module hoch (`moduleName → Quelltext`), nicht nur `main`.

| Quelle | Screeps-Modulname |
|--------|-------------------|
| `src/main.ts` | `main` (Entry, exportiert `loop`) |
| `src/spawn.ts` | `spawn` |
| `src/roles/index.ts` | `roles` |
| `src/roles/harvester.ts` | `roles.harvester` |
| `src/loop/recoverTelemetry.ts` | `loop.recoverTelemetry` |

Regel: Pfad unter `src/` → Punkte statt `/`; `index.ts` wird zum Ordnernamen. Zwischen Modulen nutzt der Build `require("modul.name")` (Screeps-üblich).

**Verifikation in der Screeps UI:** Nach Deploy den Branch öffnen → Modul-Liste links zeigt `main` plus die übrigen Module → `main` enthält `module.exports.loop` / `exports.loop`.

Runtime für World braucht keinen lokalen Rechner — CI/CD und Cloud Agents laufen auf GitHub/Cursor.

## Dokumentation

- Spec: [docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md](docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md)
- Plan: [docs/superpowers/plans/2026-09-07-autonomous-screeps-cloud-loop.md](docs/superpowers/plans/2026-09-07-autonomous-screeps-cloud-loop.md)
- ADR: [docs/adr/0001-autonomous-screeps-cloud-loop.md](docs/adr/0001-autonomous-screeps-cloud-loop.md)
