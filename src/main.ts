import { applyParsedMemoryReuse } from "./loop/memHack";
import { runConstruction } from "./construction";
import { runTowers } from "./defense/towers";
import { recoverTelemetryOnLoopError } from "./loop/recoverTelemetry";
import { healCreepRoles, pickHomeRoom } from "./room/queries";
import { runCreep } from "./roles";
import { maybeUpdateHealthCheck } from "./selfCheck";
import { runSpawn } from "./spawn";
import { logPlanStatusIfDue } from "./status";
import { tickTelemetry } from "./telemetry";
import { showCreepJob } from "./visuals";

function clearDeadCreepMemory(): void {
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }
}

export function loop(): void {
  let errorsThisTick = 0;
  let energyHarvestedThisTick = 0;
  const roadPolicySticky = Memory.ags?.roadPolicy;
  const abKnobSticky = Memory.ags?.abKnob;
  const abVariantSticky = Memory.ags?.abVariant;
  const profileSticky = Memory.ags?.profile;
  const rcl5ModeSticky = Memory.ags?.rcl5Mode;
  const idleBuilderUpgradeSticky = Memory.ags?.idleBuilderUpgrade;
  const storageBlackoutReserveSticky = Memory.ags?.storageBlackoutReserve;

  try {
    applyParsedMemoryReuse();
    clearDeadCreepMemory();
    healCreepRoles();

    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (room.controller?.my) {
        try {
          runConstruction(room);
        } catch (e) {
          errorsThisTick++;
          console.log(`construction ${name} error`, e);
        }
      }
    }

    for (const name in Game.spawns) {
      try {
        runSpawn(Game.spawns[name]);
      } catch (e) {
        errorsThisTick++;
        console.log(`spawn ${name} error`, e);
      }
    }

    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (!room.controller?.my) continue;
      try {
        runTowers(room);
      } catch (e) {
        errorsThisTick++;
        console.log(`towers ${name} error`, e);
      }
    }

    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      try {
        energyHarvestedThisTick += runCreep(creep);
        showCreepJob(creep);
      } catch (e) {
        errorsThisTick++;
        console.log(`creep ${name} error`, e);
      }
    }

    // Never use Game.rooms[0] — adjacent vision can make health report another room's
    // containersAtSources (live false 1/2 while W21N35 already had both seats).
    const room = pickHomeRoom(Game.rooms, Game.spawns);
    const rcl = room?.controller?.level ?? 1;
    const nextAgs = tickTelemetry({
      tick: Game.time,
      rcl,
      energyHarvestedThisTick,
      errorsThisTick,
      cpuUsed: Game.cpu.getUsed(),
      memory: Memory.ags,
    });
    // Mutate in place so memHack's cached Memory identity keeps ags writes.
    if (!Memory.ags) Memory.ags = nextAgs;
    else Object.assign(Memory.ags, nextAgs);
    // Preserve experiment knobs across telemetry rewrites.
    if (roadPolicySticky) Memory.ags.roadPolicy = roadPolicySticky;
    if (abKnobSticky) Memory.ags.abKnob = abKnobSticky;
    if (abVariantSticky) Memory.ags.abVariant = abVariantSticky;
    if (profileSticky) Memory.ags.profile = profileSticky;
    // Prefer mid-tick console injections over the tick-start snapshot.
    const rcl5ModeNow = Memory.ags?.rcl5Mode ?? rcl5ModeSticky;
    if (rcl5ModeNow) Memory.ags.rcl5Mode = rcl5ModeNow;
    if (idleBuilderUpgradeSticky !== undefined) {
      Memory.ags.idleBuilderUpgrade = idleBuilderUpgradeSticky;
    }
    if (storageBlackoutReserveSticky !== undefined) {
      Memory.ags.storageBlackoutReserve = storageBlackoutReserveSticky;
    }
    const withHealth = maybeUpdateHealthCheck(room, Memory.ags);
    if (withHealth && withHealth !== Memory.ags) {
      Object.assign(Memory.ags, withHealth);
    }
    if (roadPolicySticky) Memory.ags.roadPolicy = roadPolicySticky;
    if (abKnobSticky) Memory.ags.abKnob = abKnobSticky;
    if (abVariantSticky) Memory.ags.abVariant = abVariantSticky;
    if (profileSticky) Memory.ags.profile = profileSticky;
    const rcl5ModeKeep = Memory.ags?.rcl5Mode ?? rcl5ModeSticky;
    if (rcl5ModeKeep) Memory.ags.rcl5Mode = rcl5ModeKeep;
    if (idleBuilderUpgradeSticky !== undefined) {
      Memory.ags.idleBuilderUpgrade = idleBuilderUpgradeSticky;
    }
    if (storageBlackoutReserveSticky !== undefined) {
      Memory.ags.storageBlackoutReserve = storageBlackoutReserveSticky;
    }

    logPlanStatusIfDue(room, Memory.ags);
  } catch (e) {
    console.log("main loop error", e);
    const recovered = recoverTelemetryOnLoopError(Memory.ags);
    if (!Memory.ags) Memory.ags = recovered;
    else Object.assign(Memory.ags, recovered);
  }
}
