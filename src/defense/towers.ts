/**
 * Basic tower AI: attack hostiles → heal friendlies → repair roads/containers.
 * Keep energy cost modest; haulers refill towers via findEnergyTarget.
 */
export function runTowers(room: Room): void {
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureTower => s.structureType === STRUCTURE_TOWER,
  });
  if (towers.length === 0) return;

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const hurtFriends =
    hostiles.length === 0
      ? room.find(FIND_MY_CREEPS, {
          filter: (c) => c.hits < c.hitsMax,
        })
      : [];

  for (const tower of towers) {
    if ((tower.store[RESOURCE_ENERGY] ?? 0) < 10) continue;

    if (hostiles.length > 0) {
      const target = tower.pos.findClosestByRange(hostiles);
      if (target) {
        tower.attack(target);
        continue;
      }
    }

    if (hurtFriends.length > 0) {
      const friend = tower.pos.findClosestByRange(hurtFriends);
      if (friend) {
        tower.heal(friend);
        continue;
      }
    }

    const damaged = room.find(FIND_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_ROAD ||
          s.structureType === STRUCTURE_CONTAINER) &&
        s.hits < s.hitsMax * 0.7,
    });
    if (damaged.length > 0) {
      const struct = tower.pos.findClosestByRange(damaged);
      if (struct) tower.repair(struct);
    }
  }
}
