import { runHarvester } from "./roles/harvester";
import { runUpgrader } from "./roles/upgrader";
import { runSpawn } from "./spawn";
import { logPlanStatusIfDue } from "./status";
import { tickTelemetry } from "./telemetry";

export function loop(): void {
  let errorsThisTick = 0;
  let energyHarvestedThisTick = 0;

  try {
    for (const name in Game.spawns) {
      runSpawn(Game.spawns[name]);
    }

    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      try {
        if (creep.memory.role === "harvester") {
          energyHarvestedThisTick += runHarvester(creep);
        } else if (creep.memory.role === "upgrader") {
          runUpgrader(creep);
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

    logPlanStatusIfDue(room, Memory.ags);
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
