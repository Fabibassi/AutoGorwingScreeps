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

export function useDedicatedMiners(rcl: number, containersAtSources: number): boolean {
  return (
    rcl >= EARLY_GAME_THRESHOLDS.minRclForDedicatedMiners && containersAtSources > 0
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

  if (!useDedicatedMiners(rcl, containersAtSources)) {
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

/** Body-part costs (mirrors Screeps BODYPART_COST for testable pure logic). */
const PART_COST: Record<BodyPartConstant, number> = {
  move: 50,
  work: 100,
  carry: 50,
  attack: 80,
  ranged_attack: 150,
  tough: 10,
  heal: 250,
  claim: 600,
};

export function buildMinerBody(energyAvailable: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  let remaining = energyAvailable;
  while (remaining >= PART_COST.work + PART_COST.move && body.filter((p) => p === "work").length < 5) {
    if (remaining >= PART_COST.work) {
      body.push("work");
      remaining -= PART_COST.work;
    } else break;
  }
  if (remaining >= PART_COST.move) {
    body.push("move");
  }
  if (body.length === 0) {
    return ["work", "move"];
  }
  return body;
}

export function buildHaulerBody(energyAvailable: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  let remaining = energyAvailable;
  while (remaining >= PART_COST.carry + PART_COST.move) {
    body.push("carry", "move");
    remaining -= PART_COST.carry + PART_COST.move;
  }
  if (body.length === 0) {
    return ["carry", "move"];
  }
  return body;
}

export function buildWorkerBody(energyAvailable: number): BodyPartConstant[] {
  const unit = PART_COST.work + PART_COST.carry + PART_COST.move;
  const repeats = Math.max(1, Math.floor(energyAvailable / unit));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < repeats; i++) {
    body.push("work", "carry", "move");
  }
  return body;
}

export function bodyForRole(
  role: keyof CreepQuotas,
  energyAvailable: number,
): BodyPartConstant[] {
  switch (role) {
    case "miner":
      return buildMinerBody(energyAvailable);
    case "hauler":
      return buildHaulerBody(energyAvailable);
    case "builder":
    case "harvester":
    case "upgrader":
      return buildWorkerBody(energyAvailable);
    default:
      return ["work", "carry", "move"];
  }
}
