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

Optional für Private/Training-Server (Workflow **Deploy Training**):

| Name | Typ | Beschreibung |
|------|-----|--------------|
| `SCREEPS_TRAINING_HOSTNAME` | Variable | z. B. `http://127.0.0.1:21025` (nur mit **self-hosted Runner** erreichbar) oder öffentliche URL |
| `SCREEPS_TRAINING_BRANCH` | Variable | meist `default` |
| `SCREEPS_TRAINING_RUNNER` | Variable | z. B. `self-hosted` — sonst `ubuntu-latest` |
| `SCREEPS_TRAINING_TOKEN` | Secret | Token am Training-Server (falls vorhanden) |
| `SCREEPS_TRAINING_EMAIL` / `SCREEPS_TRAINING_PASSWORD` | Secrets | Alternative Auth per `/api/auth/signin` |

## Erster Deploy

1. Secrets/Variablen setzen (oben).
2. Nach `main` pushen → Workflow **Deploy Screeps** läuft automatisch (auch manuell per `workflow_dispatch`).
3. In der **Screeps UI** den Code-Branch `default` aktivieren (muss zu `SCREEPS_BRANCH` passen).
4. Im Screeps-Console prüfen: `Memory.ags` (Telemetrie erscheint nach ein paar Ticks).

## Handy-Test (Evolve)

1. Neues Issue mit Template **Evolve** öffnen (oder Label `evolve` setzen).
2. Workflow **Evolve** startet den Cursor Cloud Agent (Rate Limit: **max. 4 Läufe / Stunde**).
3. Agent öffnet einen PR → Automerge (Label `automerge` oder Branch `cursor/…`) → Push auf `main` → erneutes Deploy.

## Metriken

- Cron: alle **15 Minuten** (`Metrics`-Workflow).
- Manuell: Actions → **Metrics** → **Run workflow** (`workflow_dispatch`).
- Bei Stagnation/Fehlern werden Issues mit Label `evolve` bzw. `rollback` angelegt.

## Rollback

1. Bevorzugt: Issue mit Label `rollback` (Agent-Pfad).
2. Fallback: Actions → **Rollback** → **Run workflow**, Input `sha` = **schlechter Commit**, der reverted werden soll (nicht ein „bekannter guter“ SHA).

## Training / Private Server (schnelle Ticks)

Derselbe Bot-Code. Deploy-Ziel über `SCREEPS_HOSTNAME`.

**Wichtig:** GitHub-hosted Actions erreichen **nicht** `127.0.0.1` auf deinem PC. Für lokalen Training-Server:

1. **Lokal pushen (einfachste Variante):**
   ```bash
   $env:SCREEPS_HOSTNAME="http://127.0.0.1:21025"
   $env:SCREEPS_TOKEN="..."   # oder SCREEPS_EMAIL + SCREEPS_PASSWORD
   $env:SCREEPS_SHARD=""      # kein Shard auf Private Server
   npm run deploy:training
   ```
2. **Oder** Self-hosted GitHub Runner auf dem PC + Workflow **Deploy Training** (`workflow_dispatch`) mit `SCREEPS_TRAINING_*` Vars/Secrets.

World-Deploy (`Deploy Screeps` auf `main`) bleibt unverändert auf screeps.com.

## Lokal entwickeln (optional)

```bash
npm ci
npm test
npm run typecheck
npm run build   # erzeugt dist/main.js
```

Runtime für World braucht keinen lokalen Rechner — CI/CD und Cloud Agents laufen auf GitHub/Cursor.

## Dokumentation

- Spec: [docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md](docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md)
- Plan: [docs/superpowers/plans/2026-09-07-autonomous-screeps-cloud-loop.md](docs/superpowers/plans/2026-09-07-autonomous-screeps-cloud-loop.md)
- ADR: [docs/adr/0001-autonomous-screeps-cloud-loop.md](docs/adr/0001-autonomous-screeps-cloud-loop.md)
