# Defense Attack-Sim Design (RCL3–6)

> Spec 2026-10-11. **Defense-driven:** Sims + Code iterieren, bis die erwartete Pass-Matrix hält.  
> **Constraint:** kein Live-Deploy / kein main-merge in dieser Kampagne (Branch + Sim only).

## Goal

Messbar machen, was bei Raids auf dem Hub passiert (RCL3–6), und Defense so nachschärfen, dass **erwartete** Szenarien bestehen — nicht „alles halten“.

## Current state

- Defense = [`src/defense/towers.ts`](../../../src/defense/towers.ts): closest hostile → heal → repair roads/containers.
- Kein Safe-Mode-Trigger, kein Combat-Refill-Boost, keine Defender-Rolle, keine Attack-Sim.
- Sims seeden Towers oft nur als Bauziel (friedlich).

## Threat matrix (4 × RCL3–6 = 16 cells)

Jeder Cell: geseedeter Hub am Ziel-RCL → Warmup → Raid-Injection → Outcome.

| Threat | Intent | Body-Skizze (skaliert mit RCL) |
|--------|--------|--------------------------------|
| `probe` | Single cheap poke; Tower sollte gewinnen | 1× `MA` / `MAA` |
| `drain` | Tower-Energy ausbluten (heal tank) | 1–2× `THHM` kite nahe Tower-Range |
| `smash` | Spawn/Tower-Struktur-DPS | 1× `WWM` dismantle oder `AAAM` attack spawn |
| `swarm` | Many small bodies overload focus | 4–8× `MA` gestaffelt |

RCL-Skalierung (Richtwert):

| RCL | Towers (seed) | Hub seed | Threat-Budget |
|-----|---------------|----------|---------------|
| 3 | 1 | Ext~10, containers, spawn energy | klein |
| 4 | 1 | + storage ≥20k | mittel |
| 5 | 2 | Ext~30, storage ≥50k, filler/miners | mittel–hoch |
| 6 | 2 | wie RCL5 + RCL6 controller | hoch (gleiche Tower-Cap wie 5) |

## Expected pass matrix (acceptance)

Initial conservative guess had fail-ok at RCL3–4 for drain/smash/swarm.
**Baseline bench 2026-10-11** (seeded hub, full tower energy): **all 16 cells passed**
(hostiles cleared in ~1–8 ticks, economy recovered). Updated expectation:

| | probe | drain | smash | swarm |
|---|-------|-------|-------|-------|
| RCL3 | pass | pass | pass | pass† |
| RCL4 | pass | pass | pass | pass† |
| RCL5 | pass | pass | pass | pass† |
| RCL6 | pass | pass | pass | pass† |

† „pass“ = Spawn lebt + Economy erholt sich nach Hostile-Clear; nicht zwingend 0 Creep-Verluste.  
Follow-up: härtere Bodies / echte Drain-Kite, falls Live-Raids schwerer sind als dieser Catalog.

## Pass / Fail metrics (per cell)

Primary (hard fail):

1. Spawn destroyed → **fail**
2. Controller lost / RCL downgrade → **fail**
3. Nach Hostile-Clear: kein Economy-Creep (`miner|harvester|filler`) für `RECOVERY_DEAD` Ticks → **fail**

Secondary (report only):

- Ticks to clear hostiles
- Min tower energy / min `energyAvailable`
- Friendly creeps lost
- Safe-mode fired? (yes/no)
- Storage delta during raid window

## Sim architecture

```
ops/sim/attackRaid.ts          # single cell runner
ops/sim/attackRaidBench.ts     # 16-cell matrix + JSON ranking
ops/sim/raidThreats.ts         # threat defs + Invader body factories
src/defense/*                  # production defense (iterated)
tests/defense*.test.ts         # unit tests for pure helpers
```

**Hostile injection:** Mockup `reset()` legt User `Invader` (`_id: "2"`) an. Creeps via `rooms.objects.insert` mit `user: "2"`. Raider-AI = zweiter Bot **ohne** Controller-Claim: eigener User + `users.code` Main-Loop (move→attack/heal/dismantle). Falls Code für non-owner User nicht tickt: Fallback = DB-gesteuerte Waypoints pro Tick (Harness bewegt Hostiles Richtung Spawn).

**Warmup:** 50–200 Ticks Economy laufen lassen (oder geseedete Creeps + volle Towers), dann Raid bei `t=raidAt`.

**Duration:** Raid-Fenster ~500–1500 Ticks + Recovery-Fenster ~500 Ticks (kurz halten; Matrix parallelisierbar).

## Defense iteration order (encode only what sims prove)

1. **Tower focus** — nicht nur closest: healers/drainers priorisieren oder lowest-hits focus (Unit-Tests).
2. **Combat refill** — bei `FIND_HOSTILE_CREEPS > 0` Towers vor normalen Fills priorisieren (Hauler/Filler Target).
3. **Safe Mode** — bei Spawn-Hits oder mass Hostile + Spawn bedroht: `controller.activateSafeMode()` wenn verfügbar.
4. **Nur falls Matrix noch failt:** minimale Defender-Quota oder Rampart-Seed am Spawn (separater Mini-Plan).

Kein Live-Arm, kein sticky Memory auf Production, bis explizit freigegeben.

## Out of scope

- Player PvP strategy / remote defense
- RCL7+ (3. Tower) / bunker layout overhaul
- Nuke / stronghold
- Live Deploy, main merge, Memory-Arm auf home room

## Deliverables

1. Design (dieses File) + Implementation Plan
2. Bench JSON unter `.sim-learn/attack-raid-bench.json`
3. Defense-Code + Tests bis Expected-Pass-Zellen grün
4. Kurzer Report in Plan-Footer (Pass-Matrix Ist vs Soll)
