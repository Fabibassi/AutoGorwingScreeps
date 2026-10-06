import { isIncomeStalled } from "../telemetry";
import {
  allowControllerContainer,
  extensionBootstrapCap,
  sourceContainerQueueCount,
  type ExperimentProfile,
  BASELINE_PROFILE,
} from "./experimentPolicy";

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
  /** Hub creep: storage → spawn/extensions (0 until storage exists). */
  filler: number;
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

/** CONTROLLER_STRUCTURES.tower mirror (Screeps World). */
export const TOWERS_BY_RCL: Record<number, number> = {
  1: 0,
  2: 0,
  3: 1,
  4: 1,
  5: 2,
  6: 2,
  7: 3,
  8: 6,
};

export function extensionQuota(rcl: number): number {
  return EXTENSIONS_BY_RCL[rcl] ?? 0;
}

export function towerQuota(rcl: number): number {
  return TOWERS_BY_RCL[rcl] ?? 0;
}

export function shouldBuildTowers(rcl: number): boolean {
  return towerQuota(rcl) > 0;
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
  opts?: { minRcl?: number; minSpawnEnergy?: number },
): boolean {
  const minRcl = opts?.minRcl ?? EARLY_GAME_THRESHOLDS.minRclForRoads;
  const minEnergy =
    opts?.minSpawnEnergy ?? EARLY_GAME_THRESHOLDS.minSpawnEnergyForRoads;
  if (rcl < minRcl) return false;
  if (hasHigherPrioritySites) return false;
  return spawnEnergy >= minEnergy;
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
  /** Sum of WORK parts on live miners (for hauler sizing). */
  minerWorkParts?: number;
  /** Live miner count — containers ≠ staffed miners. */
  minerCount?: number;
  /** Approx one-way spawn↔source tiles for hauler throughput. */
  haulRange?: number;
  /** Owned storage exists — haulers dump here, one filler tops spawn/extensions. */
  hasStorage?: boolean;
}

/** Each WORK harvests 2 energy/tick; a source caps at 10 e/t. */
export function estimateMiningPerTick(
  minerWorkParts: number,
  sourceCount: number,
): number {
  const sources = Math.max(1, sourceCount);
  return Math.min(Math.max(0, minerWorkParts) * 2, sources * 10);
}

/**
 * Haulers needed to move mined energy to the hub.
 * Throughput ≈ 150 carry / (2×range + 2 intents); clamp to [sources, 2×sources].
 */
export function haulerCountForMining(
  sourceCount: number,
  minerWorkParts: number,
  opts?: { haulRange?: number },
): number {
  const sources = Math.max(1, sourceCount);
  const mining = estimateMiningPerTick(minerWorkParts, sources);
  if (mining <= 0) return sources;

  const range = Math.max(8, opts?.haulRange ?? 20);
  const throughput = 150 / (2 * range + 2);
  const needed = Math.ceil(mining / Math.max(1, throughput));
  return Math.max(sources, Math.min(sources * 2, needed));
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
  // Saturated spawn: harvest often reads ~0 because there is nowhere to deliver
  // (energy banked in containers). Treating that as collapse drops builder
  // quota to 0 and freezes extension sites while the spawn sits full.
  if ((ctx.spawnFillPct ?? 0) >= 0.85) return false;
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
  // Same healthy-spawn gate as mobile-harvest fallback: banked container energy
  // makes income look dead while spawn is already refillable.
  if ((ctx.spawnFillPct ?? 0) >= 0.35 || (ctx.energyAvailable ?? 0) >= 150) {
    return false;
  }
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
  // Healthy spawn/extensions: low measured income usually means energy banked in
  // source containers, not a dead miner pipeline. Demoting miners then leaves a
  // source idle while the converted body wanders as a mobile harvester.
  if ((ctx.spawnFillPct ?? 0) >= 0.35 || (ctx.energyAvailable ?? 0) >= 150) {
    return false;
  }
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

function withFillerSlot(
  order: Array<keyof CreepQuotas>,
): Array<keyof CreepQuotas> {
  if (order.includes("filler")) return order;
  const next = order.slice();
  const minerIdx = next.indexOf("miner");
  if (minerIdx >= 0) {
    next.splice(minerIdx + 1, 0, "filler");
    return next;
  }
  const haulerIdx = next.indexOf("hauler");
  if (haulerIdx >= 0) {
    next.splice(haulerIdx + 1, 0, "filler");
    return next;
  }
  next.push("filler");
  return next;
}

export const DEFAULT_SPAWN_ORDER: Array<keyof CreepQuotas> = [
  "hauler",
  "miner",
  "filler",
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
    // Soft bank (spawn < 200): hauler@100 drains storage/containers first.
    // Full spawn (≥200): harvest immediately — a fat hauler wastes the boot budget.
    const canAffordWorker =
      (energyAvailable ?? ctx?.energyAvailable ?? 0) >=
      EARLY_GAME_THRESHOLDS.minBootstrapEnergy;
    order =
      (ctx?.energyIncomePerTick ?? 0) <= 0 && !canAffordWorker
        ? ["hauler", "harvester", "miner", "upgrader", "builder"]
        : ["harvester", "miner", "hauler", "upgrader", "builder"];
  } else if (counts && dedicatedMiners && (counts.miner ?? 0) === 0) {
    // Miners wiped but a hauler/harvester remains — refill sources first.
    order = ["miner", "hauler", "harvester", "upgrader", "builder"];
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
  return withFillerSlot(order);
}

export function desiredCreeps(
  rcl: number,
  sourceCount: number,
  containersAtSources: number,
  hasConstructionSites: boolean,
  economy?: EconomyContext,
  experiment?: ExperimentProfile,
): CreepQuotas {
  const exp = experiment ?? BASELINE_PROFILE;
  const sources = Math.max(1, sourceCount);
  const infraBuilders = Math.max(1, exp.builderInfra);

  const fill = (q: Omit<CreepQuotas, "filler">): CreepQuotas => ({
    ...q,
    filler: economy?.hasStorage ? 1 : 0,
  });

  if (rcl <= 1) {
    return fill({
      harvester: 2,
      miner: 0,
      hauler: 0,
      upgrader: 1,
      builder: 0,
    });
  }

  const dedicatedMiners = useDedicatedMiners(rcl, containersAtSources, sources);

  const infraBuilder = needsInfrastructureBuilder(
    rcl,
    containersAtSources,
    sources,
    hasConstructionSites,
  );

  if (shouldFallbackToMobileHarvest(dedicatedMiners, economy)) {
    return fill({
      harvester: sources + 1,
      miner: 0,
      // Static mining always had source containers; haulers unlock energy for spawn.
      hauler: sources,
      upgrader: 1,
      builder: infraBuilder ? infraBuilders : 0,
    });
  }

  const depressed = isEconomyDepressed(economy);

  if (!dedicatedMiners) {
    const energy = economy?.energyAvailable ?? 300;
    const readyContainers = Math.max(0, Math.min(containersAtSources, sources));
    // First finished source container: start static mining there immediately.
    // Keep mobile harvesters only for sources still missing a container.
    if (readyContainers > 0) {
      const uncovered = Math.max(0, sources - readyContainers);
      return fill({
        // During container push, skip the spare H — convert capacity into builder #2.
        harvester: uncovered <= 0 ? 0 : infraBuilder ? uncovered : uncovered + 1,
        miner: readyContainers,
        hauler: readyContainers,
        upgrader: infraBuilder
          ? rcl < 3
            ? Math.min(1, exp.upgraderQuotaClimb)
            : 0
          : depressed
            ? 1
            : 2,
        builder: infraBuilder
          ? infraBuilders
          : hasConstructionSites && !depressed
            ? 1
            : 0,
      });
    }
    return fill({
      // During container push, skip the spare H — convert capacity into builders.
      harvester: infraBuilder ? sources : sources + 1,
      miner: 0,
      // Soft-lock / empty income: always want a hauler to drain storage/containers
      // into spawn — even during infra push (otherwise sites starve forever).
      hauler:
        (economy?.energyIncomePerTick ?? 1) <= 0 &&
        (economy?.energyAvailable ?? 300) < 200
          ? 1
          : infraBuilder
            ? 0
            : depressed
              ? energy >= EARLY_GAME_THRESHOLDS.minHaulerEnergy
                ? 2
                : 1
              : 0,
      upgrader: infraBuilder
        ? rcl < 3
          ? Math.min(1, exp.upgraderQuotaClimb)
          : 0
        : depressed
          ? 1
          : 2,
      // Infra builders finish source containers under source contention.
      builder: infraBuilder
        ? infraBuilders
        : hasConstructionSites && !depressed
          ? 1
          : 0,
    });
  }

  // After source containers: climb to RCL3 before extension spam — otherwise
  // 45k controller progress never finishes under a 4-builder extension push.
  const climbingToRcl3 = rcl < 3;
  const extensionPush = hasConstructionSites && !depressed && !climbingToRcl3;
  // Fallback assume 1 WORK/source until spawn passes live miner WORK counts.
  const minerWorkParts = economy?.minerWorkParts ?? sources;
  const liveMiners = economy?.minerCount;
  // Unknown live count (pure tests) → assume staffed. Explicit 0 → keep a bridge harvester.
  const minersStaffed = liveMiners == null || liveMiners >= sources;
  const haulers = haulerCountForMining(sources, minerWorkParts, {
    haulRange: economy?.haulRange,
  });

  const quotas: CreepQuotas = {
    harvester: minersStaffed ? 0 : Math.max(1, sources - liveMiners),
    miner: sources,
    hauler: haulers,
    upgrader: climbingToRcl3
      ? exp.upgraderQuotaClimb
      : extensionPush
        ? 0
        : depressed
          ? 1
          : 2,
    builder: climbingToRcl3
      ? hasConstructionSites
        ? minersStaffed
          ? Math.max(1, infraBuilders)
          : Math.min(2, Math.max(1, infraBuilders))
        : 0
      : infraBuilder
        ? infraBuilders
        : extensionPush
          ? Math.max(4, infraBuilders)
          : 0,
    filler: economy?.hasStorage ? 1 : 0,
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
    /** Finished extensions only (for containerTiming=later). */
    extensionBuilt?: number;
    /** Open source-container construction sites. */
    sourceContainerSites?: number;
    /** Built towers + tower construction sites. */
    towerCount?: number;
    experiment?: ExperimentProfile;
  },
): BuildableStructureConstant[] {
  const exp = opts.experiment ?? BASELINE_PROFILE;
  const queue: BuildableStructureConstant[] = [];

  const missingAll = shouldBuildContainers(rcl)
    ? Math.max(0, opts.sourceCount - opts.sourceContainerCount)
    : 0;
  const containerSites = sourceContainerQueueCount(
    exp,
    missingAll,
    opts.sourceContainerSites ?? 0,
    opts.extensionBuilt ?? 0,
  );

  const laterMode = exp.containerTiming === "later";
  // later: bootstrap extensions before source containers.
  if (laterMode && shouldBuildExtensions(rcl)) {
    const have = opts.extensionCount ?? 0;
    const cap = extensionBootstrapCap(exp, rcl, extensionQuota(rcl));
    const missing = Math.max(0, cap - have);
    for (let i = 0; i < missing; i++) queue.push("extension");
  }

  // Source containers unlock miner/hauler pairs — never defer them past extension spam
  // (except later-mode, which already queued extensions above).
  for (let i = 0; i < containerSites; i++) {
    queue.push("container");
  }

  // First tower as soon as RCL3 + source containers are done (active defense).
  if (shouldBuildTowers(rcl) && containerSites === 0 && missingAll === 0) {
    const have = opts.towerCount ?? 0;
    const missing = Math.max(0, towerQuota(rcl) - have);
    for (let i = 0; i < missing; i++) queue.push("tower");
  }

  if (
    shouldBuildExtensions(rcl) &&
    !laterMode &&
    containerSites === 0 &&
    missingAll === 0
  ) {
    const have = opts.extensionCount ?? 0;
    // RCL2: experiment caps extensions so climb can finish first.
    const cap = extensionBootstrapCap(exp, rcl, extensionQuota(rcl));
    const missing = Math.max(0, cap - have);
    for (let i = 0; i < missing; i++) {
      queue.push("extension");
    }
  }

  // Controller container timing is experiment-driven.
  if (
    shouldBuildContainers(rcl) &&
    !opts.hasControllerContainer &&
    allowControllerContainer(exp, rcl, missingAll)
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
