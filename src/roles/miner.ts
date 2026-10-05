/** Step off a saturated source so haulers can drain and harvesters can recover income. */
function retreatFromFullSource(creep: Creep): void {
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn) {
    creep.moveTo(spawn, {
      range: 1,
      visualizePathStyle: { stroke: "#88ff88" },
    });
    return;
  }
  const controller = creep.room.controller;
  if (controller) {
    creep.moveTo(controller, { range: 3 });
  }
}

export function runMiner(creep: Creep): number {
  const sourceId = creep.memory.sourceId as Id<Source> | undefined;
  const source =
    (sourceId ? Game.getObjectById(sourceId) : null) ??
    creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);

  if (!source) return 0;

  if (!sourceId) {
    creep.memory.sourceId = source.id;
  }

  // Sources are not walkable — mine from an adjacent tile (often the container).
  if (creep.pos.isNearTo(source)) {
    const code = creep.harvest(source);
    if (code === OK) {
      return creep.getActiveBodyparts(WORK) * 2;
    }
    // Drop-mine into a full container returns ERR_FULL at runtime; @types/screeps
    // omits it from harvest()'s return type, so compare numerically.
    if ((code as number) === ERR_FULL) {
      retreatFromFullSource(creep);
    }
    return 0;
  }

  creep.moveTo(source, { visualizePathStyle: { stroke: "#44ff44" } });
  return 0;
}
