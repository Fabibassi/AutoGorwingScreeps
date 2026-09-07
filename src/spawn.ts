import {
  bodyForRole,
  desiredCreeps,
  type CreepQuotas,
} from "./earlyGame";

export { desiredCreeps, type CreepQuotas };
function countRoles(): CreepQuotas {
  const counts: CreepQuotas = {
    harvester: 0,
    miner: 0,
    hauler: 0,
    upgrader: 0,
    builder: 0,
  };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role as keyof CreepQuotas | undefined;
    if (role && role in counts) counts[role]++;
  }
  return counts;
}

function countSourceContainers(room: Room): number {
  const sources = room.find(FIND_SOURCES);
  let count = 0;
  for (const source of sources) {
    const near = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    if (near.length > 0) count++;
  }
  return count;
}

const SPAWN_ORDER: Array<keyof CreepQuotas> = [
  "miner",
  "hauler",
  "harvester",
  "upgrader",
  "builder",
];

export function runSpawn(spawn: StructureSpawn): void {
  if (spawn.spawning) return;

  const room = spawn.room;
  const rcl = room.controller?.level ?? 1;
  const sourceCount = room.find(FIND_SOURCES).length;
  const containersAtSources = countSourceContainers(room);
  const hasConstructionSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;
  const want = desiredCreeps(
    rcl,
    sourceCount,
    containersAtSources,
    hasConstructionSites,
  );
  const counts = countRoles();
  const energyAvailable = room.energyAvailable;

  for (const role of SPAWN_ORDER) {
    if (counts[role] >= want[role]) continue;
    const body = bodyForRole(role, energyAvailable);
    const name = `${role}-${Game.time}`;
    const memory: CreepMemory = { role };
    if (role === "miner") {
      const sources = room.find(FIND_SOURCES);
      const assigned = new Set<string>();
      for (const n in Game.creeps) {
        const c = Game.creeps[n];
        if (c.memory.role === "miner" && c.memory.sourceId) {
          assigned.add(c.memory.sourceId);
        }
      }
      const free = sources.find((s) => !assigned.has(s.id));
      if (free) memory.sourceId = free.id;
    }
    spawn.spawnCreep(body, name, { memory });
    return;
  }
}
