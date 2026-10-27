/**
 * Basic tower AI: attack → heal → hub ramparts → roads/containers.
 * Keep energy cost modest; haulers refill towers via findEnergyTarget.
 */

/** Soft floor for hub ramparts — towers top them up; builders push further. */
export const HUB_RAMPART_TOWER_HITS = 50_000;

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

  const weakRamparts =
    hostiles.length === 0
      ? room.find(FIND_MY_STRUCTURES, {
          filter: (s): s is StructureRampart =>
            s.structureType === STRUCTURE_RAMPART &&
            s.hits < Math.min(s.hitsMax, HUB_RAMPART_TOWER_HITS),
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

    if (weakRamparts.length > 0) {
      const rampart = tower.pos.findClosestByRange(weakRamparts);
      if (rampart) {
        tower.repair(rampart);
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
