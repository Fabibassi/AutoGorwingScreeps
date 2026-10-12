# RCL5 → RCL6 Gameplan Design

> Overnight research design (2026-10-10/11). Morning deliverable companion: `docs/superpowers/plans/2026-10-11-rcl5-gameplan.md`.

## Context (live home)

- Hub-ready **done**: 30 ext, 2 towers, storage fat, `rcl5Mode=fat_first`.
- `fat_first` is a **quota default** (≈3 upgraders), not a full midgame plan.
- RCL5 unlock that AGS does **not** use yet: **2 Links**.
- End goal of this phase: **RCL6** (1 215 000 controller progress) home-only.

## Research synthesis

| Source | RCL5 takeaway |
|--------|----------------|
| Screeps docs / screepspl.us | RCL5 = Links; efficiency unlock by cutting hauler travel |
| StructureLink wiki | Patterns: storage / controller / source links; RCL5 only has **2** |
| TooAngel Design/BaseBuilding | Auto layout; source→storage link transfers; filler at storage link |
| ralphschuler upgrader doc | Controller link = highest priority for static upgraders |
| Adam Laycock bunker series | RCL5: core/storage link + second by distance (controller or source) |
| screeps-foreman planner | Explicit controller-link + source-link layers in RCL plan |
| Prior AGS Wave-2 sim | `fat_first` ~155k ticks to RCL6, storage OK; `upgrade_rush` blackout |

**Consensus gameplan shape (OSS + wiki):**

1. Finish hub (AGS: done).
2. Build **controller link + storage (or source) link** — the RCL5 feature.
3. Run **storageLink → controllerLink** feed; static/near-controller upgraders.
4. Push controller to RCL6; defer remotes/walls-first/minerals (RCL6 terminal/extractor).

## Success criteria (locked for sims)

1. **Primary:** minimize `ticks_to_rcl6` from hub-ready seed.
2. **Hard gate:** `minStorage ≥ 20_000`.
3. **Secondary:** mean upgrade EPT; hauler spawn pressure (tiebreak).
4. **Scope:** home-only; no remotes; no wall maxhits race.

## Approaches to validate overnight

| ID | Approach | Hypothesis |
|----|----------|------------|
| A | **fat_first** (status quo) | Baseline ~155k; safe bank; no link CAPEX |
| B | **upgrade_pressure** (U=4, storage floor) | Faster if bank holds; Wave-2 suggested blackout without floor |
| C | **link_boost** (build 2 links Storage↔Controller, then upgrade) | Community default; should beat A if pipeline works |

Winner rule: lowest `ticks_to_rcl6` among floor-OK runs → encode as live `rcl5Plan`.

## Out of scope (RCL6+)

Terminal, extractor, labs, remotes, market, second spawn — planned only as “after RCL6 unlock” notes, not RCL5 deliverables.

## Risks

- Link placement fails on stamp/walkway rules (same class of bug as ext stall) → need fallback spots.
- Link CAPEX delays progress if builders starve upgrade too long → sim must measure net ticks including build.
- Mockup may imperfectly model link cooldown/transfer — treat ranking as directional; verify live.
