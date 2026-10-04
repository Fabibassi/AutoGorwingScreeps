import {
  bodyForRole,
  desiredCreeps,
  hasNoEconomyCreeps,
  shouldFallbackToMobileHarvest,
  spawnPriorityOrder,
  useDedicatedMiners,
  type CreepQuotas,
} from "./earlyGame";
import { countCreepsByRole, countSourceContainers } from "./room/queries";

export { desiredCreeps, type CreepQuotas };

/** Reassign idle non-economy creeps to harvester when mining capacity is zero. */
export function reassignForEconomySurvival(
  room: Room,
  counts: CreepQuotas,
): void {
  if (!hasNoEconomyCreeps(counts)) return;

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;
    if (creep.memory.role !== "builder" && creep.memory.role !== "upgrader") {
      continue;
    }
    creep.memory.role = "harvester";
    delete creep.memory.sourceId;
    return;
  }
}

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
  const economy = {
    energyIncomePerTick: Memory.ags?.metrics.energyIncomePerTick ?? 0,
    baselineIncome: Memory.ags?.baseline?.energyIncomePerTick,
    spawnFillPct,
  };
  const infrastructureDedicated = useDedicatedMiners(
    rcl,
    containersAtSources,
    sourceCount,
  );

  if (shouldFallbackToMobileHarvest(infrastructureDedicated, economy)) {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.room.name !== room.name || creep.memory.role !== "miner") continue;
      creep.memory.role = "harvester";
      delete creep.memory.sourceId;
    }
  }

  const want = desiredCreeps(
    rcl,
    sourceCount,
    containersAtSources,
    hasConstructionSites,
    economy,
  );
  const counts = countCreepsByRole();
  reassignForEconomySurvival(room, counts);
  // Recount after possible role reassignment so quotas/spawn order stay consistent.
  const liveCounts = countCreepsByRole();
  const energyAvailable = room.energyAvailable;
  const spawnOrder = spawnPriorityOrder(
    infrastructureDedicated,
    economy,
    liveCounts,
  );

  for (const role of spawnOrder) {
    if (liveCounts[role] >= want[role]) continue;
    const body = bodyForRole(role, energyAvailable);
    if (body.length === 0) continue;
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
    if (spawn.spawnCreep(body, name, { memory }) === OK) {
      return;
    }
  }
}
