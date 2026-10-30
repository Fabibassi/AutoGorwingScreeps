# Defense mode bakeoff (flee | clear | refill | safemode)

Knob: `Memory.ags.defenseMode`

| Arm | Clearer spawn | Remote economy | Notes |
|-----|---------------|----------------|-------|
| `flee` | no | pause on threat | baseline #88 |
| `clear` | yes (storage ≥ floor+2k) | pause while threat; clearer still spawns | **default** |
| `refill` | no | pause | home tower refill only |
| `safemode` | no | pause | relies on `maybeActivateSafeMode` |

## RCL7 hit order bakeoff

Knob: `Memory.ags.rcl7BuildOrder`

| Arm | Next structure priority |
|-----|-------------------------|
| `ext_first` | Ext → Tower → Spawn → Link (**default**) |
| `tower_first` | Tower → Ext → Spawn → Link |
| `spawn_first` | Spawn → Ext → Tower → Link |

Pure decision coverage: `tests/invaderClear.test.ts`, `tests/rcl7Hit.test.ts`.
Full mockup arms can set the Memory knobs via harness `bot.memory` like other sims.
