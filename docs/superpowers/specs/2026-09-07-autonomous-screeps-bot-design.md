# Design: Autonomer Screeps-Bot (AutoGrowingScreeps)

Datum: 2026-09-07  
Status: Approved (Brainstorming)  
Repo: Ein-Repo-Loop

## 1. Zielbild

Ein Screeps-World-Bot, der sich **cloudbasiert und full-auto** weiterentwickelt:

1. Metriken beobachten (Energy-Income, Error-Rate; später Komposit-Score)
2. Bei Stagnation oder manuellem Auftrag ein GitHub-Issue anlegen bzw. nutzen
3. Cursor Cloud Agent arbeitet das Issue ab und öffnet einen PR
4. Grüne Checks → auto-merge auf `main` → Deploy nach Screeps `default`
5. Nächstes Metrik-Fenster bewertet den Effekt; bei Einbruch Rollback

**Runtime-Prinzip:** Später läuft **nichts** auf dem Home-PC. Ein Issue vom Handy muss den Loop triggern können, auch wenn der Rechner aus ist.

**Overnight-/Base-Dev:** Der erste große Build (Pipeline + Minimal-Bot + erster Loop) darf länger dauern (z. B. über Nacht per Goal). Danach ist das Ziel **24/7**-Betrieb.

## 2. Nicht-Ziele (Phase 1)

- Screeps Arena
- Private-Server als Pflicht (nur als spätere Option offenhalten)
- Multi-Shard-Strategie
- Menschliches Review vor jedem Merge
- Canary-Deploy vor `default` (bewusst verworfen zugunsten schnellem Feedback + Rollback)
- Fertiges Endgame-Bot-Design von Hand

## 3. Entscheidungen (Kurz)

| Thema | Entscheidung |
|---|---|
| Spielumgebung | Screeps World (screeps.com); Private-Server später optional |
| Architektur | Ein Repo: Bot + Ops + Actions |
| Sprache | TypeScript für Bot + Ops-Tooling; Actions in YAML |
| Orchestration | GitHub Actions (Cron, Issue-Trigger, CI, Deploy, Rollback) |
| Coding-Agent | Cursor Cloud Agents via Cursor SDK / `CURSOR_API_KEY` |
| Issue-Modell | Manuelle und Auto-Issues teilen **dieselbe** Pipeline |
| Deploy | Grünes PR → merge `main` → sofort Screeps `default` |
| Metriken | Start: Energy + Error-Rate; ADR/Spec definiert später Komposit |
| Lokal | Home-PC kein Runtime-Bestandteil; SDK-`local` nur falls je auf Actions-Runner, Default ist Cursor **Cloud** |

## 4. Systemgrenzen

| Schicht | Verantwortung | Läuft wo |
|---|---|---|
| Bot-Kernel | Spiel-Logik (Creeps, Spawn, Buildings) | Screeps World |
| Telemetrie | Energy, Errors (+ später Komposit) in Memory/Segment | Screeps + Export |
| Orchestrator | Cron, Issue-Routing, Agent-Start, Merge, Deploy, Rollback | GitHub Actions |
| Coding-Agent | Code ändern, Checks erfüllen, PR öffnen | Cursor Cloud |
| Source of Truth | Code, Issues, History | GitHub Repo |

## 5. Repo-Struktur

```
/
├── src/                       # Screeps-Bot (TypeScript)
├── ops/                       # Deploy, metrics-pull, issue-helpers
├── .github/workflows/         # Cron, issue→agent, CI, deploy, rollback
├── docs/adr/                  # Architekturentscheidungen
└── docs/superpowers/specs/    # Design-Specs
```

## 6. Closed-Loop-Datenfluss

```
Screeps (Bot + Memory-Metriken)
    → Cron/Action (metrics-pull via Screeps API)
    → Vergleich mit Baseline
    → GitHub Issue (Labels: evolve | rollback | …)
    → Cursor Cloud Agent (Issue-Body = Auftrag)
    → Pull Request
    → CI (build / lint / smoke)
    → auto-merge main
    → Deploy Action → Screeps branch `default`
    → neues Metrik-Fenster
```

Manuelle Handy-Issues und Auto-Issues nutzen denselben Issue→Agent→PR→Deploy-Pfad.

## 7. Bot-Bootstrap

- Minimaler RCL1/2-Kernel: Harvest → Upgrade/Spawn
- Klare Module: `main`, `role.*`, `spawn`, Memory-Schema
- TypeScript-Build nach deploybarem JS (z. B. `dist/`)
- Absichtlich dünn: Evolution soll den Rest treiben, nicht ein vorgefertigtes Mega-Framework

## 8. Telemetrie

### Minimum (Phase 1)

- `energyIncomePerTick` (gleitendes Fenster)
- `errorCount`
- `tick`
- `rcl`
- `cpuUsedAvg`

### Später: Komposit-Score

Gewichteter Score (Energy, CPU-Effizienz, Errors, ggf. Controller-Progress). Stagnation = Score/Income flach über N Fenster **und** keine offenen `evolve`-Issues (oder bewusst neues Issue trotz offener Queue nach Policy).

Metrik-Snapshots + Diff gehören in den Issue-Body, damit der Agent Zahlen sieht.

## 9. Safety Rails

Trotz sofortigem Deploy auf `default`:

1. **CI-Gate:** Build + Smoke-Tests müssen grün sein, sonst kein Merge.
2. **Rollback:** Starker Metrik-Einbruch oder Error-Spike → `rollback`-Issue/Workflow → Revert auf letzten guten Commit → Redeploy.
3. **Scope:** Ein Issue = eine Evolutionseinheit; keine stillen Massen-Refactors. Große Umbauten nur mit Label `epic` und explizitem Scope.
4. **Rate-Limits:** Max. X Agent-Läufe pro Stunde (konkret in Implementation Plan festlegen).
5. **Secrets:** `CURSOR_API_KEY`, `SCREEPS_TOKEN` nur als GitHub Secrets; Shard/Branch als Variables.

## 10. Phasenplan

| Phase | Ergebnis |
|---|---|
| 0 | Repo-Grundlagen, ADR, Spec (dieses Dokument) |
| 1 | Deploy-Pipeline GitHub → Screeps + Minimal-Bot live |
| 2 | Telemetrie + manuelles Issue → Agent → Deploy (Handy-Test, PC aus) |
| 3 | Auto-Issues bei Stagnation + Rollback-Pfad |
| 4 | 24/7-Cron dauerhaft aktiv |

## 11. Offene Parameter (bewusst in Implementation Plan)

- Konkrete Cron-Intervalle (Metriken / Evolution)
- Exakte Stagnations-Schwellen und Rollback-Schwellwerte
- Max. Agent-Läufe / Stunde
- Screeps Shard (Default oft `shard3`/`shard0` je Account — bei Setup festlegen)
- Konkretes Cursor-Modell für Cloud Agents

## 12. Erfolgskriterien (erster großer Test)

- Code liegt nur in GitHub; Deploy ohne manuellen Copy-Paste in den Screeps-Editor
- Issue vom Handy startet Agent-Lauf, obwohl kein Home-PC läuft
- Mindestens ein erfolgreicher Full-Loop: Issue → PR → Merge → Deploy → Metrik sichtbar
- Bei absichtlichem Break: Rollback stellt lauffähigen Stand wieder her
