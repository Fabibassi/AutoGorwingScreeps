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

/**
 * Prefer spawn tiles toward `to` so stationary CARRY haulers land adjacent to
 * storage (soft-lock recovery). Returns primary + two neighboring directions.
 */
export function directionsToward(
  from: { x: number; y: number },
  to: { x: number; y: number },
): DirectionConstant[] {
  const dx = Math.sign(to.x - from.x) as -1 | 0 | 1;
  const dy = Math.sign(to.y - from.y) as -1 | 0 | 1;
  if (dx === 0 && dy === 0) return [];

  // Screeps: TOP=1 … TOP_LEFT=8
  const table: Record<string, DirectionConstant> = {
    "0,-1": 1 as DirectionConstant,
    "1,-1": 2 as DirectionConstant,
    "1,0": 3 as DirectionConstant,
    "1,1": 4 as DirectionConstant,
    "0,1": 5 as DirectionConstant,
    "-1,1": 6 as DirectionConstant,
    "-1,0": 7 as DirectionConstant,
    "-1,-1": 8 as DirectionConstant,
  };
  const primary = table[`${dx},${dy}`];
  if (primary == null) return [];

  // Neighbors on the direction ring (1..8).
  const prev = (((primary - 2 + 8) % 8) + 1) as DirectionConstant;
  const next = ((primary % 8) + 1) as DirectionConstant;
  return [primary, prev, next];
}

/** Immobile emergency hauler with no adjacent energy — recycle to free sticky spawn. */
export function reclaimStrandedEmergencyHauler(spawn: StructureSpawn): boolean {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== spawn.room.name) continue;
    if (creep.memory.role !== "hauler") continue;
    if (creep.getActiveBodyparts(MOVE) > 0) continue;
    if ((creep.store[RESOURCE_ENERGY] ?? 0) > 0) continue;
    if (!creep.pos.isNearTo(spawn) && !creep.pos.isEqualTo(spawn.pos)) continue;

    const storage = creep.room.storage;
    const nearStorage =
      storage != null &&
      (storage.store[RESOURCE_ENERGY] ?? 0) > 0 &&
      creep.pos.isNearTo(storage);
    if (nearStorage) continue;

    const nearContainer =
      creep.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s): s is StructureContainer =>
          s.structureType === STRUCTURE_CONTAINER &&
          (s.store[RESOURCE_ENERGY] ?? 0) > 0,
      }).length > 0;
    if (nearContainer) continue;

    const nearDrop =
      creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 0,
      }).length > 0;
    if (nearDrop) continue;

    return spawn.recycleCreep(creep) === OK;
  }
  return false;
}

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
    // Convert every idle WORK body — one harvester cannot refill two sources.
  }
}

/**
 * During extension push, convert surplus upgraders into builders so 3k sites
 * get WORK instead of competing for the same spawn/container energy.
 */
export function reassignUpgraderToExtensionBuilder(
  room: Room,
  want: CreepQuotas,
  counts: CreepQuotas,
): boolean {
  if (counts.builder >= want.builder) return false;
  if (counts.upgrader <= want.upgrader) return false;

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;
    if (creep.memory.role !== "upgrader") continue;
    creep.memory.role = "builder";
    delete creep.memory.sourceId;
    return true;
  }
  return false;
}

/**
 * Restore missing static miners from surplus harvesters (e.g. after a false
 * income-collapse demotion while spawn was full).
 */
export function reassignSpareHarvesterToMiner(
  room: Room,
  want: CreepQuotas,
  counts: CreepQuotas,
): boolean {
  if (counts.miner >= want.miner) return false;
  if (counts.harvester <= want.harvester) return false;

  const sources = findSourcesWithContainers(room);
  const assigned = new Set<string>();
  for (const n in Game.creeps) {
    const c = Game.creeps[n];
    if (c.room.name !== room.name) continue;
    if (c.memory.role === "miner" && c.memory.sourceId) {
      assigned.add(c.memory.sourceId);
    }
  }
  const free = sources.find((s) => !assigned.has(s.id));
  if (!free) return false;

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;
    if (creep.memory.role !== "harvester") continue;
    creep.memory.role = "miner";
    creep.memory.sourceId = free.id;
    return true;
  }
  return false;
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
  containersAtSources = 0,
): boolean {
  if (!infrastructurePush) return false;
  if (counts.builder >= want.builder) return false;
  // Keep mobile harvesters only for sources still missing a container
  // (container-ready sources are covered by miners).
  const harvestFloor = Math.max(0, sourceCount - containersAtSources);
  if (counts.harvester <= harvestFloor) return false;

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

/**
 * Screeps can leave spawn.spawning stuck at remainingTime 0 (ERR_BUSY forever).
 *
 * remainingTime > 0: live spawn — never cancel (aborts the creep).
 * remainingTime === 0 + no creep: ghost — cancel immediately.
 * remainingTime === 0 + living creep: NEVER cancel — Spawning.cancel() deletes
 * the newborn even after birth (live soft-lock loop). Wait for the engine to
 * clear the flag; the living hauler can still refill spawn from adjacent storage.
 */
export function clearZombieSpawn(spawn: StructureSpawn): boolean {
  const spawning = spawn.spawning;
  const ags = typeof Memory !== "undefined" ? Memory.ags : undefined;

  if (!spawning) {
    if (ags) ags.zombieSpawnSeen = {};
    return false;
  }

  if (spawning.remainingTime > 0) {
    if (ags?.zombieSpawnSeen) delete ags.zombieSpawnSeen[spawning.name];
    return false;
  }

  const existing = Game.creeps[spawning.name];
  if (ags) {
    ags.zombieDebug = {
      tick: Game.time,
      spawningName: spawning.name,
      remainingTime: 0,
      ttl: existing?.ticksToLive,
      hasExact: existing != null,
      action: existing ? "wait-living" : "cancel-ghost",
    };
  }

  // Living creep: leave alone. cancel() aborts/deletes it (observed live).
  if (existing) return false;

  if (ags?.zombieSpawnSeen) delete ags.zombieSpawnSeen[spawning.name];
  const code = (
    spawning as { cancel?: () => ScreepsReturnCode }
  ).cancel?.();
  return code === OK;
}

export function runSpawn(spawn: StructureSpawn): void {
  clearZombieSpawn(spawn);
  // Free sticky spawn + reclaim energy from CARRY-only haulers on the wrong tile.
  if (reclaimStrandedEmergencyHauler(spawn)) return;

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
  // Rebalance even while spawn is busy — otherwise dead miners leave builders
  // stuck until the current spawnCreep finishes.
  reassignForEconomySurvival(room, counts);
  for (let n = 0; n < 10; n++) {
    const mid = countCreepsByRole();
    if (!reassignSpareHarvesterToMiner(room, want, mid)) break;
  }
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
    containersAtSources,
  );
  // Convert all surplus upgraders in one tick during extension push.
  for (let n = 0; n < 10; n++) {
    const mid = countCreepsByRole();
    if (!reassignUpgraderToExtensionBuilder(room, want, mid)) break;
  }
  const liveCounts = countCreepsByRole();

  // Any spawn.spawning (active OR sticky with live creep) → do not spawnCreep.
  if (spawn.spawning) {
    if (Memory.ags) {
      Memory.ags.lastSpawnFail = {
        tick: Game.time,
        role: `spawning:${spawn.spawning.name}`,
        result: ERR_BUSY,
        energyAvailable,
        bodyParts: spawn.spawning.remainingTime,
      };
    }
    return;
  }

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
  // Leave room for a miner body when mining is wiped (fat haulers ate 300+).
  const haulerMaxCost =
    liveCounts.miner === 0 && infrastructureDedicated ? 100 : undefined;

  for (const role of spawnOrder) {
    if (liveCounts[role] >= want[role]) continue;
    // Never spend on builders while sources have no harvester/miner.
    if (role === "builder" && !economyFloorMet) continue;
    const body = bodyForRole(role, energyAvailable, { haulerMaxCost });
    if (body.length === 0) continue;
    const name = `${role}-${Game.time}-${Math.floor(Math.random() * 1_000_000)}`;
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
    const opts: SpawnOptions = { memory };
    // Soft-lock CARRY-only: force spawn tile toward storage so withdraw works.
    if (
      role === "hauler" &&
      !body.includes(MOVE) &&
      room.storage &&
      (room.storage.store[RESOURCE_ENERGY] ?? 0) > 0
    ) {
      const dirs = directionsToward(spawn.pos, room.storage.pos);
      if (dirs.length > 0) opts.directions = dirs;
    }
    const result = spawn.spawnCreep(body, name, opts);
    if (result !== OK && Memory.ags) {
      Memory.ags.lastSpawnFail = {
        tick: Game.time,
        role,
        result,
        energyAvailable,
        bodyParts: body.length,
      };
    }
    if (result === OK) {
      return;
    }
  }
}
