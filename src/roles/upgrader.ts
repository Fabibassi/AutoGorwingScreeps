export function runUpgrader(creep: Creep): void {
  if (creep.store[RESOURCE_ENERGY] === 0) {
    const controller = creep.room.controller;
    if (controller) {
      const container = controller.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: (s): s is StructureContainer =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      })[0];
      if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(container);
        }
        return;
      }
    }

    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    if (spawn.store[RESOURCE_ENERGY] > 0) {
      if (creep.withdraw(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(spawn);
      }
    }
    return;
  }
  const controller = creep.room.controller;
  if (!controller) return;
  if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller);
  }
}
