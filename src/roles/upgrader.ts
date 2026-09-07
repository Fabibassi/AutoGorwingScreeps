export function runUpgrader(creep: Creep): void {
  if (creep.store[RESOURCE_ENERGY] === 0) {
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
