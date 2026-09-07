import type { AgsMemory } from "../types";
import { tickTelemetry } from "../telemetry";

/** Recover telemetry state when the main loop throws before tickTelemetry runs. */
export function recoverTelemetryOnLoopError(
  memory: AgsMemory | undefined,
): AgsMemory {
  if (!memory) {
    return {
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
  }

  return tickTelemetry({
    tick: Game.time,
    rcl: memory.metrics.rcl,
    energyHarvestedThisTick: 0,
    errorsThisTick: 1,
    cpuUsed: Game.cpu.getUsed(),
    memory,
  });
}
