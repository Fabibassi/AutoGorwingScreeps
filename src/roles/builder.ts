import { countSourceContainers } from "../room/queries";

/** Builders must not drain spawn energy needed to respawn harvesters/miners. */
export function canWithdrawFromSpawn(
  spawnEnergy: number,
  spawnCapacity: number,
  hasEconomyCreeps: boolean,
  opts?: { infrastructurePush?: boolean },
): boolean {
  if (!hasEconomyCreeps) return false;
  if (spawnCapacity <= 0) return false;
  const ratio = spawnEnergy / spawnCapacity;
  // Finish source containers even when spawn is only partly full.
  if (opts?.infrastructurePush) return ratio >= 0.4;
  return ratio >= 0.85;
}

function findBuildSite(creep: Creep): ConstructionSite | null {
  const sourceCount = creep.room.find(FIND_SOURCES).length;
  const containersAtSources = countSourceContainers(creep.room);
  if (containersAtSources < sourceCount) {
    const containerSite = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    if (containerSite) return containerSite;
  }
  return creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
}

export function runBuilder(creep: Creep): number {
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    // Self-feed: WORK builders harvest when logistics cannot spare spawn energy.
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
      const code = creep.harvest(source);
      if (code === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { visualizePathStyle: { stroke: "#ffffff" } });
      }
      if (code === OK || code === ERR_NOT_IN_RANGE) return 0;
    }

    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 20,
    });
    if (dropped) {
      if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
        creep.moveTo(dropped);
      }
      return 0;
    }

    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0,
    });
    if (container) {
      if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(container);
      }
      return 0;
    }

    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn) {
      const capacity = spawn.store.getCapacity(RESOURCE_ENERGY) ?? 0;
      const energy = spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
      let economyCreeps = 0;
      for (const name in Game.creeps) {
        const role = Game.creeps[name].memory.role;
        if (role === "harvester" || role === "miner") economyCreeps++;
      }
      const sourceCount = creep.room.find(FIND_SOURCES).length;
      const infrastructurePush =
        countSourceContainers(creep.room) < sourceCount &&
        creep.room.find(FIND_CONSTRUCTION_SITES).length > 0;
      if (
        canWithdrawFromSpawn(energy, capacity, economyCreeps > 0, {
          infrastructurePush,
        })
      ) {
        if (creep.withdraw(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(spawn);
        }
      }
    }
    return 0;
  }

  const site = findBuildSite(creep);
  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site);
    }
    return 0;
  }

  const controller = creep.room.controller;
  if (controller) {
    creep.upgradeController(controller);
  }
  return 0;
}
