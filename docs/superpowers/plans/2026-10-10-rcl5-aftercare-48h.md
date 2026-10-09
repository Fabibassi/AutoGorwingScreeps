# Early RCL5 Aftercare (48h) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find the most efficient first ~48h after live hits RCL5 (W21N35 home-only), encode the winner, and apply it on live when RCL≥5.

**Architecture:** Keep climb winner `upgrade_rush` for RCL4→5. At RCL5, stop pausing hub build (2nd tower + extensions→30). Bench post-RCL5 modes from a live-like seed (15 ext, 1 tower, fat storage) over a ~48h tick window (~50k ticks @ ~3.2s/tick). Score: time to hub-ready (towers≥2 ∧ ext≥30), then RCL6 progress, then storage floor.

**Tech Stack:** Existing mockup harness (`ops/sim/harness.ts`), Vitest policy tests, GitHub Live Probe for live apply/verify.

---

### Task 1: Unpause hub build at RCL5

**Files:**
- Modify: `src/earlyGame/policy.ts` (`pauseExtSpam` gate)
- Test: `tests/rcl5Mode.test.ts`

- [ ] Fail: RCL5 + `upgrade_rush` must queue extensions (and allow roads)
- [ ] Pass: `pauseExtSpam` only when `rcl < 5`
- [ ] Keep: RCL4 + `upgrade_rush` still skips extensions

### Task 2: Post-RCL5 aftercare sim + bench

**Files:**
- Create: `ops/sim/rcl5Aftercare.ts`
- Create: `ops/sim/rcl5AftercareBench.ts`
- Modify: `ops/sim/harness.ts` (count `towers`)
- Modify: `package.json` scripts

- [ ] Seed live-like RCL5 room (15 ext, 1 tower, ~100k storage, 2 source containers)
- [ ] Run modes; record `tower2@`, `ext30@`, progress gained, storage
- [ ] Bench ranking → `.sim-learn/rcl5-aftercare-bench.json`

### Task 3: Live apply when RCL5

- [ ] Probe until `rcl >= 5`
- [ ] Deploy winner settings (policy already unpauses; set `Memory.ags.rcl5Mode` if bench prefers non-default)
- [ ] Verify via Live Probe: tower sites/built, extension climb, no economy collapse

**Success metrics (48h window):** hub-ready ASAP without storage blackout; no soft-lock; progress toward RCL6 secondary.