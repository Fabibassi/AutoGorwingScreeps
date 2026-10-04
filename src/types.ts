export interface AgsMetrics {
  tick: number;
  rcl: number;
  energyIncomePerTick: number;
  errorCount: number;
  cpuUsedAvg: number;
  updatedAt: number;
}

export interface AgsHealthCheck {
  tick: number;
  rcl: number;
  /** Total missing creeps across all roles. */
  creepDeficit: number;
  /** Roles below desired quota. */
  understaffed: string[];
  containersAtSources: number;
  sourceCount: number;
  dedicatedMiners: boolean;
  /** Spawn energy fill ratio 0–1. */
  spawnFillPct: number;
  hasControllerContainer: boolean;
  constructionSites: number;
  /**
   * Critical: claimed room has zero harvesters and zero miners.
   * Metrics should evolve on this without waiting for income-window stagnation.
   */
  noEconomyCreeps: boolean;
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
  /** Periodic colony health snapshot (see selfCheck.ts). */
  health?: AgsHealthCheck;
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
