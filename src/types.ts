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
  /** Controller downgrade timer is low or nobody is upgrading. */
  downgradeRisk: boolean;
  /** Controller.ticksToDowngrade when known. */
  ticksToDowngrade?: number;
  /**
   * Active critical signals (softLock, noEconomyCreeps, incomeCollapsed, …).
   * Metrics evolves when this is non-empty (unless force/rollback overrides).
   */
  critical: string[];
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
  /** Last failed spawnCreep (ops triage when miners will not respawn). */
  lastSpawnFail?: {
    tick: number;
    role: string;
    result: number;
    energyAvailable: number;
    bodyParts: number;
  };
  /** Zombie-spawn recovery diagnostics. */
  zombieDebug?: Record<string, unknown>;
  /** spawn.spawning.name → first tick we saw it still alive (zombie grace). */
  zombieSpawnSeen?: Record<string, number>;
  /**
   * Road timing experiment (set by sim harness).
   * after_containers | parallel | after_rcl3 | source_first
   */
  roadPolicy?: string;
  /**
   * Early-game A/B knob (set by sim harness).
   * See src/earlyGame/experimentPolicy.ts AB_KNOBS.
   */
  abKnob?: string;
  /** Variant for abKnob (e.g. "0" | "2" | "5" for extensionBootstrap). */
  abVariant?: string;
  /** Named profile: baseline (default) | optimized (merged winners). */
  profile?: string;
  /**
   * RCL4→5 home spend mode (set by sim harness).
   * hub_spend | upgrade_rush | fat_first | build_heavy
   */
  rcl5Mode?: string;
  /**
   * Post-hub RCL5 gameplan.
   * link_boost (default after hub) | none/off (sim control: no links)
   */
  rcl5Plan?: string;
  /**
   * Hub filler sizing: fat (live default) | thin | duo_fat (sim A/B).
   */
  fillerPlan?: string;
  /**
   * Post-RCL6 remote plan: off (default) | drop_unreserved | reserved_drop |
   * reserved_container. home_only aliases off.
   */
  remotePlan?: string;
  /** Adjacent room name for remote mining (sim / sticky). */
  remoteRoom?: string;
  /** Approximate one-way haul tiles for remote hauler quota (sim). */
  remotePathLength?: number;
  /**
   * reserved_drop tuning: baseline | fat_hauler | thin_hauler | lean_haul |
   * fat_haul | fat_miner | dual_claim
   */
  remoteVariant?: string;
  /**
   * Convert surplus builders → upgraders when quota drops (no sites).
   * Default true; set false for sim control arms.
   */
  idleBuilderUpgrade?: boolean;
  /**
   * Absolute energy floor left in storage (blackout buffer).
   * Default 2000; set 0 to disable for sim control arms.
   */
  storageBlackoutReserve?: number;
  /** Sim-only hauler seat cap. Unset on live (formula decides). */
  haulerCap?: number;
  /** Sim-only max energy for a hauler body. Unset = full spawn budget. */
  haulerBudget?: number;
  /** Energy spent on successful spawns this run, by role. */
  spawnSpent?: Record<string, number>;
  /**
   * Wall/rampart arming: auto (default) | off | force | raid_only (sim).
   */
  wallPolicy?: string;
  /** Sticky: hub ramparts armed (economy or raid at RCL≥6). */
  wallsArmed?: boolean;
  /** Last arm reason from decideWallArm. */
  wallArmReason?: string;
  /**
   * Active hauler pickup reservations (haulerName → order).
   * See src/logistics/haulOrders.ts.
   */
  haulOrders?: Record<
    string,
    {
      containerId: string;
      reserved: number;
      created: number;
      withdrawn: number;
    }
  >;
}

declare global {
  interface CreepMemory {
    role?: string;
    /** Assigned energy source for dedicated miners. */
    sourceId?: Id<Source>;
    /** Sticky container/storage/drop id while a hauler is collecting. */
    pickupId?: Id<StructureContainer | StructureStorage | StructureExtension | Resource>;
    /** Walking to spawn to be recycled — do not evict from the hub ring. */
    recycling?: boolean;
    /** Energy withdrawn under the current haul order (settle check). */
    haulWithdrawn?: number;
    /** Park until death — TTL too short for another haul trip. */
    haulRetire?: boolean;
    /** Remote mining target room. */
    targetRoom?: string;
    /** Home room for remote haulers delivering to storage. */
    homeRoom?: string;
    /** Remote hauler returning with energy. */
    hauling?: boolean;
  }
  interface Memory {
    ags?: AgsMemory;
  }
}
export {};
