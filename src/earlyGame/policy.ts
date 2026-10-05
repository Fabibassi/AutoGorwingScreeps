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
  minRclForExtensions: 2,
  minRclForRoads: 2,
  minRclForWalls: 3,
  minRclForStorage: 4,
  /** Keep spawn buffer before spending on roads (extensions/containers first). */
  minSpawnEnergyForRoads: 200,
  /** Full worker (WORK+CARRY+MOVE). */
  minBootstrapEnergy: 200,
  /** Cheapest recovery hauler (CARRY+MOVE). Below this with no CARRY creeps = soft-lock. */
  minHaulerEnergy: 100,
} as const;

/** CONTROLLER_STRUCTURES.extension mirror (Screeps World). */
export const EXTENSIONS_BY_RCL: Record<number, number> = {
  1: 0,
  2: 5,
  3: 10,
  4: 20,
  5: 30,
  6: 40,
  7: 50,
  8: 60,
};

export function extensionQuota(rcl: number): number {
  return EXTENSIONS_BY_RCL[rcl] ?? 0;
}

export function shouldBuildExtensions(rcl: number): boolean {
  return rcl >= EARLY_GAME_THRESHOLDS.minRclForExtensions;
}

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
  /** Room energyAvailable (spawn + extensions). */
  energyAvailable?: number;
}

/** Source containers missing — static mining stays locked off. */
export function missingSourceContainers(
  rcl: number,
  containersAtSources: number,
  sourceCount: number,
): boolean {
  if (rcl < EARLY_GAME_THRESHOLDS.minRclForContainers) return false;
  return containersAtSources < Math.max(1, sourceCount);
}

/**
 * Keep one builder finishing source-container sites even when depressed.
 * Without this, depressed mode sets builder=0 and sites never complete.
 */
export function needsInfrastructureBuilder(
  rcl: number,
  containersAtSources: number,
  sourceCount: number,
  hasConstructionSites: boolean,
): boolean {
  if (!hasConstructionSites) return false;
  return missingSourceContainers(rcl, containersAtSources, sourceCount);
}

/** Income collapsed or spawn nearly empty — defer builders and trim upgraders. */
export function isEconomyDepressed(ctx?: EconomyContext): boolean {
  if (!ctx) return false;
  const income = ctx.energyIncomePerTick ?? 0;
  if (income <= 0) return true;
  if (isIncomeStalled(income, ctx.baselineIncome)) return true;
  return (ctx.spawnFillPct ?? 1) < 0.35;
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

/** No mobile/static harvesters left — colony cannot refill spawn without intervention. */
export function hasNoEconomyCreeps(counts: Pick<CreepQuotas, "harvester" | "miner">): boolean {
  return (counts.harvester ?? 0) + (counts.miner ?? 0) === 0;
}

/** Move builder ahead of upgrader so container sites get WORK bodies first. */
function prioritizeInfrastructureBuilder(
  order: Array<keyof CreepQuotas>,
): Array<keyof CreepQuotas> {
  const withoutBuilder: Array<keyof CreepQuotas> = order.filter(
    (role) => role !== "builder",
  );
  const upgraderIdx = withoutBuilder.indexOf("upgrader");
  if (upgraderIdx === -1) return [...withoutBuilder, "builder"];
  const next = withoutBuilder.slice();
  next.splice(upgraderIdx, 0, "builder");
  return next;
}

/** Prefer spending a banked worker body on the missing infra builder. */
function prioritizeBuilderOverSpareHarvester(
  order: Array<keyof CreepQuotas>,
): Array<keyof CreepQuotas> {
  const withoutBuilder: Array<keyof CreepQuotas> = order.filter(
    (role) => role !== "builder",
  );
  const harvesterIdx = withoutBuilder.indexOf("harvester");
  if (harvesterIdx === -1) return [...withoutBuilder, "builder"];
  const next = withoutBuilder.slice();
  next.splice(harvesterIdx, 0, "builder");
  return next;
}

/** Spawn harvester first when static mining stalled — hauler-first starves recovery. */
export function spawnPriorityOrder(
  dedicatedMiners: boolean,
  ctx?: EconomyContext,
  counts?: Pick<CreepQuotas, "harvester" | "miner">,
  energyAvailable?: number,
  opts?: {
    infrastructurePush?: boolean;
    /** Want more builders than live (source-container push). */
    buildersBelowQuota?: boolean;
    /** At least one harvester/miner per source — spare H can wait. */
    economyFloorMet?: boolean;
  },
): Array<keyof CreepQuotas> {
  let order: Array<keyof CreepQuotas>;
  // Soft-lock: energy trapped in extensions — hauler (100) consolidates into spawn for harvester (150).
  if (
    counts &&
    energyAvailable != null &&
    isSoftLocked(energyAvailable, counts)
  ) {
    order = ["hauler", "harvester", "miner", "upgrader", "builder"];
  } else if (counts && hasNoEconomyCreeps(counts)) {
    // Empty economy: always bootstrap a harvester before haulers/builders.
    order = ["harvester", "hauler", "miner", "upgrader", "builder"];
  } else if (shouldFallbackToMobileHarvest(dedicatedMiners, ctx)) {
    // Hauler-first: containers may hold all room energy; hauler body costs 100 vs 150.
    order = ["hauler", "harvester", "upgrader", "builder"];
  } else if (needsBootstrapHarvester(dedicatedMiners, ctx)) {
    order = ["harvester", "hauler", "miner", "upgrader", "builder"];
  } else {
    order = DEFAULT_SPAWN_ORDER;
  }

  if (opts?.infrastructurePush) {
    order = prioritizeInfrastructureBuilder(order);
    // With sources covered, spend the next 200 on builder #2 — not the spare harvester.
    if (opts.buildersBelowQuota && opts.economyFloorMet) {
      order = prioritizeBuilderOverSpareHarvester(order);
    }
  }
  return order;
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

  const infraBuilder = needsInfrastructureBuilder(
    rcl,
    containersAtSources,
    sources,
    hasConstructionSites,
  );

  if (shouldFallbackToMobileHarvest(dedicatedMiners, economy)) {
    return {
      harvester: sources + 1,
      miner: 0,
      // Static mining always had source containers; haulers unlock energy for spawn.
      hauler: sources,
      upgrader: 1,
      builder: infraBuilder ? 2 : 0,
    };
  }

  const depressed = isEconomyDepressed(economy);

  if (!dedicatedMiners) {
    const energy = economy?.energyAvailable ?? 300;
    const readyContainers = Math.max(0, Math.min(containersAtSources, sources));
    // First finished source container: start static mining there immediately.
    // Keep mobile harvesters only for sources still missing a container.
    if (readyContainers > 0) {
      const uncovered = Math.max(0, sources - readyContainers);
      return {
        harvester: uncovered > 0 ? uncovered + 1 : 0,
        miner: readyContainers,
        hauler: readyContainers,
        upgrader: infraBuilder ? 0 : depressed ? 1 : 2,
        builder: infraBuilder ? 2 : hasConstructionSites && !depressed ? 1 : 0,
      };
    }
    return {
      harvester: sources + 1,
      miner: 0,
      // Soft-lock: want>0 so hauler actually spawns; at >=100 prefer a 2nd mobile hauler
      // (emergency CARRY-only may already own the first slot).
      // During source-container push, skip haulers — no containers/drops to move yet;
      // spawn energy must fund the second infra builder instead.
      hauler: infraBuilder
        ? 0
        : depressed
          ? energy >= EARLY_GAME_THRESHOLDS.minHaulerEnergy
            ? 2
            : 1
          : 0,
      upgrader: infraBuilder ? 0 : depressed ? 1 : 2,
      // Two builders finish source containers much faster under source contention.
      builder: infraBuilder ? 2 : hasConstructionSites && !depressed ? 1 : 0,
    };
  }

  const quotas: CreepQuotas = {
    harvester: 0,
    miner: sources,
    hauler: sources,
    upgrader: depressed ? 1 : 2,
    builder: infraBuilder ? 2 : hasConstructionSites && !depressed ? 1 : 0,
  };

  if (needsBootstrapHarvester(true, economy)) {
    quotas.harvester = 1;
  }

  return quotas;
}

/** Ordered build priorities for early rooms (extensions before containers/storage). */
export function constructionPriority(
  rcl: number,
  opts: {
    sourceContainerCount: number;
    sourceCount: number;
    hasControllerContainer: boolean;
    hasStorage: boolean;
    roadSitesAllowed: boolean;
    /** Built extensions + extension construction sites. */
    extensionCount?: number;
  },
): BuildableStructureConstant[] {
  const queue: BuildableStructureConstant[] = [];

  const missingSourceContainers = shouldBuildContainers(rcl)
    ? Math.max(0, opts.sourceCount - opts.sourceContainerCount)
    : 0;

  // Source containers unlock miner/hauler pairs — never defer them past extension spam.
  for (let i = 0; i < missingSourceContainers; i++) {
    queue.push("container");
  }

  if (shouldBuildExtensions(rcl)) {
    const have = opts.extensionCount ?? 0;
    const missing = Math.max(0, extensionQuota(rcl) - have);
    for (let i = 0; i < missing; i++) {
      queue.push("extension");
    }
  }

  // Controller container only after source containers — otherwise it steals the
  // 3-site cap and dilutes build effort away from miner unlock.
  if (
    shouldBuildContainers(rcl) &&
    !opts.hasControllerContainer &&
    missingSourceContainers === 0
  ) {
    queue.push("container");
  }

  if (shouldBuildStorage(rcl) && !opts.hasStorage) {
    queue.push("storage");
  }

  if (opts.roadSitesAllowed) {
    queue.push("road");
  }

  return queue;
}

/**
 * Soft-lock: cannot spawn a hauler (100) and nobody can move energy into spawn.
 * Carry-less WORK creeps do not clear this — they cannot transfer.
 */
export function isSoftLocked(
  energyAvailable: number,
  _counts?: Pick<CreepQuotas, "harvester" | "miner">,
  hasCarryCreep = false,
): boolean {
  if (hasCarryCreep) return false;
  return energyAvailable < EARLY_GAME_THRESHOLDS.minHaulerEnergy;
}
