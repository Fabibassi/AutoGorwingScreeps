export interface AgsMetrics {
  tick: number;
  rcl: number;
  energyIncomePerTick: number;
  errorCount: number;
  cpuUsedAvg: number;
  updatedAt: number;
}

export interface AgsMemory {
  metrics: AgsMetrics;
  baseline?: { energyIncomePerTick: number; updatedAt: number };
  incomeSamples: number[];
  incomeWindows: number[];
  /** Per-tick error counts over the last ~100 ticks (window for rollback). */
  errorSamples: number[];
  /** Lifetime error total (debug); rollback uses metrics.errorCount (window). */
  lastErrors: number;
}

declare global {
  interface CreepMemory {
    role?: string;
    /** Assigned energy source for dedicated miners. */
    sourceId?: Id<Source>;
  }
  interface Memory {
    ags?: AgsMemory;
  }
}
export {};
