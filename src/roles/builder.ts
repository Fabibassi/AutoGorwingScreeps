/** Prefer source-container sites so RCL2+ unlocks miner/hauler pairs. */
export function pickConstructionSite(
  room: Room,
  sites: ConstructionSite[],
): ConstructionSite | null {
  if (sites.length === 0) return null;
  const sources = room.find(FIND_SOURCES);
  const sourceContainers = sites.filter((site) => {
    if (site.structureType !== STRUCTURE_CONTAINER) return false;
    return sources.some((source) => source.pos.getRangeTo(site) <= 2);
  });
  if (sourceContainers.length > 0) {
    return room.findClosestByPath(sourceContainers) ?? sourceContainers[0];
  }
  return room.findClosestByPath(sites);
}

/** Builders must not drain spawn energy needed to respawn harvesters/miners. */
export function canWithdrawFromSpawn(
  spawnEnergy: number,
  spawnCapacity: number,
  hasEconomyCreeps: boolean,
): boolean {
  if (!hasEconomyCreeps) return false;
  if (spawnCapacity <= 0) return false;
  return spawnEnergy / spawnCapacity >= 0.85;
}

export function runBuilder(creep: Creep): number {
  if (creep.store[RESOURCE_ENERGY] === 0) {
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
      if (canWithdrawFromSpawn(energy, capacity, economyCreeps > 0)) {
        if (creep.withdraw(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(spawn);
        }
      }
    }
    return 0;
  }

  const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
  const site = pickConstructionSite(creep.room, sites);
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
