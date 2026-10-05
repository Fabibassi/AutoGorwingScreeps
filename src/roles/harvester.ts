import { countSourceContainers } from "../room/queries";

/** Prefer finishing source containers over controller when spawn is not starving. */
export function shouldBuildSourceContainers(
  spawnFillPct: number,
  containersAtSources: number,
  sourceCount: number,
): boolean {
  if (containersAtSources >= Math.max(1, sourceCount)) return false;
  return spawnFillPct >= 0.5;
}

export function runHarvester(creep: Creep): number {
  let harvested = 0;
  const capacity = creep.store.getCapacity(RESOURCE_ENERGY) ?? 0;

  // WORK+MOVE bootstrap (legacy): drop-mine so a hauler can scoop.
  if (capacity === 0) {
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (!source) return 0;
    const code = creep.harvest(source);
    if (code === OK) {
      const work = creep.getActiveBodyparts(WORK);
      harvested = work * 2;
    } else if (code === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
    return harvested;
  }

  if (creep.store.getFreeCapacity() > 0) {
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (!source) return 0;
    const code = creep.harvest(source);
    if (code === OK) {
      const work = creep.getActiveBodyparts(WORK);
      harvested = work * 2; // HARVEST_POWER
    } else if (code === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
    return harvested;
  }

  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    const capacitySpawn = spawn.store.getCapacity(RESOURCE_ENERGY) ?? 1;
    const fill =
      (spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) / capacitySpawn;
    const sources = creep.room.find(FIND_SOURCES).length;
    const atSources = countSourceContainers(creep.room);
    // Spawn already healthy: put overflow into source-container sites (unlocks miners).
    if (shouldBuildSourceContainers(fill, atSources, sources)) {
      const site =
        creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
          filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        }) ??
        creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES, {
          filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        });
      if (site) {
        if (creep.build(site) === ERR_NOT_IN_RANGE) {
          creep.moveTo(site, { visualizePathStyle: { stroke: "#ffffff" } });
        }
        return 0;
      }
    }
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawn);
    }
    return 0;
  }

  // Spawn full: build containers before upgrading.
  const sources = creep.room.find(FIND_SOURCES).length;
  const atSources = countSourceContainers(creep.room);
  if (atSources < sources) {
    const site =
      creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }) ??
      creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      });
    if (site) {
      if (creep.build(site) === ERR_NOT_IN_RANGE) {
        creep.moveTo(site, { visualizePathStyle: { stroke: "#ffffff" } });
      }
      return 0;
    }
  }

  const controller = creep.room.controller;
  if (controller) {
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller);
    }
  }
  return 0;
}
