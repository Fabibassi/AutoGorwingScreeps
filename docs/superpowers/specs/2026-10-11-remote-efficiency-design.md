# Remote Efficiency Design (Bakeoff)

> Spec 2026-10-11. RCL5→RCL6 stays home-only; remotes are a **post-RCL6** evidence campaign.

## Goal

Pick the **first remote wave** by measured net income, not folklore.

## Research (OSS / Wiki)

| Source | Takeaway |
|--------|----------|
| [screepspl.us Remote Harvesting](https://wiki.screepspl.us/Remote_Harvesting/) | Unreserved source = **5 e/t**; reserved = **10 e/t**. CLAIM/reserve cost + haul distance dominate. Unreserved efficiency turns negative around ~250 path tiles in their tables. |
| [Harabi — Selecting Remotes](https://sy-harabi.github.io/Optimizing-Early-Game-Part-One-Selecting-Remotes/) | Net = income − amortized miner/hauler/reserver spawn cost; **spawn parts/tick** is the scarce weight. |
| [TooAngel Design](https://github.com/TooAngel/screeps/blob/master/doc/Design.md) | Scout → reserver → sourcer + **container** → carry to home storage on fixed paths. |

**Hypothesis (to falsify in sim):** near `reserved_container` beats drop; far unreserved can beat expensive reserve.

## Bakeoff arms

| `remotePlan` | Behavior |
|--------------|----------|
| `off` / `home_only` | Control — no remote creeps |
| `drop_unreserved` | Remote miner drop-mine; haulers pick drops → home storage |
| `reserved_drop` | + reserver; drop-mine at 10 e/t |
| `reserved_container` | + reserver + container at source; haulers withdraw container |

## Gates (live + sim seed)

- Home **RCL ≥ 6**
- Storage floor ≥ ~20k (same family as hub benches)
- Home hub healthy (extensions capacity for spawn)
- **No** auto-arm during RCL5 climb (`rcl5` gameplan unchanged)

## Metrics

1. **Primary:** `netStorageDelta / tick` (end − start; fail if `minStorage < 20k`)
2. **Secondary:** mean home `energyAvailable`, spawn busy fraction
3. **Model cross-check:** `remoteEconomics.netEnergyPerTick` vs sim delta order

## Encode policy

- Production default: `remotePlan = off` until RCL6 arm fires
- Bakeoff winner (15k ticks, 2026-10-11): **`reserved_drop`** (best at mid haul; floorOk)
- `maybeArmRemotePlanPostRcl6` sticky-arms winner when RCL≥6 + storage ≥20k
- Explicit `off` / other sim arms skip overwrite

### Bakeoff ranking (floorOk first, then netPerTick)

| Rank | Key | netPerTick | floorOk |
|------|-----|------------|---------|
| 1 | **reserved_drop.mid** | **−2.24** | ✅ |
| 2 | reserved_container.mid | −2.64 | ✅ |
| 3 | reserved_drop.short | −2.74 | ✅ |
| 4 | drop_unreserved.mid | −2.87 | ✅ |
| 5 | reserved_container.short | −4.02 | ✅ |
| — | off.* / drop.short | −6 | ❌ |

Note: all arms spent storage (home upgrade/spawn); remotes slowed the drain vs home_only collapse. Re-run with warmer home seed before live expand.

### Variant tune on winner (`reserved_drop` × mid, 12k)

| Rank | variant | netPerTick | floorOk |
|------|---------|------------|---------|
| 1–2 | **baseline** / fat_haul (tie) | **−1.75** | ✅ |
| 3 | fat_hauler | −1.87 | ✅ |
| 4 | fat_miner | −1.88 | ✅ |
| 5 | lean_haul | −2.35 | ✅ |
| 6 | dual_claim | −2.49 | ✅ |
| 7 | thin_hauler | −2.50 | ✅ |

**Verdict:** no clear beat over baseline — keep `remoteVariant=baseline` (default). Fat haulers / dual CLAIM / lean haul did not help.

## Out of scope

Source keepers, minerals, market, multi-remote DP picker, claiming new GCL rooms, live expand during RCL5→6.
