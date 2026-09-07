import { runConstruction } from "./construction";
import { runBuilder } from "./roles/builder";
import { runHarvester } from "./roles/harvester";
import { runHauler } from "./roles/hauler";
import { runMiner } from "./roles/miner";
import { runUpgrader } from "./roles/upgrader";
import { runSpawn } from "./spawn";
import { tickTelemetry } from "./telemetry";

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
        switch (creep.memory.role) {
          case "harvester":
            energyHarvestedThisTick += runHarvester(creep);
            break;
          case "miner":
            energyHarvestedThisTick += runMiner(creep);
            break;
          case "hauler":
            runHauler(creep);
            break;
          case "builder":
            runBuilder(creep);
            break;
          case "upgrader":
            runUpgrader(creep);
            break;
        }
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
  } catch (e) {
    console.log("main loop error", e);
    if (!Memory.ags) {
      Memory.ags = {
        metrics: {
          tick: Game.time,
          rcl: 1,
          energyIncomePerTick: 0,
          errorCount: 1,
          cpuUsedAvg: Game.cpu.getUsed(),
          updatedAt: Game.time,
        },
        incomeSamples: [],
        incomeWindows: [],
        errorSamples: [1],
        lastErrors: 1,
      };
    } else {
      Memory.ags = tickTelemetry({
        tick: Game.time,
        rcl: Memory.ags.metrics.rcl,
        energyHarvestedThisTick: 0,
        errorsThisTick: 1,
        cpuUsed: Game.cpu.getUsed(),
        memory: Memory.ags,
      });
    }
  }
}
