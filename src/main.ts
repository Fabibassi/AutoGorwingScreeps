import { runConstruction } from "./construction";
import { recoverTelemetryOnLoopError } from "./loop/recoverTelemetry";
import { runCreep } from "./roles";
import { runSpawn } from "./spawn";
import { logPlanStatusIfDue } from "./status";
import { tickTelemetry } from "./telemetry";
import { showCreepJob } from "./visuals";

export function loop(): void {
  let errorsThisTick = 0;
  let energyHarvestedThisTick = 0;

  try {
    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (room.controller?.my) {
        runConstruction(room);
      }
    }

    for (const name in Game.spawns) {
      runSpawn(Game.spawns[name]);
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

    logPlanStatusIfDue(room, Memory.ags);
  } catch (e) {
    console.log("main loop error", e);
    Memory.ags = recoverTelemetryOnLoopError(Memory.ags);
  }
}
