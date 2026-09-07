# ADR 0001: Autonomer Screeps-Bot — Cloud-First Ein-Repo-Loop

- Status: Accepted
- Datum: 2026-09-07
- Spec: [docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md](../superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md)

## Kontext

Wir wollen einen Screeps-World-Bot, der sich selbst überwacht und über GitHub Issues + Cursor Cloud Agents weiterentwickelt — 24/7, ohne Home-PC in der Runtime. Screeps pulled Code nicht aus GitHub; Deploy muss per API (GitHub Actions → Screeps) erfolgen.

## Entscheidung

1. **Ein Repo** für Bot (TypeScript), Ops-Tooling und GitHub Actions.
2. **GitHub** als Orchestrator (Issues, Cron, CI, Merge, Deploy, Rollback).
3. **Cursor Cloud Agents** (`CURSOR_API_KEY` / SDK) als Coding-Hirn.
4. **Sofort-Deploy** auf Screeps `default` nach grünem Merge; Sicherheit über CI + Auto-Rollback statt Canary.
5. **Einheitliche Issue-Pipeline** für manuelle und automatisch erzeugte Issues.
6. Metriken starten mit **Energy + Error-Rate**, später Komposit-Score.

## Konsequenzen

- Positiv: Handy-Issue triggert Evolution ohne lokalen Rechner; schneller Lern-Loop; eine Source of Truth.
- Negativ: Breaks auf `default` möglich → Rollback und Rate-Limits sind Pflicht.
- Follow-up: Implementation Plan für Phasen 1–4; Secrets und Schwellenwerte konkretisieren.
