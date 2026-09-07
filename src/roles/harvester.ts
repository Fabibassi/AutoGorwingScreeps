export function runHarvester(creep: Creep): number {
  let harvested = 0;
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
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawn);
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
