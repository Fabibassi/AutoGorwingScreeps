import {
  bodyForRole,
  desiredCreeps,
  type CreepQuotas,
} from "./earlyGame";
import { countCreepsByRole, countSourceContainers } from "./room/queries";

export { desiredCreeps, type CreepQuotas };

/** Haulers before miners so spawn energy returns before static miners go out. */
const SPAWN_ORDER: Array<keyof CreepQuotas> = [
  "hauler",
  "miner",
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
  const spawnCapacity = spawn.store.getCapacity(RESOURCE_ENERGY) ?? 1;
  const spawnFillPct =
    spawn.store.getUsedCapacity(RESOURCE_ENERGY) / spawnCapacity;
  const want = desiredCreeps(
    rcl,
    sourceCount,
    containersAtSources,
    hasConstructionSites,
    {
      energyIncomePerTick: Memory.ags?.metrics.energyIncomePerTick ?? 0,
      spawnFillPct,
    },
  );
  const counts = countCreepsByRole();
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
