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
    if (spawn?.store[RESOURCE_ENERGY] > 0) {
      if (creep.withdraw(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(spawn);
      }
    }
    return 0;
  }

  const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
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
