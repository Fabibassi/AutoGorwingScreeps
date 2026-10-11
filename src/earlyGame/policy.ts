import { isIncomeStalled } from "../telemetry";
import {
  allowControllerContainer,
  extensionBootstrapCap,
  sourceContainerQueueCount,
  type ExperimentProfile,
  BASELINE_PROFILE,
} from "./experimentPolicy";
import { fillerQuotaForPlan } from "./fillerPlan";
import {
  applyRcl5ModeQuotas,
  applyRcl5PlanQuotas,
  parseRcl5Mode,
  rcl5ModePausesExtensionSpam,
  type Rcl5Mode,
} from "./rcl5Mode";

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
  /** Source-container bank high enough to prioritize hub storage (RCL4). */
  sourceContainerSurplusEnergy: 3000,
  /** Storage bank that unlocks upgrade-first spend instead of extension flood. */
  storageSpendEnergy: 1000,
} as const;

/** True when source containers hold enough energy to justify hub storage. */
export function sourceContainerEnergySurplus(
  totalEnergy: number,
  threshold: number = EARLY_GAME_THRESHOLDS.sourceContainerSurplusEnergy,
): boolean {
  return totalEnergy >= threshold;
}

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
  experiment?: ExperimentProfile,
): boolean {
  const sources = Math.max(1, sourceCount);
  if (rcl < EARLY_GAME_THRESHOLDS.minRclForDedicatedMiners) return false;
  // Overmind-style early: static miners may drop-mine before containers exist.
  if (experiment?.allowDropMiners) return true;
  return containersAtSources >= sources;
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
  /** Energy currently held in owned storage. */
  storageEnergy?: number;
  /** Sum of energy in finished source-adjacent containers. */
  sourceContainerEnergy?: number;
  /** Room energyCapacityAvailable (spawn + extensions). */
  energyCapacityAvailable?: number;
  /** RCL4→5 spend experiment mode (sim / Memory.ags.rcl5Mode). */
  rcl5Mode?: Rcl5Mode | string;
  /** Finished + open extension sites (RCL5 hub wave). */
  extensionCount?: number;
  /** Built + open tower sites. */
  towerCount?: number;
  /** Built + open link sites (RCL5 link pair). */
  linkCount?: number;
  /** Post-hub RCL5 plan (link_boost | none). */
  rcl5Plan?: string;
  /** Hub filler sizing: thin | fat | duo_fat. */
  fillerPlan?: string;
}

/**
 * After storage exists: spend on upgrade/bodies when the hub (or still-full
 * source containers with a saturated spawn) holds surplus energy.
 */
export function isHubSpendMode(economy?: EconomyContext): boolean {
  if (!economy?.hasStorage) return false;
  if (
    (economy.storageEnergy ?? 0) >= EARLY_GAME_THRESHOLDS.storageSpendEnergy
  ) {
    return true;
  }
  if (!sourceContainerEnergySurplus(economy.sourceContainerEnergy ?? 0)) {
    return false;
  }
  const avail = economy.energyAvailable ?? 0;
  const cap = economy.energyCapacityAvailable ?? 0;
  return cap > 0 ? avail >= cap - 50 : avail >= 550;
}

/** Each WORK harvests 2 energy/tick; a source caps at 10 e/t. */
export function estimateMiningPerTick(
  minerWorkParts: number,
  sourceCount: number,
): number {
  const sources = Math.max(1, sourceCount);
  return Math.min(Math.max(0, minerWorkParts) * 2, sources * 10);
}

/** Max WORK a stationary miner should wait for given room energy capacity (1W1M…5W1M). */
export function minerTargetWorkParts(energyCapacityAvailable: number): number {
  return Math.max(
    1,
    Math.min(5, Math.floor((Math.max(0, energyCapacityAvailable) - 50) / 100)),
  );
}

export function minerBodyCost(workParts: number): number {
  return Math.max(1, workParts) * 100 + 50;
}

/**
 * True when the room can afford fat miners but live WORK is still thin —
 * bank energyAvailable for upgrades instead of flooding builders/tiny miners.
 */
export function shouldBankForBetterMiners(opts: {
  energyCapacityAvailable: number;
  minerWorkParts: number;
  sourceCount: number;
}): boolean {
  const sources = Math.max(1, opts.sourceCount);
  const target = minerTargetWorkParts(opts.energyCapacityAvailable);
  if (target <= 1) return false;
  return opts.minerWorkParts < sources * target;
}

/** Spawn waits for capacity-sized miners (never 1W when the room can fund 5W). */
export function effectiveMinerMinWork(
  experimentMinWork: number,
  energyCapacityAvailable: number,
): number {
  return Math.max(
    Math.max(1, experimentMinWork),
    minerTargetWorkParts(energyCapacityAvailable),
  );
}

/**
 * Prefer fat miners, but never leave a mining seat empty because the bank is
 * momentarily under the 5W cost (live W21N35: ~500 available, 550 needed).
 *
 * Pre-spawn (TTL handoff while the incumbent still mines) waits for the
 * capacity-sized body when storage can fund the refill — thin 1–4W bridges
 * only for true uncovered seats, or when the storage reserve is too lean.
 */
export function minerMinWorkForSpawn(opts: {
  preferredMinWork: number;
  energyAvailable: number;
  seatsUncovered: boolean;
  /** TTL replacement while a live miner still covers the source. */
  isPrespawn?: boolean;
  storageEnergy?: number;
  /** Wait only while storage is above this (default: never wait on lean/absent bank). */
  storageWaitReserve?: number;
}): number {
  const preferred = Math.max(1, opts.preferredMinWork);
  if (!opts.seatsUncovered) return preferred;
  if (opts.energyAvailable >= minerBodyCost(preferred)) return preferred;
  if (opts.isPrespawn) {
    const reserve = Math.max(0, opts.storageWaitReserve ?? 0);
    const storage = Math.max(0, opts.storageEnergy ?? 0);
    if (storage > reserve) return preferred;
  }
  return 1;
}

const SPAWN_STORE_CAPACITY = 300;
const EXTENSION_STORE_CAPACITY = 50;

/** Finished extensions needed so energyCapacity can fund a W…1M miner body. */
export function extensionsNeededForMinerWork(workParts: number): number {
  const need = minerBodyCost(workParts) - SPAWN_STORE_CAPACITY;
  if (need <= 0) return 0;
  return Math.ceil(need / EXTENSION_STORE_CAPACITY);
}

/**
 * Build extensions in miner-quality stages only:
 * 1) enough for 3W1M → 2) enough for 5W1M (5×50 + spawn 300 = 550).
 * Past the 5W gate (or once RCL5 unlocks the next hub wave), fill the RCL quota.
 */
export function stagedExtensionBuildCap(opts: {
  fullQuota: number;
  minerWorkParts: number;
  sourceCount: number;
  /** When ≥5, unlock full RCL extension quota (tower#2 / 30-ext wave). */
  rcl?: number;
}): number {
  const full = Math.max(0, opts.fullQuota);
  const sources = Math.max(1, opts.sourceCount);
  const gate3 = extensionsNeededForMinerWork(3);
  const gate5 = extensionsNeededForMinerWork(5);
  // RCL5 hub wave (2nd tower + 30 ext): fill quota. Earlier RCLs stay at miner gates
  // so climb energy upgrades bodies instead of empty shells.
  if ((opts.rcl ?? 0) >= 5) {
    return full;
  }
  if (opts.minerWorkParts >= sources * 3) {
    return Math.min(full, Math.max(gate5, gate3));
  }
  return Math.min(full, gate3);
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
  // Low spawn with healthy income is builders/haulers cycling energy, not
  // collapse. Dropping builder quota here leaves 3k sites frozen after TTL deaths.
  return false;
}

/** Keep one mobile harvester when static mining economy has stalled. */
export function needsBootstrapHarvester(
  dedicatedMiners: boolean,
  ctx?: EconomyContext,
): boolean {
  if (!dedicatedMiners || !ctx) return false;
  // Miners already on seats: empty spawn with full containers is a haul gap.
  if ((ctx.minerCount ?? 0) > 0) return false;
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
  // Live miners + source containers: stalled income is energy sitting in
  // containers, not a reason to demote miners into fat WCM harvesters.
  if ((ctx.minerCount ?? 0) > 0) return false;
  // Boot / never established a baseline: keep recruiting static miners instead
  // of abandoning the pipeline for mobile harvesters (CI miners sim + live).
  if ((ctx.baselineIncome ?? 0) <= 0) return false;
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
  experiment?: ExperimentProfile,
): boolean {
  const dedicated = useDedicatedMiners(
    rcl,
    containersAtSources,
    sourceCount,
    experiment,
  );
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

/** Prefer the next 200 on a missing builder, not another 100-energy hauler. */
function prioritizeBuilderAfterEconomy(
  order: Array<keyof CreepQuotas>,
): Array<keyof CreepQuotas> {
  const core: Array<keyof CreepQuotas> = order.filter(
    (role) => role !== "builder" && role !== "hauler",
  );
  const fillerIdx = core.indexOf("filler");
  const minerIdx = core.indexOf("miner");
  const insertAt =
    fillerIdx >= 0 ? fillerIdx + 1 : minerIdx >= 0 ? minerIdx + 1 : 0;
  const next = core.slice();
  next.splice(insertAt, 0, "builder");
  const builderIdx = next.indexOf("builder");
  next.splice(builderIdx + 1, 0, "hauler");
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
    /** No live upgrader while want.upgrader≥1 (RCL2+ controller seat). */
    upgraderSeatEmpty?: boolean;
    /** Experiment spawn-chain preference. */
    spawnChain?: ExperimentProfile["spawnChain"];
    /** Finished source-adjacent containers (static miner seats). */
    containersAtSources?: number;
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
  } else if (
    counts &&
    dedicatedMiners &&
    (counts.miner ?? 0) === 0 &&
    (opts?.containersAtSources ?? 0) > 0
  ) {
    // Empty miner seats beside finished source containers: recruit miners
    // before the no-economy hauler/harvester boot path. Do not use this for
    // drop-miner BASELINE boots with zero containers — those still need H/Ha.
    order = ["miner", "hauler", "harvester", "upgrader", "builder"];
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
  } else if (shouldFallbackToMobileHarvest(dedicatedMiners, ctx)) {
    // Hauler-first: containers may hold all room energy; hauler body costs 100 vs 150.
    order = ["hauler", "harvester", "upgrader", "builder"];
  } else if (needsBootstrapHarvester(dedicatedMiners, ctx)) {
    order = ["harvester", "hauler", "miner", "upgrader", "builder"];
  } else if (opts?.spawnChain === "miner_hauler" && dedicatedMiners) {
    order = ["miner", "hauler", "upgrader", "builder", "harvester"];
  } else {
    order = DEFAULT_SPAWN_ORDER;
  }

  if (opts?.infrastructurePush) {
    order = prioritizeInfrastructureBuilder(order);
    // With sources covered, spend the next 200 on builder #2 — not the spare harvester.
    if (opts.buildersBelowQuota && opts.economyFloorMet) {
      order = prioritizeBuilderOverSpareHarvester(order);
    }
  } else if (opts?.buildersBelowQuota && opts.economyFloorMet) {
    order = prioritizeBuilderAfterEconomy(order);
  }

  // RCL2 climb: empty upgrader seat must beat builders — overnight live runs
  // showed builder=5 / upgrader=0 while want.upgrader≥1 (sites starve controller).
  if (opts?.upgraderSeatEmpty && opts.economyFloorMet) {
    order = prioritizeUpgraderSeat(order);
  }
  return withFillerSlot(order);
}

/** Pull upgrader ahead of builder/hauler when the controller seat is empty. */
export function prioritizeUpgraderSeat(
  order: Array<keyof CreepQuotas>,
): Array<keyof CreepQuotas> {
  const without: Array<keyof CreepQuotas> = order.filter(
    (r) => r !== "upgrader",
  );
  const minerIdx = without.indexOf("miner");
  const harvesterIdx = without.indexOf("harvester");
  const insertAt =
    minerIdx >= 0 ? minerIdx + 1 : harvesterIdx >= 0 ? harvesterIdx + 1 : 0;
  const next: Array<keyof CreepQuotas> = without.slice();
  next.splice(insertAt, 0, "upgrader");
  return next;
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

  const fill = (q: Omit<CreepQuotas, "filler">): CreepQuotas => {
    const out: CreepQuotas = {
      ...q,
      filler: economy?.hasStorage
        ? fillerQuotaForPlan(economy?.fillerPlan)
        : 0,
    };
    // RCL2+: never park the downgrade timer (wipe / infra / extension push).
    if (rcl >= 2) out.upgrader = Math.max(1, out.upgrader);
    return out;
  };

  if (rcl <= 1) {
    return fill({
      harvester: 2,
      miner: 0,
      hauler: 0,
      upgrader: 1,
      builder: 0,
    });
  }

  // TooAngel-style universal window: mobile harvesters until capacity gate.
  const capacity = economy?.energyCapacityAvailable ?? 0;
  if (
    exp.universalUntilCapacity > 0 &&
    capacity < exp.universalUntilCapacity
  ) {
    return fill({
      harvester: sources + 2,
      miner: 0,
      hauler: 1,
      upgrader: Math.min(2, exp.upgraderQuotaClimb),
      builder: hasConstructionSites ? infraBuilders : 0,
    });
  }

  const dedicatedMiners = useDedicatedMiners(
    rcl,
    containersAtSources,
    sources,
    exp,
  );

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
  const hubSpend = isHubSpendMode(economy);
  // Fallback assume 1 WORK/source until spawn passes live miner WORK counts.
  const minerWorkParts = economy?.minerWorkParts ?? sources;
  const liveMiners = economy?.minerCount;
  // Unknown live count (pure tests) → assume staffed. Explicit 0 → keep a bridge harvester.
  // Any live miner: missing seats are miners, never a mobile WCM harvester.
  const minersStaffed = liveMiners == null || liveMiners >= sources;
  const haulers = haulerCountForMining(sources, minerWorkParts, {
    haulRange: economy?.haulRange,
  });

  // Only bank when live capacity is known — pure quota tests omit it.
  const bankForMiners =
    economy?.energyCapacityAvailable != null &&
    shouldBankForBetterMiners({
      energyCapacityAvailable: economy.energyCapacityAvailable,
      minerWorkParts,
      sourceCount: sources,
    });

  const quotas: CreepQuotas = {
    harvester: liveMiners === 0 ? Math.max(1, sources) : 0,
    miner: sources,
    hauler: haulers,
    upgrader: climbingToRcl3
      ? exp.upgraderQuotaClimb
      : extensionPush && !hubSpend
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
          ? bankForMiners || hubSpend
            ? Math.min(2, Math.max(1, infraBuilders))
            : Math.max(4, infraBuilders)
          : 0,
    filler: economy?.hasStorage
      ? fillerQuotaForPlan(economy?.fillerPlan)
      : 0,
  };

  if (needsBootstrapHarvester(true, economy)) {
    quotas.harvester = 1;
  }

  if (rcl >= 2) {
    quotas.upgrader = Math.max(1, quotas.upgrader);
  }
  if (hubSpend && rcl >= 4) {
    quotas.upgrader = Math.max(2, quotas.upgrader);
  }
  const modeQuotas = applyRcl5ModeQuotas(
    quotas,
    parseRcl5Mode(economy?.rcl5Mode),
    {
      rcl,
      hasStorage: economy?.hasStorage === true,
      hasConstructionSites,
      minerWorkParts,
      sources,
      extensionCount: economy?.extensionCount,
      towerCount: economy?.towerCount,
    },
  );
  return applyRcl5PlanQuotas(modeQuotas, economy?.rcl5Plan, {
    linksBuilt: economy?.linkCount ?? 0,
    hasConstructionSites,
  });
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
    /** Live miner WORK sum — gates extension build stages. */
    minerWorkParts?: number;
    /** Room energyCapacityAvailable — pause new sites while upgrading miners. */
    energyCapacityAvailable?: number;
    /** Sum of energy in finished source-adjacent containers. */
    sourceContainerEnergy?: number;
    /** Storage construction site already placed — finish before extension spam. */
    storageSiteOpen?: boolean;
    /** RCL5 climb mode — may pause extension/road spam. */
    rcl5Mode?: Rcl5Mode | string;
    experiment?: ExperimentProfile;
  },
): BuildableStructureConstant[] {
  const exp = opts.experiment ?? BASELINE_PROFILE;
  const mode = parseRcl5Mode(opts.rcl5Mode);
  // Climb-only: once RCL5 unlocks tower#2 + ext 30, resume hub build even if
  // Memory still says upgrade_rush (live aftercare must not freeze at 15–20 ext).
  const pauseExtSpam =
    opts.hasStorage && rcl < 5 && rcl5ModePausesExtensionSpam(mode);
  const queue: BuildableStructureConstant[] = [];
  const fullExtQuota = extensionQuota(rcl);
  const minerWorkParts = opts.minerWorkParts ?? 0;
  const stagedCap = stagedExtensionBuildCap({
    fullQuota: fullExtQuota,
    minerWorkParts,
    sourceCount: opts.sourceCount,
    rcl,
  });
  const bootstrapCap = extensionBootstrapCap(exp, rcl, fullExtQuota);
  const finishedExt = opts.extensionBuilt ?? 0;
  // Capacity already high but miners thin: spend energy on bodies, not new sites.
  const pauseExtSites =
    opts.energyCapacityAvailable != null &&
    finishedExt >= stagedCap &&
    shouldBankForBetterMiners({
      energyCapacityAvailable: opts.energyCapacityAvailable,
      minerWorkParts,
      sourceCount: opts.sourceCount,
    });
  const extCap = pauseExtSites
    ? finishedExt
    : Math.min(stagedCap, bootstrapCap);

  const missingAll = shouldBuildContainers(rcl)
    ? Math.max(0, opts.sourceCount - opts.sourceContainerCount)
    : 0;
  const containerSites = sourceContainerQueueCount(
    exp,
    missingAll,
    opts.sourceContainerSites ?? 0,
    opts.extensionBuilt ?? 0,
  );

  const prioritizeStorage =
    shouldBuildStorage(rcl) &&
    !opts.hasStorage &&
    (opts.storageSiteOpen === true ||
      sourceContainerEnergySurplus(opts.sourceContainerEnergy ?? 0));

  const laterMode = exp.containerTiming === "later";
  // later: bootstrap extensions before source containers.
  if (laterMode && shouldBuildExtensions(rcl)) {
    const have = opts.extensionCount ?? 0;
    const missing = Math.max(0, extCap - have);
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

  // Surplus / open site: hub storage before extension or controller-container spam.
  if (prioritizeStorage && containerSites === 0 && missingAll === 0) {
    queue.push("storage");
  }

  if (
    shouldBuildExtensions(rcl) &&
    !laterMode &&
    !pauseExtSpam &&
    containerSites === 0 &&
    missingAll === 0
  ) {
    const have = opts.extensionCount ?? 0;
    // Miner stages (3W→5W cap) further limited by RCL2 experiment bootstrap.
    const missing = Math.max(0, extCap - have);
    for (let i = 0; i < missing; i++) {
      queue.push("extension");
    }
  }

  // Controller container timing is experiment-driven (after storage when surplus).
  if (
    shouldBuildContainers(rcl) &&
    !opts.hasControllerContainer &&
    allowControllerContainer(exp, rcl, missingAll)
  ) {
    queue.push("container");
  }

  if (
    shouldBuildStorage(rcl) &&
    !opts.hasStorage &&
    !prioritizeStorage
  ) {
    queue.push("storage");
  }

  if (opts.roadSitesAllowed && !pauseExtSpam) {
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
