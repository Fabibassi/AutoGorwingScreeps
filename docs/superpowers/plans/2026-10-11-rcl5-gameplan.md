# RCL5-Phase Gameplan → Endziel RCL6

> Morgen-Deliverable (Overnight 2026-10-10/11).  
> Design-Spec: `docs/superpowers/specs/2026-10-11-rcl5-gameplan-design.md`  
> Live: home room — Hub fertig, `rcl5Mode=fat_first`, Storage ~170k.

## Verdict (Confirm 160k — fertig)

**RCL5-Gameplan = `link_boost` (Storage↔Controller Links) → Endziel RCL6.**  
`fat_first` bleibt die Quota nach Hub; ohne Links ist der Push langsamer.

| Arm (160k confirm) | RCL6 @ | rate | minStorage | Ergebnis |
|--------------------|--------|------|------------|----------|
| **fat_first+link_boost** | **132 378** | **9.18** | 75 926 | **Winner** |
| fat_first+fat_first (no links) | — (p=1 126 114) | 7.04 | 76 706 | ETA ~173k, kein RCL6 in 160k |

**Live:** Deploy main + sticky `Memory.ags.rcl5Plan=link_boost` (Code: PR [#60](https://github.com/Fabibassi/AutoGorwingScreeps/pull/60); Arming nach Confirm).

### Filler-Größe (hub bench 20k + live override)

Sim: `thin` gewann auf floorOk. **Live** (Probe 2026-10-11): hub≈162 bei storage≈120k mit 1× thin → Softlock. **Live-Arm = `fat`.**

| Plan | ok | floorOk | starveMedian | meanHub | minStorage |
|------|----|---------|--------------|---------|------------|
| thin (sim) | 1/1 | ✅ | **418** | 1273 | 73 046 |
| fat (sim) | 0/1 | ❌ | 802 | 1239 | 0 |
| duo_fat (sim) | 0/1 | ❌ | 2352 | 999 | 0 |

Live: sticky `Memory.ags.fillerPlan=fat` (auto-arm nach Hub; thin/duo nur Sim).

| Priorität | Was | Warum |
|-----------|-----|--------|
| P0 done | Hub: 30 Ext + 2 Towers | RCL5 Cap + Defense; live erledigt |
| **P1 next** | **2 Links: Storage + Controller** | RCL5-Feature; cut Hauler-Travel; static Upgrader |
| P2 | Link-Pipeline + Upgrader am Controller-Link | Stable EPT ohne Storage-Blackout |
| P3 | Controller → RCL6 (1 215 000) | Endziel dieser Phase |
| P4 later | RCL6-Unlocks (Terminal, Extractor, …) | **Nicht** RCL5-Scope |

---

## 1. Was wir in RCL5 erreichen **müssen**

1. **Hub-ready** — 30 Extensions, ≥2 Towers, Storage aktiv. ✅ live  
2. **Link-Pair** — genau die 2 erlaubten Links:
   - **Storage-Link** (neben Storage / Filler-Spot)
   - **Controller-Link** (Range ≤2 zum Controller)
3. **Energie-Pipeline** Storage → Storage-Link → Controller-Link → Upgrader  
4. **Fat mining bleibt** — Miner mit vollem WORK (5W/Source-Seat), keine 2W-Bridge-Regression  
5. **Storage-Floor** ≥ ~20k während des Push (Wave-2: `upgrade_rush` ohne Floor = Blackout)  
6. **RCL6 hit** — Controller Progress 1 215 000

**Explizit nicht müssen (RCL5):** Remotes, Walls-max, Mineral/Extractor, Terminal, Labs, 2. Spawn, Market.

---

## 2. Was wir erreichen **wollen** (Qualität)

- Minimale **Ticks hub-ready → RCL6** (Primary Metric)  
- Weniger Hauler-CPU/Spawn-Druck als reiner Storage-Walk  
- Stabile Upgrader (idle am Controller, Withdraw vom Link)  
- Keine Construction-Stalls (0-Sites-Lücke wie Ext-Stall #58 vermeiden)  
- Live-Parity: Sim-Winner als `rcl5Plan` / Mode enkodieren und deployen

---

## 3. Phasenplan (ausführbar)

### Phase A — Hub (done)
- Mode: `build_heavy` bis Ext≥30 ∧ Towers≥2  
- Danach auto: `fat_first` (aktueller Live-State)

### Phase B — Link CAPEX (nächster Code-Ship)
1. Construction Sites für 2 Links platzieren (Stamp + Fallback-Tiles)  
2. Quotas kurz builder-lastig bis beide Links **fertig** (nicht nur Sites)  
3. Keine Extension-/Road-Spam (`rcl5ModePausesExtensionSpam` bleibt)  
4. Erfolgskriterium: `linksBuilt ≥ 2`

### Phase C — Link Boost Upgrade
1. Jeder Tick: `storageLink.transferEnergy(controllerLink)` wenn Cooldown frei und Controller-Link unter Threshold  
2. Filler/Hauler: Storage → Storage-Link nachfüllen  
3. Upgrader: Prefer Withdraw Controller-Link → sonst Storage/Container  
4. Quotas: ~3 Upgrader (wie fat_first) solange Storage ≥ Floor; bei Low-Energy Upgrader drosseln  
5. Erfolgskriterium: progress rate ≥ fat_first-Baseline **und** minStorage ≥ 20k

### Phase D — Finish RCL6
1. Keine neuen CAPEX außer Repair/Defense-Notfall  
2. Bei Storage &lt; Floor: Upgrader−1, Mining/Fill priorisieren  
3. Bei RCL6: Mode clear / RCL6-Plan arm (Terminal-Site vorbereiten — separates Doc)

---

## 4. Evidenz (Research)

| Quelle | Takeaway |
|--------|----------|
| [screepspl.us RCL](https://wiki.screepspl.us/Room_Control_Level/) | RCL5 = Links; Effizienz durch weniger Hauler |
| [StructureLink wiki](https://wiki.screepspl.us/StructureLink/) | Storage-Link + Controller-Link; Type-to-type: storage→controller |
| [TooAngel Design](https://github.com/TooAngel/screeps/blob/HEAD/doc/Design.md) | Links transferieren zum Storage-Link; Upgrader aus Storage; Filler aus Link |
| [TooAngel BaseBuilding](https://github.com/TooAngel/screeps/blob/HEAD/doc/BaseBuilding.md) | Layout: Upgrader@Controller, Storage daneben, Link beim Filler; Source-Links |
| Overmind Bunkers | Zentral-Link + Manager — RCL8-Muster; Idee „Hub-Link“ überträgt |
| AGS Wave-2 Sim | `fat_first` ≈155k → RCL6, Floor OK; `upgrade_rush` Storage 0 |

**AGS-Entscheidung bei nur 2 Links:** Storage + Controller (nicht Source+Storage).  
Begründung: Upgrade-Sink ist der Bottleneck nach Hub; Hauler Source→Storage laufen bereits; größter Hebel ist Controller-Feed ohne Walk.

---

## 5. Sim-Matrix (Overnight)

| ID | Ansatz | Wave-1 (50k) | Confirm (160k) |
|----|--------|--------------|----------------|
| A | `fat_first` (no links) | rate 7.22, ETA ~168k | kein RCL6; ETA ~173k |
| **C** | **`link_boost`** | rate 8.70, ETA ~140k | **RCL6 @ 132 378** |
| B | `upgrade_pressure` | deferred | nicht nötig |

**Ranking (locked):** Floor-OK → niedrigstes `ticks_to_rcl6` → progress/tick → minStorage.

Status-Pull: `.sim-learn/rcl5-gameplan-status.json`  
CLI: `npm run sim:rcl5:gameplan`

---

## 6. Live-Checkliste (morgen)

- [x] Code: Placement + `runLinks` + Upgrader-Prefer (PR #60)  
- [x] Confirm 160k: `link_boost` → RCL6 @132 378 (Baseline ohne Links: kein RCL6)  
- [ ] Deploy Screeps; `rcl5Plan=link_boost` sticky arm after hub  
- [ ] Probe: 2 Links built, Transfers sichtbar, Progress-Rate vs Pre-Deploy  
- [ ] Storage nicht unter 20k für &gt;N Ticks  
- [ ] RCL6 erreichen → RCL6-Gameplan öffnen

---

## 7. Definition of Done (RCL5-Phase)

| Check | Status |
|-------|--------|
| Hub 30+2 | ✅ |
| 2 Links code | ✅ (#60) |
| 2 Links live | ❌ (Deploy morgen) |
| Link-Pipeline live | ❌ |
| Sim-Winner encoded | ✅ `link_boost` (160k confirm) |
| RCL6 | ❌ live / ✅ sim @132k |

---

## 8. Offene Risiken

- Placement kollidiert mit Stamp/Walkways → Fallback wie Ext #58  
- Link-CAPEX verzögert Progress kurzfristig — Sim misst **Netto**-Ticks inkl. Bau  
- Mockup-Link-Cooldown ungenau → Live-Verify Pflicht  
- `fat_first` bleibt sicherer Fallback wenn Link-Sim nicht schlägt

---

*Overnight schreibt Sim-Ranking in Abschnitt 5 / Status-JSON nach; dieses Doc ist der Gameplan-Rahmen für die RCL5-Phase mit Endziel RCL6.*
