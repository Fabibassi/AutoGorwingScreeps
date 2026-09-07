export function runMiner(creep: Creep): number {
  const sourceId = creep.memory.sourceId as Id<Source> | undefined;
  const source =
    (sourceId ? Game.getObjectById(sourceId) : null) ??
    creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);

  if (!source) return 0;

  if (!sourceId) {
    creep.memory.sourceId = source.id;
  }

  if (creep.pos.isEqualTo(source.pos)) {
    return creep.harvest(source) === OK ? creep.getActiveBodyparts(WORK) * 2 : 0;
  }

  creep.moveTo(source, { visualizePathStyle: { stroke: "#44ff44" } });
  return 0;
}
