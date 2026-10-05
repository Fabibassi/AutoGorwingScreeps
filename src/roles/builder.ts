import {
  countSourceContainers,
  findSourceContainerSites,
} from "../room/queries";
import { INFRA_BUILDER_SPAWN_ENERGY } from "./harvester";

/** Builders must not drain spawn energy needed to respawn harvesters/miners. */
export function canWithdrawFromSpawn(
  spawnEnergy: number,
  spawnCapacity: number,
  hasEconomyCreeps: boolean,
  opts?: { infrastructurePush?: boolean; buildersBelowQuota?: boolean },
): boolean {
  if (!hasEconomyCreeps) return false;
  if (spawnCapacity <= 0) return false;
  const ratio = spawnEnergy / spawnCapacity;
  // 2nd infra builder missing: keep a full WORK+CARRY+MOVE body (+1 CARRY slack)
  // so spawnCreep can claim it before we siphon the bank back under 200.
  if (opts?.buildersBelowQuota) {
    return spawnEnergy >= INFRA_BUILDER_SPAWN_ENERGY + 50;
  }
  // ~35%: allow builders to finish source containers while spawn still banks a
  // cheap refill (hauler/partial). Do not use this path while buildersBelowQuota.
  if (opts?.infrastructurePush) return ratio >= 0.35;
  return ratio >= 0.85;
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

/** Closest store with energy — avoids walking to far source containers while spawn/storage sit full. */
export function pickClosestLogisticsEnergy(
  candidates: Array<{ id: string; energy: number; range: number }>,
): string | null {
  let best: { id: string; range: number } | null = null;
  for (const c of candidates) {
    if (c.energy <= 0) continue;
    if (!best || c.range < best.range) best = { id: c.id, range: c.range };
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
  const ranked: Array<{ id: string; energy: number; range: number }> = [];

  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0,
  });
  for (const c of containers) {
    byId.set(c.id, c);
    ranked.push({
      id: c.id,
      energy: c.store[RESOURCE_ENERGY],
      range: creep.pos.getRangeTo(c),
    });
  }

  const storage = creep.room.storage;
  if (storage && storage.store[RESOURCE_ENERGY] > 0) {
    byId.set(storage.id, storage);
    ranked.push({
      id: storage.id,
      energy: storage.store[RESOURCE_ENERGY],
      range: creep.pos.getRangeTo(storage),
    });
  }

  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn) {
    const capacity = spawn.store.getCapacity(RESOURCE_ENERGY) ?? 0;
    const energy = spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
    let economyCreeps = 0;
    let builders = 0;
    for (const name in Game.creeps) {
      const role = Game.creeps[name].memory.role;
      if (role === "harvester" || role === "miner") economyCreeps++;
      if (role === "builder") builders++;
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
    if (
      canWithdrawFromSpawn(energy, capacity, economyCreeps > 0, {
        infrastructurePush: infrastructurePush || extensionPush,
        buildersBelowQuota: infrastructurePush && builders < 2,
      })
    ) {
      byId.set(spawn.id, spawn);
      ranked.push({
        id: spawn.id,
        energy,
        range: creep.pos.getRangeTo(spawn),
      });
    }
  }

  const bestId = pickClosestLogisticsEnergy(ranked);
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

  // Dedicated mining online: do not contest source tiles — pull from logistics.
  if (useLogistics) {
    if (refillFromLogistics(creep)) return 0;
    refillFromHarvest(creep);
    return 0;
  }

  // Container push: self-harvest next to source-adjacent sites. Walking to a
  // distant storage bank then back costs more ticks than local harvest cycles.
  if (refillFromHarvest(creep)) return 0;
  refillFromLogistics(creep);
  return 0;
}
