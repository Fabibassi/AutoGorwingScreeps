import { applyParsedMemoryReuse } from "./loop/memHack";
import { runConstruction } from "./construction";
import { runTowers } from "./defense/towers";
import { recoverTelemetryOnLoopError } from "./loop/recoverTelemetry";
import { healCreepRoles } from "./room/queries";
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

    const room = Object.values(Game.rooms)[0];
    const rcl = room?.controller?.level ?? 1;
    Memory.ags = tickTelemetry({
      tick: Game.time,
      rcl,
      energyHarvestedThisTick,
      errorsThisTick,
      cpuUsed: Game.cpu.getUsed(),
      memory: Memory.ags,
    });
    // Preserve experiment knobs across telemetry rewrites.
    if (roadPolicySticky) Memory.ags.roadPolicy = roadPolicySticky;
    if (abKnobSticky) Memory.ags.abKnob = abKnobSticky;
    if (abVariantSticky) Memory.ags.abVariant = abVariantSticky;
    if (profileSticky) Memory.ags.profile = profileSticky;
    Memory.ags = maybeUpdateHealthCheck(room, Memory.ags) ?? Memory.ags;
    if (roadPolicySticky) Memory.ags.roadPolicy = roadPolicySticky;
    if (abKnobSticky) Memory.ags.abKnob = abKnobSticky;
    if (abVariantSticky) Memory.ags.abVariant = abVariantSticky;
    if (profileSticky) Memory.ags.profile = profileSticky;

    logPlanStatusIfDue(room, Memory.ags);
  } catch (e) {
    console.log("main loop error", e);
    Memory.ags = recoverTelemetryOnLoopError(Memory.ags);
  }
}
