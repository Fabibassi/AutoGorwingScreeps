import {
  bodyForRole,
  desiredCreeps,
  hasNoEconomyCreeps,
  needsInfrastructureBuilder,
  shouldFallbackToMobileHarvest,
  spawnPriorityOrder,
  useDedicatedMiners,
  type CreepQuotas,
} from "./earlyGame";
import {
  countCreepsByRole,
  countSourceContainers,
  findSourcesWithContainers,
} from "./room/queries";

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

/**
 * Instantly restore a missing infra builder from a spare harvester.
 * Waiting for a fresh 200-energy spawn stalls container finish when B dies.
 */
export function reassignSpareHarvesterToInfraBuilder(
  room: Room,
  want: CreepQuotas,
  counts: CreepQuotas,
  infrastructurePush: boolean,
  sourceCount: number,
): boolean {
  if (!infrastructurePush) return false;
  if (counts.builder >= want.builder) return false;
  // Keep at least one mobile harvester per source.
  if (counts.harvester <= sourceCount) return false;

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;
    if (creep.memory.role !== "harvester") continue;
    creep.memory.role = "builder";
    delete creep.memory.sourceId;
    return true;
  }
  return false;
}

/** Recycle carry-less creeps next to spawn to claw energy back toward a hauler spawn. */
export function recycleCarryLessBootstrap(spawn: StructureSpawn): boolean {
  if (spawn.spawning) return false;
  if (spawn.room.energyAvailable >= 100) return false;

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== spawn.room.name) continue;
    if (creep.getActiveBodyparts(CARRY) > 0) continue;
    if (creep.getActiveBodyparts(WORK) === 0) continue;
    if (creep.pos.isNearTo(spawn)) {
      return spawn.recycleCreep(creep) === OK;
    }
    creep.moveTo(spawn);
    return true;
  }
  return false;
}

/**
 * WORK+MOVE legacy creeps cannot transfer/build/upgrade. When we can afford a
 * real WORK+CARRY+MOVE worker, recycle one so spawn quotas can replace it.
 */
export function recycleCarryLessWorker(spawn: StructureSpawn): boolean {
  if (spawn.spawning) return false;
  if (spawn.room.energyAvailable < 200) return false;

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== spawn.room.name) continue;
    if (creep.getActiveBodyparts(CARRY) > 0) continue;
    if (creep.getActiveBodyparts(WORK) === 0) continue;
    const role = creep.memory.role;
    if (role !== "harvester" && role !== "builder" && role !== "upgrader") {
      continue;
    }
    if (creep.pos.isNearTo(spawn)) {
      return spawn.recycleCreep(creep) === OK;
    }
    creep.moveTo(spawn);
    return true;
  }
  return false;
}

/**
 * Source-container push wants hauler=0 / builder=2. Leftover haulers reclaim no
 * energy (no containers yet) and keep spawn below the second builder body cost.
 */
export function recycleExcessHaulers(
  spawn: StructureSpawn,
  want: CreepQuotas,
  counts: CreepQuotas,
  infrastructurePush: boolean,
): boolean {
  if (spawn.spawning) return false;
  if (!infrastructurePush) return false;
  if (counts.builder >= want.builder) return false;
  if (counts.hauler <= want.hauler) return false;

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== spawn.room.name) continue;
    if (creep.memory.role !== "hauler") continue;
    if (creep.pos.isNearTo(spawn)) {
      return spawn.recycleCreep(creep) === OK;
    }
    creep.moveTo(spawn);
    return true;
  }
  return false;
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
  const energyAvailable = room.energyAvailable;
  const economy = {
    energyIncomePerTick: Memory.ags?.metrics.energyIncomePerTick ?? 0,
    baselineIncome: Memory.ags?.baseline?.energyIncomePerTick,
    spawnFillPct,
    energyAvailable,
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
  const infrastructurePush = needsInfrastructureBuilder(
    rcl,
    containersAtSources,
    sourceCount,
    hasConstructionSites,
  );
  reassignSpareHarvesterToInfraBuilder(
    room,
    want,
    countCreepsByRole(),
    infrastructurePush,
    sourceCount,
  );
  // Recount after possible role reassignment so quotas/spawn order stay consistent.
  const liveCounts = countCreepsByRole();

  const hasCarry = Object.keys(Game.creeps).some(
    (n) => Game.creeps[n].getActiveBodyparts(CARRY) > 0,
  );
  if (!hasCarry && energyAvailable < 100) {
    if (recycleCarryLessBootstrap(spawn)) return;
  }
  // Replace legacy WORK+MOVE workers so building/upgrading can resume.
  if (energyAvailable >= 200) {
    if (recycleCarryLessWorker(spawn)) return;
  }

  if (recycleExcessHaulers(spawn, want, liveCounts, infrastructurePush)) {
    return;
  }
  const buildersBelowQuota = liveCounts.builder < want.builder;
  const economyFloorMet =
    liveCounts.harvester + liveCounts.miner >= sourceCount;
  const spawnOrder = spawnPriorityOrder(
    infrastructureDedicated,
    economy,
    liveCounts,
    energyAvailable,
    { infrastructurePush, buildersBelowQuota, economyFloorMet },
  );

  for (const role of spawnOrder) {
    if (liveCounts[role] >= want[role]) continue;
    const body = bodyForRole(role, energyAvailable);
    if (body.length === 0) continue;
    const name = `${role}-${Game.time}`;
    const memory: CreepMemory = { role };
    if (role === "miner") {
      // Prefer finished container sources so early miners do not sit on bare drops.
      const sources = findSourcesWithContainers(room);
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
