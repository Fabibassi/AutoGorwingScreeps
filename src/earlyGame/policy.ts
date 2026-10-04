import { isIncomeStalled } from "../telemetry";

/**
 * Early-game policy derived from common Screeps guides:
 * - RCL 1: lean bootstrap, no infrastructure spend
 * - RCL 2+: containers at sources, dedicated miners + haulers
 * - Roads only with spare spawn energy; walls deferred until RCL 3+
 * - Storage only from RCL 4 (structure unlock)
 */

export interface CreepQuotas {
  harvester: number;
  miner: number;
  hauler: number;
  upgrader: number;
  builder: number;
}

export const EARLY_GAME_THRESHOLDS = {
  minRclForContainers: 2,
  minRclForDedicatedMiners: 2,
  minRclForRoads: 2,
  minRclForWalls: 3,
  minRclForStorage: 4,
  /** Keep spawn buffer before spending on roads (extensions/containers first). */
  minSpawnEnergyForRoads: 200,
} as const;

export function shouldBuildStorage(rcl: number): boolean {
  return rcl >= EARLY_GAME_THRESHOLDS.minRclForStorage;
}

export function shouldBuildContainers(rcl: number): boolean {
  return rcl >= EARLY_GAME_THRESHOLDS.minRclForContainers;
}

export function shouldBuildRoads(
  rcl: number,
  spawnEnergy: number,
  hasHigherPrioritySites: boolean,
): boolean {
  if (rcl < EARLY_GAME_THRESHOLDS.minRclForRoads) return false;
  if (hasHigherPrioritySites) return false;
  return spawnEnergy >= EARLY_GAME_THRESHOLDS.minSpawnEnergyForRoads;
}

/** Walls/ramparts burn upgrade energy early — defer until economy is established. */
export function shouldBuildWalls(rcl: number): boolean {
  return rcl >= EARLY_GAME_THRESHOLDS.minRclForWalls;
}

/** Wait until every source has a finished container before dropping harvesters. */
export function useDedicatedMiners(
  rcl: number,
  containersAtSources: number,
  sourceCount: number,
): boolean {
  const sources = Math.max(1, sourceCount);
  return (
    rcl >= EARLY_GAME_THRESHOLDS.minRclForDedicatedMiners &&
    containersAtSources >= sources
  );
}

export interface EconomyContext {
  energyIncomePerTick?: number;
  baselineIncome?: number;
  spawnFillPct?: number;
}

/** Keep one mobile harvester when static mining economy has stalled. */
export function needsBootstrapHarvester(
  dedicatedMiners: boolean,
  ctx?: EconomyContext,
): boolean {
  if (!dedicatedMiners || !ctx) return false;
  const income = ctx.energyIncomePerTick ?? 0;
  const fill = ctx.spawnFillPct ?? 1;
  return income <= 0 || fill < 0.2;
}

/** Zero income with static mining — revert to mobile harvesters until recovery. */
export function shouldFallbackToMobileHarvest(
  dedicatedMiners: boolean,
  ctx?: EconomyContext,
): boolean {
  if (!dedicatedMiners || !ctx) return false;
  const income = ctx.energyIncomePerTick ?? 0;
  return isIncomeStalled(income, ctx.baselineIncome);
}

/** Whether spawn/quota logic should use the static miner pipeline this tick. */
export function effectiveDedicatedMiners(
  rcl: number,
  containersAtSources: number,
  sourceCount: number,
  economy?: EconomyContext,
): boolean {
  const dedicated = useDedicatedMiners(rcl, containersAtSources, sourceCount);
  return dedicated && !shouldFallbackToMobileHarvest(dedicated, economy);
}

export const DEFAULT_SPAWN_ORDER: Array<keyof CreepQuotas> = [
  "hauler",
  "miner",
  "harvester",
  "upgrader",
  "builder",
];

/** Spawn harvester first when static mining stalled — hauler-first starves recovery. */
export function spawnPriorityOrder(
  dedicatedMiners: boolean,
  ctx?: EconomyContext,
): Array<keyof CreepQuotas> {
  if (shouldFallbackToMobileHarvest(dedicatedMiners, ctx)) {
    // Hauler-first: containers may hold all room energy; hauler body costs 100 vs 150.
    return ["hauler", "harvester", "upgrader", "builder"];
  }
  if (needsBootstrapHarvester(dedicatedMiners, ctx)) {
    return ["harvester", "hauler", "miner", "upgrader", "builder"];
  }
  return DEFAULT_SPAWN_ORDER;
}

export function desiredCreeps(
  rcl: number,
  sourceCount: number,
  containersAtSources: number,
  hasConstructionSites: boolean,
  economy?: EconomyContext,
): CreepQuotas {
  const sources = Math.max(1, sourceCount);

  if (rcl <= 1) {
    return {
      harvester: 2,
      miner: 0,
      hauler: 0,
      upgrader: 1,
      builder: 0,
    };
  }

  const dedicatedMiners = useDedicatedMiners(rcl, containersAtSources, sources);

  if (shouldFallbackToMobileHarvest(dedicatedMiners, economy)) {
    return {
      harvester: sources + 1,
      miner: 0,
      // Static mining always had source containers; haulers unlock energy for spawn.
      hauler: sources,
      upgrader: 1,
      builder: 0,
    };
  }

  if (!dedicatedMiners) {
    return {
      harvester: sources + 1,
      miner: 0,
      hauler: 0,
      upgrader: 2,
      builder: hasConstructionSites ? 1 : 0,
    };
  }

  const quotas: CreepQuotas = {
    harvester: 0,
    miner: sources,
    hauler: sources,
    upgrader: 2,
    builder: hasConstructionSites ? 1 : 0,
  };

  if (needsBootstrapHarvester(true, economy)) {
    quotas.harvester = 1;
  }

  return quotas;
}

/** Ordered build priorities for early rooms (excludes walls/storage early). */
export function constructionPriority(
  rcl: number,
  opts: {
    sourceContainerCount: number;
    sourceCount: number;
    hasControllerContainer: boolean;
    hasStorage: boolean;
    roadSitesAllowed: boolean;
  },
): BuildableStructureConstant[] {
  const queue: BuildableStructureConstant[] = [];

  if (shouldBuildContainers(rcl)) {
    const missingSourceContainers = Math.max(
      0,
      opts.sourceCount - opts.sourceContainerCount,
    );
    for (let i = 0; i < missingSourceContainers; i++) {
      queue.push("container");
    }
    if (!opts.hasControllerContainer) {
      queue.push("container");
    }
  }

  if (shouldBuildStorage(rcl) && !opts.hasStorage) {
    queue.push("storage");
  }

  if (opts.roadSitesAllowed) {
    queue.push("road");
  }

  return queue;
}
