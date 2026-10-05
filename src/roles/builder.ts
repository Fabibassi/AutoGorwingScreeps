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
  return (
    creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES) ??
    creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES)
  );
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

  const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0,
  });
  if (container) {
    if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(container);
    }
    return true;
  }

  const storage = creep.room.storage;
  if (storage && storage.store[RESOURCE_ENERGY] > 0) {
    if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage);
    }
    return true;
  }

  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return false;

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
    !canWithdrawFromSpawn(energy, capacity, economyCreeps > 0, {
      infrastructurePush: infrastructurePush || extensionPush,
      buildersBelowQuota: infrastructurePush && builders < 2,
    })
  ) {
    return false;
  }
  if (creep.withdraw(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(spawn);
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
        creep.moveTo(site, { visualizePathStyle: { stroke: "#ffffff" } });
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

  // Container push: self-harvest is still the fastest refill near sources.
  if (refillFromHarvest(creep)) return 0;
  refillFromLogistics(creep);
  return 0;
}
