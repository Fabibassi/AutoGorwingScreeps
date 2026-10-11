# Defense Attack-Sim (RCL3–6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 16 Raid-Szenarien (RCL3–6 × probe/drain/smash/swarm) in der Mockup-Sim messen und Defense so nachschärfen, dass die Expected-Pass-Matrix aus der Spec hält — **ohne Live-Deploy**.

**Architecture:** Seeded Hub → Warmup → Invader-Creeps + Raider-AI → Outcome-Metriken. Defense-Änderungen nur gegen Unit-Tests + Bench-Zellen; Encoding sticky nur im Sim-Branch.

**Tech Stack:** TypeScript, screeps-server-mockup, vitest, bestehende [`ops/sim/harness.ts`](../../../ops/sim/harness.ts)-Patterns (`fillerHub` / `wipeRecovery`).

**Spec:** [`docs/superpowers/specs/2026-10-11-defense-attack-sim-design.md`](../specs/2026-10-11-defense-attack-sim-design.md)

## Global Constraints

- **No live deploy / no main merge** until user explicitly approves later.
- Expected pass matrix from Spec is the acceptance gate (not „alle 16 grün“).
- Prefer tower focus + combat refill + safe mode before new roles.
- Keep raid windows short (≤2k ticks/cell) so the matrix is runnable locally.
- Do not edit remote bakeoff plan or unrelated WIP.

## File map

| File | Role |
|------|------|
| `ops/sim/raidThreats.ts` | Threat defs, Invader body factories, expected-pass table |
| `ops/sim/attackRaid.ts` | Single-cell runner (seed hub, inject raid, score) |
| `ops/sim/attackRaidBench.ts` | Matrix driver → `.sim-learn/attack-raid-bench.json` |
| `ops/sim/harness.ts` | Shared helpers: `injectInvaderCreeps`, `addRaiderBot` (if needed) |
| `src/defense/towers.ts` | Tower targeting improvements |
| `src/defense/safeMode.ts` (new) | Safe-mode trigger helper |
| `src/defense/combatRefill.ts` (new) or hauler target hook | Prioritize tower fill under hostiles |
| `src/main.ts` | Wire safe-mode + keep `runTowers` |
| `tests/defenseTowers.test.ts` | Pure target-selection tests |
| `tests/defenseSafeMode.test.ts` | Safe-mode predicate tests |
| `package.json` | `sim:attack` / `sim:attack:bench` scripts |

---

### Task 1: Threat catalog + expected matrix (pure)

**Files:**
- Create: `ops/sim/raidThreats.ts`
- Test: `tests/raidThreats.test.ts`

**Interfaces:**
- Produces: `RaidThreatId`, `RclLevel`, `THREAT_IDS`, `expectedPass(rcl, threat)`, `buildThreatBodies(rcl, threat)`, `hubSeedSpec(rcl)`

- [ ] **Step 1: Write failing tests for expectedPass + body non-empty**

```ts
import { expectedPass, buildThreatBodies } from "../ops/sim/raidThreats";

test("RCL5 probe expected pass", () => {
  expect(expectedPass(5, "probe")).toBe(true);
});
test("RCL3 swarm expected fail-ok", () => {
  expect(expectedPass(3, "swarm")).toBe(false);
});
test("bodies scale", () => {
  expect(buildThreatBodies(5, "swarm").length).toBeGreaterThan(3);
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `npm test -- tests/raidThreats.test.ts`  
Expected: FAIL cannot find module

- [ ] **Step 3: Implement `raidThreats.ts` per Spec tables**

Export threat ids `probe|drain|smash|swarm`, RCL 3–6 hub seed counts (towers/ext/storage energy), body factories, `expectedPass` matching Spec matrix.

- [ ] **Step 4: Run tests — PASS**

Run: `npm test -- tests/raidThreats.test.ts`

- [ ] **Step 5: Commit**

```
feat(sim): add RCL3-6 raid threat catalog and expected pass matrix
```

---

### Task 2: Invader injection helpers in harness

**Files:**
- Modify: `ops/sim/harness.ts`
- Test: manual smoke in Task 3 (no unit test for DB insert if awkward); optional thin test via exported body→doc mapper

**Interfaces:**
- Consumes: mockup Invader user id `"2"` from `world.reset()`
- Produces: `injectInvaderCreeps(server, opts: { x,y, bodies: BodyPartConstant[][], room? })`, `countHostiles(server)`, `countSpawns(server)`

- [ ] **Step 1: Add `injectInvaderCreeps` inserting creep docs**

Creep doc fields (mockup): `type:"creep"`, `room`, `x`, `y`, `user:"2"`, `body` as `[{type, hits}]`, `hits`, `hitsMax`, `name`, `fatigue:0`, `spawning:false`. Place near room edge (e.g. `x=5,y=25`) pathing toward spawn `(25,25)`.

- [ ] **Step 2: Add counters `countObjectsByType` / hostiles-by-user**

- [ ] **Step 3: Smoke — tiny script or first attackRaid dry-run later**

- [ ] **Step 4: Commit**

```
feat(sim): inject Invader creeps for attack-raid scenarios
```

---

### Task 3: Raider AI (second user OR waypoint driver)

**Files:**
- Create: `ops/sim/raidAi.ts` (module source string OR tick driver)
- Modify: `ops/sim/harness.ts` if adding `addHostileUser`

**Interfaces:**
- Produces: `ensureRaiderUser(server)`, `raiderMainModule(threat)`, OR `driveHostilesToward(server, targetX, targetY)` fallback

- [ ] **Step 1: Prototype one probe cell manually**

Run a 100-tick experiment: inject 1 Invader `MA`, confirm defender `FIND_HOSTILE_CREEPS` sees it and tower attacks (console / room objects hits drop).

- [ ] **Step 2: Choose path that works on this mockup**

Prefer: active raider user + code that `moveTo(spawn)` + `attack`/`heal`/`dismantle`.  
Fallback: each tick update hostile `x/y` toward spawn in DB and rely on tower range checks — document which path won in plan footer.

- [ ] **Step 3: Encode chosen path in `raidAi.ts`

- [ ] **Step 4: Commit**

```
feat(sim): add raider AI driver for attack-raid cells
```

---

### Task 4: Single-cell runner `attackRaid.ts`

**Files:**
- Create: `ops/sim/attackRaid.ts`
- Modify: `package.json` — script `sim:attack`

**Interfaces:**
- Consumes: `hubSeedSpec`, `buildThreatBodies`, harness seed patterns from `fillerHub`/`rclSurvive`
- Produces: `runAttackRaidScenario(opts) → AttackRaidResult`

`AttackRaidResult` fields: `{ ok, expectedPass, rcl, threat, ticksRun, spawnAlive, rclHeld, hostilesClearedAt, recoveredAt, minTowerEnergy, friendlyLosses, safeModeFired, reason }`

- [ ] **Step 1: Seed hub by RCL** (towers/ext/storage/containers + bot modules)

Mirror energy/hits patterns from [`ops/sim/fillerHub.ts`](../../../ops/sim/fillerHub.ts) / [`ops/sim/rclSurvive.ts`](../../../ops/sim/rclSurvive.ts); RCL3 = 1 tower no storage; RCL4+ storage; RCL5/6 = 2 towers + ~30 ext.

- [ ] **Step 2: Warmup → inject at `raidAt` → score**

Warmup ~100 ticks (or seeded creeps). Inject threat. Run until hostiles gone or timeout. Then recovery window.

- [ ] **Step 3: CLI `--rcl 5 --threat probe --ticks 1500 --port 28800`

- [ ] **Step 4: Manual smoke one cell**

Run: `npm run sim:attack -- --rcl 5 --threat probe --ticks 800 --port 28800`  
Expected: finishes; JSON/log shows spawnAlive + outcome

- [ ] **Step 5: Commit**

```
feat(sim): add single-cell attackRaid scenario runner
```

---

### Task 5: Matrix bench + baseline run (no defense changes yet)

**Files:**
- Create: `ops/sim/attackRaidBench.ts`
- Modify: `package.json` — `sim:attack:bench`
- Output: `.sim-learn/attack-raid-bench.json`

**Interfaces:**
- Produces: ranking rows `{ key: "rcl5.probe", ok, expectedPass, matchExpectation, ... }`

- [ ] **Step 1: Bench loops RCL 3–6 × 4 threats** (concurrency 2, base-port 28800)

`matchExpectation = (ok === expectedPass)` — cell scores green if reality matches Spec expectation (including expected fails).

- [ ] **Step 2: Run baseline bench**

Run: `npm run sim:attack:bench`  
Write results JSON; paste summary table into this plan’s **Baseline footer**.

- [ ] **Step 3: Commit harness + baseline JSON (no production defense yet)**

```
chore(sim): baseline attack-raid matrix before defense iteration
```

---

### Task 6: Tower focus (TDD) until RCL5+ probe/drain improve

**Files:**
- Create: `tests/defenseTowers.test.ts`
- Modify: `src/defense/towers.ts` (extract pure `pickTowerTarget(hostiles)`)

**Interfaces:**
- Produces: `pickTowerTarget(hostiles: { id; hits; hitsMax; healParts }[]): Target | null`

- [ ] **Step 1: Failing tests** — prefer hostile with active HEAL when present; else lowest `hits/hitsMax`

- [ ] **Step 2: Implement minimal `pickTowerTarget` + wire `runTowers`

- [ ] **Step 3: Unit tests PASS; re-run subset `rcl5.drain`, `rcl5.probe`

- [ ] **Step 4: Commit**

```
fix(defense): focus towers on healers then weakest hostile
```

---

### Task 7: Combat refill priority under hostiles

**Files:**
- Create or modify: energy-target selection used by hauler/filler (grep `findEnergyTarget` / tower fill)
- Test: `tests/defenseCombatRefill.test.ts` (pure predicate)

**Interfaces:**
- Produces: when `hostiles.length > 0`, towers below threshold outrank normal fills

- [ ] **Step 1: Locate current tower refill path** (hauler/filler)

- [ ] **Step 2: TDD — hostile present ⇒ tower with lowest energy chosen before spawn/extension spam if tower `< 500`

- [ ] **Step 3: Re-run `rcl4.drain`, `rcl5.drain`

- [ ] **Step 4: Commit**

```
fix(defense): prioritize tower refill while hostiles present
```

---

### Task 8: Safe Mode trigger

**Files:**
- Create: `src/defense/safeMode.ts`
- Test: `tests/defenseSafeMode.test.ts`
- Modify: `src/main.ts` — call after/before towers

**Interfaces:**
- Produces: `shouldActivateSafeMode(input): boolean`  
  Inputs: spawn hits &lt; hitsMax, hostile count/range, `safeModeAvailable`, already active

- [ ] **Step 1: Failing tests for predicate**

- [ ] **Step 2: Implement + `controller.activateSafeMode()` when true

- [ ] **Step 3: Re-run smash cells RCL4–6 (expect more passes / fewer spawn losses)

- [ ] **Step 4: Commit**

```
feat(defense): activate safe mode when spawn is under raid pressure
```

---

### Task 9: Full matrix gate vs Expected Pass

**Files:**
- Re-run: `ops/sim/attackRaidBench.ts`
- Update: this plan footer **After-iteration**

- [ ] **Step 1: Full bench**

Run: `npm run sim:attack:bench`

- [ ] **Step 2: Gate**

For every cell: `ok === expectedPass`. If a **required** pass cell still fails, either tighten defense (still no new role unless necessary) or adjust Spec expectation with written rationale — do not silently greenwash.

- [ ] **Step 3: If only fail-ok cells fail — stop (success)**

- [ ] **Step 4: Commit bench JSON + plan footer**

```
chore(sim): attack-raid matrix meets expected pass gate
```

- [ ] **Step 5: Stop — do NOT deploy / merge main**

Open PR to feature branch only if user asks; default = local branch + report.

---

### Task 10 (optional backlog): Defender / ramparts

Only if Task 9 required-pass cells still fail after towers+refill+safeMode.

**Files:** TBD mini-plan — `src/roles/defender.ts` or spawn ramparts around spawn.

- [ ] **Step 1: Write separate mini-spec; do not expand this plan ad hoc**

---

## Baseline footer (Task 5 — 2026-10-11)

Source: `.sim-learn/attack-raid-bench.json` (ticks=1400, concurrency=2)

| Cell | ok | expected (initial) | match (initial) |
|------|----|--------------------|-----------------|
| rcl3.probe | ✅ | pass | OK |
| rcl3.drain | ✅ | fail-ok | MISS (better) |
| rcl3.smash | ✅ | fail-ok | MISS (better) |
| rcl3.swarm | ✅ | fail-ok | MISS (better) |
| rcl4.probe | ✅ | pass | OK |
| rcl4.drain | ✅ | pass | OK |
| rcl4.smash | ✅ | fail-ok | MISS (better) |
| rcl4.swarm | ✅ | fail-ok | MISS (better) |
| rcl5.probe | ✅ | pass | OK |
| rcl5.drain | ✅ | pass | OK |
| rcl5.smash | ✅ | pass | OK |
| rcl5.swarm | ✅ | pass | OK |
| rcl6.probe | ✅ | pass | OK |
| rcl6.drain | ✅ | pass | OK |
| rcl6.smash | ✅ | pass | OK |
| rcl6.swarm | ✅ | pass | OK |

**requiredFails:** none. Hostiles cleared @t81–88; minTower ≥920; safeMode never fired.  
Threat catalog is mild vs full towers — Spec expected matrix updated to all-pass.

## After-iteration footer

No defense-code changes required for the mild catalog (towers alone cleared all cells).

### Walls timing (2026-10-11) — `.sim-learn/walls-timing-bench.json`

Hard smash, **no towers** (isolate ramparts):

| Mode | Result | lived after raid |
|------|--------|------------------|
| **pre** (rampart seeded) | OK | **500t** (window) |
| **post** (`raid_only` arm) | FAIL spawn dead | **10t** |
| **off** | FAIL spawn dead | **10t** |

**Verdict: `POST_TOO_LATE`** — Mauern/Ramparts erst nach Hostile-Detection zu bauen rettet den Spawn nicht. Vorhalten (Economy-Arm RCL6+storage) oder Safe Mode.

**Live:** wallArm code on branch — not deployed until user asks.

---
