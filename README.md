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

## Lokal entwickeln (optional)

```bash
npm ci
npm test
npm run typecheck
npm run build   # erzeugt dist/main.js
```

Runtime braucht keinen lokalen Rechner — CI/CD und Cloud Agents laufen auf GitHub/Cursor.

## Dokumentation

- Spec: [docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md](docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md)
- Plan: [docs/superpowers/plans/2026-09-07-autonomous-screeps-cloud-loop.md](docs/superpowers/plans/2026-09-07-autonomous-screeps-cloud-loop.md)
- ADR: [docs/adr/0001-autonomous-screeps-cloud-loop.md](docs/adr/0001-autonomous-screeps-cloud-loop.md)
