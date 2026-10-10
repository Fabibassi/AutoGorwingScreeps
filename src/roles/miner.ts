import {
  pickMinerSourceId,
  shouldWaitForIncumbentMiner,
} from "../earlyGame/minerHandoff";

function resolveMinerSource(creep: Creep): Source | null {
  const sources = creep.room.find(FIND_SOURCES);
  if (sources.length === 0) {
    return creep.memory.sourceId
      ? (Game.getObjectById(creep.memory.sourceId) as Source | null)
      : null;
  }

  const peers: Array<{ name: string; sourceId?: string }> = [];
  for (const name in Game.creeps ?? {}) {
    const other = Game.creeps[name];
    if (other.name === creep.name) continue;
    if (other.room.name !== creep.room.name) continue;
    if (other.memory.role !== "miner") continue;
    peers.push({ name: other.name, sourceId: other.memory.sourceId });
  }

  const pickedId = pickMinerSourceId({
    selfName: creep.name,
    selfSourceId: creep.memory.sourceId,
    sourceIds: sources.map((s) => s.id),
    peers,
    rangeTo: (sid) => {
      const src = sources.find((s) => s.id === sid);
      return src ? creep.pos.getRangeTo(src) : 99;
    },
  });

  if (pickedId) {
    creep.memory.sourceId = pickedId as Id<Source>;
    return (
      sources.find((s) => s.id === pickedId) ??
      (Game.getObjectById(pickedId as Id<Source>) as Source | null)
    );
  }

  const sticky = creep.memory.sourceId
    ? (Game.getObjectById(creep.memory.sourceId) as Source | null)
    : null;
  return sticky ?? sources[0] ?? null;
}

export function runMiner(creep: Creep): number {
  const source = resolveMinerSource(creep);
  if (!source) return 0;

  if (creep.pos.isNearTo(source)) {
    const peersNearSource: Array<{ name: string; ticksToLive?: number }> = [];
    for (const name in Game.creeps ?? {}) {
      const other = Game.creeps[name];
      if (other.name === creep.name) continue;
      if (other.memory.role !== "miner") continue;
      if (other.memory.sourceId !== source.id) continue;
      if (!other.pos.isNearTo(source)) continue;
      peersNearSource.push({ name: other.name, ticksToLive: other.ticksToLive });
    }
    if (shouldWaitForIncumbentMiner(creep, peersNearSource)) {
      return 0;
    }

    const code = creep.harvest(source);
    if (code === OK) {
      return creep.getActiveBodyparts(WORK) * 2;
    }
    // ERR_FULL (full container): stay put. Retreat+moveTo oscillates forever.
    return 0;
  }

  creep.moveTo(source, { visualizePathStyle: { stroke: "#44ff44" } });
  return 0;
}
