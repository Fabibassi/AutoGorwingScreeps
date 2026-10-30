# RCL7 Roadmap + Backlog Waves (2026-10-30)

> Goal: encode priorities for RCL6→7 finish and RCL7 hit. Factory **not** first.

## Live baseline (RCL6)

- Hub CAPEX mostly done (terminal/extractor/links); remotes + threat flee live.
- `wallsArmed` sticky true, but hub ramparts often missing — builders must prioritize `rampart` sites.
- No `STRUCTURE_WALL` ring yet (by design until after hub ramparts + stable storage).

## Wave C — Hub defense shell (now)

1. **Hub ramparts** on spawn (+ storage) as soon as `wallsArmed` (economy ≥20k or raid sticky).
2. Builders treat `rampart` / `terminal` / `link` / `extractor` as hub CAPEX (not starved by extension filter).
3. **Wall ring** only after `hubRampartsReady` and storage sustainably above floor (defer to late RCL6 / early RCL7).

## Wave B — Defense reactions

| Priority | Item | When |
|----------|------|------|
| 1 | Tower combat-refill on hostiles | Home hostiles > 0 |
| 2 | Safe Mode on spawn damage / mass hostiles | Safe modes remaining |
| 3 | NPC Invader clear (cheap ATTACK) | Remote threat + storage ≥ floor+2k |
| 4 | Sim bakeoff: flee \| clear \| refill \| safemode | Before locking clear policy |
| 5 | Scout/probe response | After clear+safemode proven |

## Wave A — Terminal / mineral / market

1. Mineral miner + haul → terminal (extractor exists).
2. Market sell / `terminal.send` only with storage+terminal energy floors.
3. Labs after mineral flow stable (not RCL7 day-1).

## Wave D — RCL7 hit order (progress-first)

Unlocks at RCL7: **50 extensions (100 cap)**, **3 towers**, **2 spawns**, **4 links**, **6 labs**, **factory**.

Recommended build order after RCL7:

1. **10 extensions** (40→50) — immediate bigger bodies / spawn throughput  
2. **Tower #3** — defense before second spawn cost  
3. **Spawn #2** — double spawn queue (remotes + clear + builders)  
4. **Link #4** — logistics polish  
5. Labs / factory / wall ring — after hub stable  

If sims disagree: run `Spawn-first` vs `Tower-first` vs `Ext-first` bakeoff; default **Ext → Tower → Spawn**.

## Wave E — Next big leaps (after RCL7 hub)

1. Second remote (income)  
2. Labs + basic boosts (upgrade/build/attack)  
3. GCL expand / second room  
4. Factory commodities — only with market credits + idle CPU  

## Explicit non-goals (now)

- Factory-first  
- Full PvP / stronghold clear  
- Remote towers  
