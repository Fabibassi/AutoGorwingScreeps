export const MAX_SAMPLES = 100;
export const STAGNATION_THRESHOLD_PCT = 0.05;
export const ROLLBACK_INCOME_DROP = 0.3;
export const ROLLBACK_ERROR_COUNT = 10;

export function recordEnergySample(
  samples: number[],
  sample: number,
  maxSamples: number = MAX_SAMPLES,
): number[] {
  const next = samples.concat(sample);
  return next.length > maxSamples ? next.slice(next.length - maxSamples) : next;
}

export function average(samples: number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/** Last N window averages; stagnant if length>=4 and max/min within threshold of mean. */
export function isStagnant(windows: number[], thresholdPct: number): boolean {
  if (windows.length < 4) return false;
  const recent = windows.slice(-4);
  const avg = average(recent);
  if (avg === 0) return true;
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  return (max - min) / avg <= thresholdPct;
}

/** Income at or below rollback threshold vs baseline (includes zero). */
export function isIncomeStalled(
  currentIncome: number,
  baselineIncome?: number,
): boolean {
  if (currentIncome <= 0) return true;
  if (!baselineIncome || baselineIncome <= 0) return false;
  return currentIncome <= baselineIncome * (1 - ROLLBACK_INCOME_DROP);
}

export function shouldRollback(
  currentIncome: number,
  baselineIncome: number,
  errorCount: number,
): boolean {
  if (errorCount >= ROLLBACK_ERROR_COUNT) return true;
  if (baselineIncome <= 0) return false;
  return isIncomeStalled(currentIncome, baselineIncome);
}

export function tickTelemetry(opts: {
  tick: number;
  rcl: number;
  energyHarvestedThisTick: number;
  errorsThisTick: number;
  cpuUsed: number;
  memory: import("./types").AgsMemory | undefined;
}): import("./types").AgsMemory {
  const prev = opts.memory ?? {
    metrics: {
      tick: 0,
      rcl: 0,
      energyIncomePerTick: 0,
      errorCount: 0,
      cpuUsedAvg: 0,
      updatedAt: 0,
    },
    incomeSamples: [],
    incomeWindows: [],
    errorSamples: [],
    lastErrors: 0,
  };

  const incomeSamples = recordEnergySample(
    prev.incomeSamples,
    opts.energyHarvestedThisTick,
  );
  const energyIncomePerTick = average(incomeSamples);
  const errorSamples = recordEnergySample(
    prev.errorSamples ?? [],
    opts.errorsThisTick,
    100,
  );
  // Window = sum of errors in last ~100 ticks (not lifetime)
  const errorCount = errorSamples.reduce((a, b) => a + b, 0);
  const lastErrors = prev.lastErrors + opts.errorsThisTick;
  const cpuUsedAvg = average([prev.metrics.cpuUsedAvg || opts.cpuUsed, opts.cpuUsed]);

  let incomeWindows = prev.incomeWindows;
  if (opts.tick > 0 && opts.tick % 100 === 0) {
    incomeWindows = recordEnergySample(incomeWindows, energyIncomePerTick, 20);
  }

  const metrics = {
    tick: opts.tick,
    rcl: opts.rcl,
    energyIncomePerTick,
    errorCount,
    cpuUsedAvg,
    updatedAt: opts.tick,
  };

  const baseline =
    prev.baseline ??
    (opts.tick >= 500
      ? { energyIncomePerTick, updatedAt: opts.tick }
      : undefined);

  return {
    metrics,
    baseline,
    incomeSamples,
    incomeWindows,
    errorSamples,
    lastErrors,
    // Preserve ops diagnostics across ticks (tickTelemetry rebuilds the object).
    health: prev.health,
    lastSpawnFail: prev.lastSpawnFail,
    zombieDebug: prev.zombieDebug,
  };
}
