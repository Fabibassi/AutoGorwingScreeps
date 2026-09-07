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
  lastErrors: number;
}

declare global {
  interface CreepMemory {
    role?: string;
  }
  interface Memory {
    ags?: AgsMemory;
  }
}
export {};
