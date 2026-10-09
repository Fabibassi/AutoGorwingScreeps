# Early RCL5 Aftercare (48h) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find the most efficient first ~48h after live hits RCL5 (W21N35 home-only), encode the winner, and apply it on live when RCL≥5.

**Architecture:** Keep climb winner `upgrade_rush` for RCL4→5. At RCL5, stop pausing hub build (2nd tower + extensions→30). Bench post-RCL5 modes from a live-like seed (15 ext, 1 tower, fat storage) over a ~48h tick window (~50k ticks @ ~3.2s/tick). Score: time to hub-ready (towers≥2 ∧ ext≥30), then RCL6 progress, then storage floor.

**Tech Stack:** Existing mockup harness (`ops/sim/harness.ts`), Vitest policy tests, GitHub Live Probe for live apply/verify.

---

### Task 1: Unpause hub build at RCL5

**Files:**
- Modify: `src/earlyGame/policy.ts` (`pauseExtSpam` gate + `stagedExtensionBuildCap` RCL≥5 full quota)
- Test: `tests/rcl5Mode.test.ts`, `tests/earlyGame.test.ts`

- [x] Fail: RCL5 + `upgrade_rush` must queue extensions (and allow roads)
- [x] Pass: `pauseExtSpam` only when `rcl < 5`
- [x] Keep: RCL4 + `upgrade_rush` still skips extensions
- [x] RCL≥5 unlocks full extension quota (else 5W gate freezes at ~15–20)

### Task 2: Post-RCL5 aftercare sim + bench

**Files:**
- Create: `ops/sim/rcl5Aftercare.ts`
- Create: `ops/sim/rcl5AftercareBench.ts`
- Modify: `ops/sim/harness.ts` (count `towers`)
- Modify: `package.json` scripts

- [x] Seed live-like RCL5 room (15 ext, 1 tower, ~100k storage, source + controller containers)
- [x] Run modes; record `tower2@`, `ext30@`, progress gained, storage
- [x] Bench ranking → `.sim-learn/rcl5-aftercare-bench.json`

#### Bench result (2026-10-09, 1 replicate, 50k ticks)

Evidence: `.sim-learn/rcl5-aftercare-bench.json` (`at=2026-10-09T22:31:08.440Z`).

| Rank | Mode | hub/ext30@ | tower2@ | progress gained | minStorage |
|------|------|------------|---------|-----------------|------------|
| 1 | **build_heavy** | **6619** | **1399** | 13474 | 97177 |
| 2 | hub_spend | 8159 | 1754 | 37428 | 90060 |
| 3 | fat_first | 9744 | 1733 | 52824 | 93102 |
| 4 | upgrade_rush | 10187 | 1746 | 56697 | 75122 |

**Winner for hub-first 48h:** `build_heavy` (fastest tower#2 + ext→30).  
`upgrade_rush` remains best for *reaching* RCL5; after level-up switch (or hub-wave builder boost).

Hub-wave quota (incomplete hub at RCL≥5): prefer **U=1 / B=4** (build_heavy shape) until towers≥2 ∧ extensions≥30.

### Task 3: Live apply when RCL5

- [ ] Probe until `rcl >= 5` (blocked while still RCL4)
- [x] Auto-arm `Memory.ags.rcl5Mode = "build_heavy"` at RCL≥5 when missing/`upgrade_rush` (`maybeArmRcl5AftercareMode` in main; sticky)
- [x] Ensure aftercare code is deployed to Screeps (PR #52 → main → Deploy Screeps success)
- [ ] Verify via Live Probe: tower#2 / ext climb, storage floor, no soft-lock
- [x] Live Probe prints `## Memory.ags.rcl5Mode / aftercare arm` for post-RCL5 verify

#### Live status (2026-10-09T23:09Z)

Probe [38002766116](https://github.com/Fabibassi/AutoGorwingScreeps/actions/runs/38002766116): **RCL4**, progress **341765**/405000, `rcl5Mode` absent, `aftercareArmed=false`. Cloud cron every 2h (`live-probe.yml`) + `.probe-summary.json` → single GitHub issue **RCL5 aftercare verify** when `rcl>=5`. Goal remains OPEN until RCL5 + `build_heavy` armed verified.

#### Live apply checklist (ready — waiting on RCL5)

1. Confirm bot binary on World includes hub-wave + auto-arm + RCL5 extension unpause (deploy from `main` after merge).
2. On first tick with `rcl >= 5`, main sets `rcl5Mode=build_heavy` once if still climb-default (no console needed). Explicit non-default modes are left alone.
3. Run GitHub **Live Probe** `room=W21N35` → expect `rcl5Mode=build_heavy`, builders≥3–4 while hub incomplete, tower sites/built → 2, extensions rising toward 30.
4. Optional: after hub-ready (`ext≥30` ∧ `towers≥2`), switch back to `upgrade_rush` or `hub_spend` for RCL6 progress (bench: upgrade_rush gained most progress after hub).

**Success metrics (48h window):** hub-ready ASAP without storage blackout; no soft-lock; progress toward RCL6 secondary.
