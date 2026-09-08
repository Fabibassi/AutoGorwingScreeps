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

export function desiredCreeps(
  rcl: number,
  sourceCount: number,
  containersAtSources: number,
  hasConstructionSites: boolean,
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

  if (!useDedicatedMiners(rcl, containersAtSources, sources)) {
    return {
      harvester: sources + 1,
      miner: 0,
      hauler: 0,
      upgrader: 2,
      builder: hasConstructionSites ? 1 : 0,
    };
  }

  return {
    harvester: 0,
    miner: sources,
    hauler: sources,
    upgrader: 2,
    builder: hasConstructionSites ? 1 : 0,
  };
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
