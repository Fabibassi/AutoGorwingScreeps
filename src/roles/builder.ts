import {
  countSourceContainers,
  findSourceContainerSites,
} from "../room/queries";
import { HAUL_THRESHOLDS } from "./hauler";
import { INFRA_BUILDER_SPAWN_ENERGY } from "./harvester";

/**
 * Absolute spawn-energy gates for builder withdraw (spawn store is 300).
 * Never interpret these as % of storage (1M). Storage itself stays ungated —
 * builders may drain the overflow bank freely; only the spawn bank is protected.
 */
export const BUILDER_SPAWN_THRESHOLDS = {
  /** Normal / upgrader: only siphon when spawn is comfortable. */
  default: HAUL_THRESHOLDS.spawnComfortable,
  /** Hub logistics: half spawn is enough once source containers exist. */
  logistics: HAUL_THRESHOLDS.spawnUrgent,
  /** Finish containers / extension sites while spawn still holds a cheap refill. */
  infrastructure: 100,
} as const;

/** Builders must not drain spawn energy needed to respawn harvesters/miners. */
export function canWithdrawFromSpawn(
  spawnEnergy: number,
  spawnCapacity: number,
  hasEconomyCreeps: boolean,
  opts?: {
    infrastructurePush?: boolean;
    buildersBelowQuota?: boolean;
    /** Prefer hub refill over remote source containers. */
    logisticsRefill?: boolean;
    /** Miners missing — never siphon spawn under a 1W1M miner body. */
    minersBelowQuota?: boolean;
  },
): boolean {
  if (!hasEconomyCreeps) return false;
  if (spawnCapacity <= 0) return false;
  if (opts?.minersBelowQuota) {
    return spawnEnergy >= BUILDER_SPAWN_THRESHOLDS.default;
  }
  // 2nd infra builder missing: keep a full WORK+CARRY+MOVE body (+1 CARRY slack)
  // so spawnCreep can claim it before we siphon the bank back under 200.
  if (opts?.buildersBelowQuota) {
    return spawnEnergy >= INFRA_BUILDER_SPAWN_ENERGY + 50;
  }
  // Absolute spawn units — never spawnEnergy/capacity as if capacity were 1M storage.
  if (opts?.infrastructurePush) {
    return spawnEnergy >= BUILDER_SPAWN_THRESHOLDS.infrastructure;
  }
  if (opts?.logisticsRefill) {
    return spawnEnergy >= BUILDER_SPAWN_THRESHOLDS.logistics;
  }
  return spawnEnergy >= BUILDER_SPAWN_THRESHOLDS.default;
}

/**
 * Once source containers exist, self-harvest fights static miners and starves
 * extension builds. Prefer hauler logistics (containers/storage/spawn) instead.
 */
export function preferLogisticsRefill(
  containersAtSources: number,
  sourceCount: number,
): boolean {
  return containersAtSources >= Math.max(1, sourceCount);
}

export type LogisticsKind = "spawn" | "storage" | "container";

/**
 * Prefer hub energy (spawn/storage) over remote mining containers.
 * Score = kind bonus + energy − range; skip crumb containers far away.
 */
export function pickClosestLogisticsEnergy(
  candidates: Array<{
    id: string;
    energy: number;
    range: number;
    kind?: LogisticsKind;
  }>,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    if (c.energy <= 0) continue;
    const kind = c.kind ?? "container";
    if (kind === "container" && c.energy < 100 && c.range > 6) continue;
    const kindBonus = kind === "spawn" ? 80 : kind === "storage" ? 60 : 0;
    const score = kindBonus + Math.min(c.energy, 500) / 25 - c.range * 2;
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best?.id ?? null;
}

/** Prefer sites closest to completion so spawn-adjacent nearly-done extensions finish. */
export function pickBuildSite<
  T extends { progress: number; progressTotal: number; range: number },
>(sites: T[]): T | null {
  if (sites.length === 0) return null;
  let best = sites[0];
  for (const site of sites) {
    const remain = Math.max(0, site.progressTotal - site.progress);
    const bestRemain = Math.max(0, best.progressTotal - best.progress);
    if (remain < bestRemain || (remain === bestRemain && site.range < best.range)) {
      best = site;
    }
  }
  return best;
}

function findBuildSite(creep: Creep): ConstructionSite | null {
  const sourceCount = creep.room.find(FIND_SOURCES).length;
  const containersAtSources = countSourceContainers(creep.room);
  if (containersAtSources < sourceCount) {
    const sourceSites = findSourceContainerSites(creep.room);
    if (sourceSites.length > 0) {
      return (
        creep.pos.findClosestByPath(sourceSites) ??
        creep.pos.findClosestByRange(sourceSites)
      );
    }
  }
  let sites = creep.room.find(FIND_CONSTRUCTION_SITES);
  // Roads finish faster (300 vs 3000) and steal WORK under remaining-progress pick.
  if (containersAtSources >= sourceCount) {
    const extensions = sites.filter(
      (s) => s.structureType === STRUCTURE_EXTENSION,
    );
    if (extensions.length > 0) sites = extensions;
  }
  const picked = pickBuildSite(
    sites.map((site) => ({
      site,
      progress: site.progress,
      progressTotal: site.progressTotal,
      range: creep.pos.getRangeTo(site),
    })),
  );
  return picked?.site ?? null;
}

function refillFromLogistics(creep: Creep): boolean {
  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 20,
  });
  if (dropped) {
    if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
      creep.moveTo(dropped);
    }
    return true;
  }

  type StoreStruct = StructureContainer | StructureStorage | StructureSpawn;
  const byId = new Map<string, StoreStruct>();
  type Ranked = {
    id: string;
    energy: number;
    range: number;
    kind: LogisticsKind;
  };
  const rankedTyped: Ranked[] = [];

  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0,
  });
  for (const c of containers) {
    byId.set(c.id, c);
    rankedTyped.push({
      id: c.id,
      energy: c.store[RESOURCE_ENERGY],
      range: creep.pos.getRangeTo(c),
      kind: "container",
    });
  }

  const storage = creep.room.storage;
  if (storage && storage.store[RESOURCE_ENERGY] > 0) {
    byId.set(storage.id, storage);
    rankedTyped.push({
      id: storage.id,
      energy: storage.store[RESOURCE_ENERGY],
      range: creep.pos.getRangeTo(storage),
      kind: "storage",
    });
  }

  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn) {
    const capacity = spawn.store.getCapacity(RESOURCE_ENERGY) ?? 0;
    const energy = spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
    let economyCreeps = 0;
    let builders = 0;
    let miners = 0;
    for (const name in Game.creeps) {
      const role = Game.creeps[name].memory.role;
      if (role === "harvester" || role === "miner") economyCreeps++;
      if (role === "builder") builders++;
      if (role === "miner") miners++;
    }
    const sourceCount = creep.room.find(FIND_SOURCES).length;
    const containersAtSources = countSourceContainers(creep.room);
    const hasSites = creep.room.find(FIND_CONSTRUCTION_SITES).length > 0;
    const infrastructurePush =
      containersAtSources < sourceCount && hasSites;
    // Extension push: allow spawn siphon at infra thresholds so 3k sites move.
    const extensionPush =
      !infrastructurePush &&
      hasSites &&
      preferLogisticsRefill(containersAtSources, sourceCount);
    const logisticsRefill = preferLogisticsRefill(
      containersAtSources,
      sourceCount,
    );
    if (
      canWithdrawFromSpawn(energy, capacity, economyCreeps > 0, {
        infrastructurePush: infrastructurePush || extensionPush,
        buildersBelowQuota: infrastructurePush && builders < 2,
        logisticsRefill,
        minersBelowQuota:
          preferLogisticsRefill(containersAtSources, sourceCount) &&
          miners < sourceCount,
      })
    ) {
      byId.set(spawn.id, spawn);
      rankedTyped.push({
        id: spawn.id,
        energy,
        range: creep.pos.getRangeTo(spawn),
        kind: "spawn",
      });
    }
  }

  const bestId = pickClosestLogisticsEnergy(rankedTyped);
  if (!bestId) return false;
  const target = byId.get(bestId);
  if (!target) return false;
  if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target);
  }
  return true;
}

function refillFromHarvest(creep: Creep): boolean {
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
  if (!source) return false;
  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
  }
  return true;
}

export function runBuilder(creep: Creep): number {
  // Build with any carried energy — waiting for a full store left sites at 0/5000.
  if (creep.store[RESOURCE_ENERGY] > 0) {
    const site = findBuildSite(creep);
    if (site) {
      if (creep.build(site) === ERR_NOT_IN_RANGE) {
        creep.moveTo(site, { range: 3, visualizePathStyle: { stroke: "#ffffff" } });
      }
      return 0;
    }
    const controller = creep.room.controller;
    if (controller) {
      if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller);
      }
    }
    return 0;
  }

  const sourceCount = creep.room.find(FIND_SOURCES).length;
  const containersAtSources = countSourceContainers(creep.room);
  const useLogistics = preferLogisticsRefill(containersAtSources, sourceCount);

  // Dedicated mining online: never contest source tiles — pull from logistics.
  if (useLogistics) {
    refillFromLogistics(creep);
    return 0;
  }

  // Container push: self-harvest next to source-adjacent sites. Walking to a
  // distant storage bank then back costs more ticks than local harvest cycles.
  if (refillFromHarvest(creep)) return 0;
  refillFromLogistics(creep);
  return 0;
}
