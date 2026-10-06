import {
  pickMinerSourceId,
  shouldWaitForIncumbentMiner,
} from "../earlyGame/minerHandoff";

const STEP_DELTAS: Array<[number, number, number]> = [
  [0, -1, 1],
  [1, -1, 2],
  [1, 0, 3],
  [1, 1, 4],
  [0, 1, 5],
  [-1, 1, 6],
  [-1, 0, 7],
  [-1, -1, 8],
];

/** Step one tile off a full container; never walk to the spawn ring. */
function retreatFromFullSource(creep: Creep, source: Source): void {
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  for (const [dx, dy, dir] of STEP_DELTAS) {
    const x = creep.pos.x + dx;
    const y = creep.pos.y + dy;
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    const toSource = Math.max(
      Math.abs(x - source.pos.x),
      Math.abs(y - source.pos.y),
    );
    if (toSource < 1 || toSource > 2) continue;
    if (spawn) {
      const toSpawn = Math.max(
        Math.abs(x - spawn.pos.x),
        Math.abs(y - spawn.pos.y),
      );
      if (toSpawn <= 1) continue;
    }
    const code = creep.move(dir as DirectionConstant);
    if (code === OK) return;
  }
}

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
    // Drop-mine into a full container returns ERR_FULL at runtime; @types/screeps
    // omits it from harvest()'s return type, so compare numerically.
    if ((code as number) === ERR_FULL) {
      retreatFromFullSource(creep, source);
    }
    return 0;
  }

  creep.moveTo(source, { visualizePathStyle: { stroke: "#44ff44" } });
  return 0;
}
