import {
  bodyForRole,
  homeHaulerBodyBudget,
  desiredCreeps,
  effectiveMinerMinWork,
  hasNoEconomyCreeps,
  linkQuota,
  minerBodyCost,
  minerMinWorkForSpawn,
  minerTargetWorkParts,
  needsInfrastructureBuilder,
  rcl6CapexIncomplete,
  shouldBankForBetterMiners,
  shouldFallbackToMobileHarvest,
  spawnPriorityOrder,
  useDedicatedMiners,
  type CreepQuotas,
} from "./earlyGame";
import {
  durableCount,
  durableMinerCount,
  hasUncoveredMinerSeat,
  minerLiveCap,
  minerReplacementLeadTime,
  minerSpawnSeatsWanted,
  sourceIdForReplacementMiner,
} from "./earlyGame/minerHandoff";
import { resolveExperiment } from "./earlyGame/experimentPolicy";
import {
  hubRampartSitesOpen,
  hubRampartsReady,
} from "./earlyGame/wallArm";
import {
  parseUpgradeStyle,
  upgradeStyleStatic,
} from "./earlyGame/upgradeStyle";
import {
  fillerMaxCostForPlan,
  shouldDeferFatFillerSpawn,
} from "./earlyGame/fillerPlan";
import {
  countCreepsByRole,
  countSourceContainers,
  countStructures,
  findSourcesWithContainers,
  healCreepRoles,
  sumSourceContainerEnergy,
} from "./room/queries";
import { storageBlackoutReserve } from "./roles/hauler";
import { recycleExcessRemoteHaulers, trySpawnRemote } from "./spawnRemote";

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

/** Immobile emergency hauler with no adjacent energy — recycle only (no suicide). */
export function reclaimStrandedEmergencyHauler(spawn: StructureSpawn): boolean {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== spawn.room.name) continue;
    if (creep.memory.role !== "hauler") continue;
    if (creep.getActiveBodyparts(MOVE) > 0) continue;
    if ((creep.store[RESOURCE_ENERGY] ?? 0) > 0) continue;
    // Only reclaim if next to spawn so energy returns to the bank.
    if (!creep.pos.isNearTo(spawn) && !creep.pos.isEqualTo(spawn.pos)) continue;

    const storage = creep.room.storage;
    const nearStorage =
      storage != null &&
      (storage.store[RESOURCE_ENERGY] ?? 0) > 0 &&
      creep.pos.isNearTo(storage);
    if (nearStorage) continue;

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
 * When builder quota drops (no construction sites), convert surplus builders
 * into upgraders so WORK keeps climbing instead of idling as "builder".
 * Callers should gate on RCL>=3 so early site gaps do not strip builders.
 */
export function reassignSurplusBuilderToUpgrader(
  room: Room,
  want: CreepQuotas,
  counts: CreepQuotas,
): boolean {
  if (counts.builder <= want.builder) return false;

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;
    if (creep.memory.role !== "builder") continue;
    if (!creepHasWork(creep)) continue;
    creep.memory.role = "upgrader";
    delete creep.memory.sourceId;
    return true;
  }
  return false;
}

/**
 * Instant controller keep-alive after a wipe: promote a WORK body to upgrader
 * instead of waiting a full spawn cycle while ticksToDowngrade bleeds.
 */
function creepHasWork(creep: Creep): boolean {
  if (creep.getActiveBodyparts(WORK) >= 1) return true;
  // Fallback if WORK global/bodyparts misbehave in a runtime — still promote.
  const body = creep.body;
  if (!Array.isArray(body)) return false;
  return body.some((p) => {
    const t =
      typeof p === "string"
        ? p
        : typeof p === "object" && p != null
          ? (p as { type?: string }).type
          : undefined;
    return t === WORK || t === "work";
  });
}

export function reassignForControllerSurvival(
  room: Room,
  want: CreepQuotas,
  counts: CreepQuotas,
): boolean {
  if (want.upgrader < 1) return false;
  if (counts.upgrader >= want.upgrader) return false;

  const donors: Array<"builder" | "harvester"> = ["builder", "harvester"];
  const seatEmpty = counts.upgrader === 0;
  for (const role of donors) {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.room.name !== room.name) continue;
      if (creep.memory.role !== role) continue;
      // Empty controller seat: promote even if WORK detection fails in a runtime.
      if (!seatEmpty && !creepHasWork(creep)) continue;
      creep.memory.role = "upgrader";
      delete creep.memory.sourceId;
      return true;
    }
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
  const harvestFloor = Math.max(
    0,
    sourceCount - containersAtSources,
    want.miner - counts.miner,
  );
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
 * Surplus haulers reclaim no extra energy once sources are staffed and keep
 * spawn under the builder body cost (100 hauler vs 200 WORK+CARRY+MOVE).
 */
export function recycleExcessHaulers(
  spawn: StructureSpawn,
  want: CreepQuotas,
  counts: CreepQuotas,
  reclaimForBuilders: boolean,
  opts?: { durableHaulers?: number },
): boolean {
  if (spawn.spawning) return false;
  if (counts.hauler <= want.hauler) {
    clearHaulerRecycling(spawn.room.name);
    return false;
  }
  const durable = opts?.durableHaulers ?? counts.hauler;
  // TTL handoff: one extra live hauler is the incoming replacement.
  if (durable < want.hauler) return false;
  if (reclaimForBuilders && counts.builder >= want.builder && want.hauler > 0) {
    return false;
  }

  let best: Creep | null = null;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== spawn.room.name) continue;
    if (creep.memory.role !== "hauler") continue;
    const carried =
      creep.store?.getUsedCapacity?.(RESOURCE_ENERGY) ??
      (creep.store as { energy?: number } | undefined)?.energy ??
      0;
    const empty = carried <= 0;
    const near = creep.pos.isNearTo(spawn);
    if (!best) {
      best = creep;
      continue;
    }
    const bestCarried =
      best.store?.getUsedCapacity?.(RESOURCE_ENERGY) ??
      (best.store as { energy?: number } | undefined)?.energy ??
      0;
    const bestEmpty = bestCarried <= 0;
    const bestNear = best.pos.isNearTo(spawn);
    if (empty && !bestEmpty) best = creep;
    else if (empty === bestEmpty && near && !bestNear) best = creep;
  }
  if (!best) return false;
  markHaulerRecycling(spawn.room.name, best);
  if (best.pos.isNearTo(spawn)) {
    return spawn.recycleCreep(best) === OK;
  }
  best.moveTo(spawn);
  return true;
}

/** Recycle leftover miners after TTL handoff (unassigned pile at spawn). */
export function recycleExcessMiners(
  spawn: StructureSpawn,
  want: CreepQuotas,
  counts: CreepQuotas,
  durableMiners: number,
  opts?: { replacementSeatOpen?: boolean },
): boolean {
  if (spawn.spawning) return false;
  if (counts.miner <= want.miner) return false;
  if (durableMiners < want.miner) return false;
  // TTL handoff in flight — never recycle the walking replacement.
  if (opts?.replacementSeatOpen) return false;

  let best: Creep | null = null;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== spawn.room.name) continue;
    if (creep.memory.role !== "miner") continue;
    if (!best) {
      best = creep;
      continue;
    }
    const unassigned = !creep.memory.sourceId;
    const bestUnassigned = !best.memory.sourceId;
    const near = creep.pos.isNearTo(spawn);
    const bestNear = best.pos.isNearTo(spawn);
    if (unassigned && !bestUnassigned) best = creep;
    else if (unassigned === bestUnassigned && near && !bestNear) best = creep;
  }
  if (!best) return false;
  if (best.pos.isNearTo(spawn)) {
    return spawn.recycleCreep(best) === OK;
  }
  best.moveTo(spawn);
  return true;
}

/**
 * Recycle underpowered miners once the room can afford capacity-sized bodies.
 * Never wipe source coverage: only recycle when a fat replacement already lives
 * or there is a true surplus miner. Walking to spawn must not block spawning.
 */
export function recycleWeakMiners(
  spawn: StructureSpawn,
  targetWork: number,
  energyAvailable: number,
  opts?: { sourceCount?: number },
): boolean {
  if (spawn.spawning) return false;
  if (targetWork <= 1) return false;
  if (energyAvailable < minerBodyCost(targetWork)) return false;

  const sources = Math.max(1, opts?.sourceCount ?? 1);
  let minerCount = 0;
  let strongCount = 0;
  let best: Creep | null = null;
  let bestWork = Infinity;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== spawn.room.name) continue;
    if (creep.memory.role !== "miner") continue;
    minerCount += 1;
    const work = creep.getActiveBodyparts(WORK);
    if (work >= targetWork) {
      strongCount += 1;
      continue;
    }
    if (
      !best ||
      work < bestWork ||
      (work === bestWork && creep.pos.isNearTo(spawn))
    ) {
      best = creep;
      bestWork = work;
    }
  }
  if (!best) return false;
  // Keep one miner per source until a capacity-sized body is already online
  // (or a surplus seat exists from prespawn).
  if (strongCount === 0 && minerCount <= sources) return false;

  if (best.pos.isNearTo(spawn)) {
    return spawn.recycleCreep(best) === OK;
  }
  best.moveTo(spawn);
  return false;
}

/** CARRY parts for a full-budget filler (100 energy per CARRY+MOVE pair). */
export function fillerTargetCarry(maxCost: number): number {
  return Math.max(1, Math.floor(maxCost / 100));
}

export function countStrongFillers(
  roomName: string,
  minCarry: number,
): number {
  let n = 0;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== roomName) continue;
    if (creep.memory.role !== "filler") continue;
    if (creep.getActiveBodyparts(CARRY) >= minCarry) n += 1;
  }
  return n;
}

/**
 * After a fat filler is online, recycle thin leftover so quota stays at 1.
 */
export function recycleWeakFillers(
  spawn: StructureSpawn,
  minCarry: number,
  energyAvailable: number,
  targetCost: number,
): boolean {
  if (spawn.spawning) return false;
  if (minCarry <= 3) return false;
  if (energyAvailable < targetCost) return false;

  let strongCount = 0;
  let best: Creep | null = null;
  let bestCarry = Infinity;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== spawn.room.name) continue;
    if (creep.memory.role !== "filler") continue;
    const carry = creep.getActiveBodyparts(CARRY);
    if (carry >= minCarry) {
      strongCount += 1;
      continue;
    }
    if (
      !best ||
      carry < bestCarry ||
      (carry === bestCarry && creep.pos.isNearTo(spawn))
    ) {
      best = creep;
      bestCarry = carry;
    }
  }
  if (!best || strongCount === 0) return false;

  if (best.pos.isNearTo(spawn)) {
    return spawn.recycleCreep(best) === OK;
  }
  best.moveTo(spawn);
  return false;
}

/**
 * Hub softlock: promote a hauler → filler when spawn cannot fund a fat body
 * (or when zero fillers exist — even a 1C hauler beats an empty hub).
 */
export function promoteHaulerToFiller(
  room: Room,
  minCarry: number,
): boolean {
  const liveFillers = countStrongFillers(room.name, 1);
  const emergency = liveFillers === 0;
  if (!emergency && minCarry <= 3) return false;
  if (!emergency && countStrongFillers(room.name, Math.min(minCarry, 4)) > 0) {
    return false;
  }

  let best: Creep | null = null;
  let bestCarry = 0;
  let haulerCount = 0;
  const minHaulerCarry = emergency ? 1 : 4;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;
    if (creep.memory.role !== "hauler") continue;
    haulerCount += 1;
    const carry = creep.getActiveBodyparts(CARRY);
    if (carry < minHaulerCarry) continue;
    if (!best || carry > bestCarry) {
      best = creep;
      bestCarry = carry;
    }
  }
  // Keep one hauler unless the hub has zero fillers (refill is P0).
  if (!best) return false;
  if (!emergency && haulerCount <= 1) return false;
  best.memory.role = "filler";
  return true;
}

function clearHaulerRecycling(roomName: string): void {
  markHaulerRecycling(roomName, null);
}

function markHaulerRecycling(roomName: string, keep: Creep | null): void {
  for (const name in Game.creeps ?? {}) {
    const creep = Game.creeps[name];
    if (creep.room.name !== roomName) continue;
    if (creep.memory.role !== "hauler") continue;
    if (keep && creep === keep) {
      creep.memory.recycling = true;
    } else {
      delete creep.memory.recycling;
    }
  }
}

/**
 * Screeps can leave spawn.spawning stuck at remainingTime 0 (ERR_BUSY forever).
 *
 * remainingTime > 0: live spawn — leave alone.
 * remainingTime === 0 + no creep: ghost — cancel.
 * remainingTime === 0 + living creep: DO NOTHING. Calling cancel() deletes the
 * creep; calling spawnCreep() returns ERR_BUSY and may keep the sticky flag.
 * Leave the birth/sticky tick alone so the engine can clear spawning next tick.
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
  const ttl = existing?.ticksToLive;
  // Newborns sit at remainingTime 0 for 1–2 ticks with TTL≈1500. After that the
  // flag is stale: cancel() clears spawn without deleting the already-born creep.
  const staleLiving = existing != null && ttl != null && ttl < 1480;
  if (ags) {
    ags.zombieDebug = {
      tick: Game.time,
      spawningName: spawning.name,
      remainingTime: 0,
      ttl,
      hasExact: existing != null,
      action: existing
        ? staleLiving
          ? "cancel-stale-living"
          : "hands-off-living"
        : "cancel-ghost",
    };
  }

  if (existing && !staleLiving) return false;

  if (ags?.zombieSpawnSeen) delete ags.zombieSpawnSeen[spawning.name];
  return (
    (spawning as { cancel?: () => ScreepsReturnCode }).cancel?.() === OK
  );
}

/** True when storage/container/drop with energy sits in range 1 of spawn. */
export function hasRecoverableEnergyBeside(spawn: StructureSpawn): boolean {
  const storage = spawn.room.storage;
  if (
    storage &&
    (storage.store[RESOURCE_ENERGY] ?? 0) > 0 &&
    spawn.pos.isNearTo(storage)
  ) {
    return true;
  }
  if (
    spawn.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER &&
        (s.store[RESOURCE_ENERGY] ?? 0) > 0,
    }).length > 0
  ) {
    return true;
  }
  return (
    spawn.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 0,
    }).length > 0
  );
}

const PART_COST: Record<string, number> = {
  work: 100,
  carry: 50,
  move: 50,
  attack: 80,
  ranged_attack: 150,
  heal: 250,
  claim: 600,
  tough: 10,
};

function noteSpawnSpend(role: string, body: BodyPartConstant[]): void {
  if (!Memory.ags) return;
  let cost = 0;
  for (const part of body) cost += PART_COST[part] ?? 0;
  const spent = Memory.ags.spawnSpent ?? {};
  spent[role] = (spent[role] ?? 0) + cost;
  Memory.ags.spawnSpent = spent;
}

export function runSpawn(spawn: StructureSpawn): void {
  healCreepRoles();
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
  let minerWorkParts = 0;
  let minerCount = 0;
  let haulRangeSum = 0;
  const sourceList = room.find(FIND_SOURCES);
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name || creep.memory.role !== "miner") continue;
    minerWorkParts += creep.getActiveBodyparts(WORK);
    minerCount++;
  }
  for (const source of sourceList) {
    // Path length ≈ chebyshev×1.5 (diagonal bias); floor for throughput math.
    haulRangeSum += Math.ceil(spawn.pos.getRangeTo(source) * 1.5);
  }
  const energyCapacityAvailable = room.energyCapacityAvailable;
  const economy = {
    energyIncomePerTick: Memory.ags?.metrics.energyIncomePerTick ?? 0,
    baselineIncome: Memory.ags?.baseline?.energyIncomePerTick,
    spawnFillPct,
    energyAvailable,
    energyCapacityAvailable,
    minerWorkParts,
    minerCount,
    haulRange:
      sourceList.length > 0
        ? Math.max(8, Math.round(haulRangeSum / sourceList.length))
        : 20,
    hasStorage: room.storage !== undefined,
    storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0,
    sourceContainerEnergy: sumSourceContainerEnergy(room),
    rcl5Mode: Memory.ags?.rcl5Mode,
    rcl5Plan: Memory.ags?.rcl5Plan,
    fillerPlan: Memory.ags?.fillerPlan,
    haulerCap: Memory.ags?.haulerCap,
    upgraderSeats: Memory.ags?.upgraderSeats,
    extensionCount:
      countStructures(room, STRUCTURE_EXTENSION) +
      room
        .find(FIND_MY_CONSTRUCTION_SITES)
        .filter((s) => s.structureType === STRUCTURE_EXTENSION).length,
    towerCount:
      countStructures(room, STRUCTURE_TOWER) +
      room
        .find(FIND_MY_CONSTRUCTION_SITES)
        .filter((s) => s.structureType === STRUCTURE_TOWER).length,
    // Finished links only — CAPEX quotas stay until both links are built.
    linkCount: countStructures(room, STRUCTURE_LINK),
    wallsArmed: Memory.ags?.wallsArmed === true,
    rampartSitesOpen: hubRampartSitesOpen(room),
    hubRampartsReady: hubRampartsReady(room),
    rcl6CapexOpen: rcl6CapexIncomplete({
      rcl,
      linkCount: countStructures(room, STRUCTURE_LINK),
      linkQuota: linkQuota(rcl),
      hasTerminal: countStructures(room, STRUCTURE_TERMINAL) > 0,
      hasExtractor: countStructures(room, STRUCTURE_EXTRACTOR) > 0,
    }),
  };
  const exp = resolveExperiment(Memory.ags);
  const infrastructureDedicated = useDedicatedMiners(
    rcl,
    containersAtSources,
    sourceCount,
    exp,
  );

  if (shouldFallbackToMobileHarvest(infrastructureDedicated, economy)) {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.room.name !== room.name || creep.memory.role !== "miner") continue;
      creep.memory.role = "harvester";
      delete creep.memory.sourceId;
    }
  }
  const minerMinWork = infrastructureDedicated
    ? effectiveMinerMinWork(exp.minerMinWork, energyCapacityAvailable)
    : exp.minerMinWork;
  const want = desiredCreeps(
    rcl,
    sourceCount,
    containersAtSources,
    hasConstructionSites,
    economy,
    exp,
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
  // After surplus→builder, restore the emergency upgrader seat if empty.
  for (let n = 0; n < 10; n++) {
    const mid = countCreepsByRole();
    if (!reassignForControllerSurvival(room, want, mid)) break;
  }
  // No sites → builder quota 0: flip surplus builders into upgraders.
  // Gate RCL>=3: earlier, brief site gaps (roads done, extensions not yet
  // placed) would strip builders and slow the RCL2→3 climb in AB sims.
  if (
    Memory.ags?.idleBuilderUpgrade !== false &&
    (room.controller?.level ?? 0) >= 3
  ) {
    for (let n = 0; n < 10; n++) {
      const mid = countCreepsByRole();
      if (!reassignSurplusBuilderToUpgrader(room, want, mid)) break;
    }
  }
  const liveCounts = countCreepsByRole();
  const minerSnapshots: Array<{
    sourceId?: string;
    ticksToLive?: number;
    workParts?: number;
  }> = [];
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name || creep.memory.role !== "miner") continue;
    minerSnapshots.push({
      sourceId: creep.memory.sourceId,
      ticksToLive: creep.ticksToLive,
      workParts: creep.getActiveBodyparts(WORK),
    });
  }
  // Drop-miners may seat on every source; otherwise only finished containers.
  const minerSeatSources = exp.allowDropMiners
    ? sourceList
    : findSourcesWithContainers(room);
  const minerSourceIds = minerSeatSources.map((s) => s.id);
  const minerSeatWant = minerSpawnSeatsWanted(
    want.miner,
    minerSourceIds.length,
  );
  const nextMinerBody = bodyForRole("miner", energyAvailable, {
    minerMinWork,
  });
  const leadTimeFor = (sourceId: string): number => {
    const src = Game.getObjectById(sourceId as Id<Source>);
    const range = src ? spawn.pos.getRangeTo(src) : (economy.haulRange ?? 20);
    const workParts = nextMinerBody.filter((p) => p === "work").length;
    const moveParts = nextMinerBody.filter((p) => p === "move").length;
    return minerReplacementLeadTime({
      bodyParts: nextMinerBody.length || 6,
      workParts: workParts || 5,
      moveParts: moveParts || 1,
      range,
    });
  };
  const minersDurable = durableMinerCount(
    minerSnapshots,
    minerSourceIds,
    leadTimeFor,
    { minWorkParts: minerMinWork },
  );
  const haulerSnapshots: Array<{ ticksToLive?: number }> = [];
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name || creep.memory.role !== "hauler") continue;
    haulerSnapshots.push({ ticksToLive: creep.ticksToLive });
  }
  const haulerBodyBudget = homeHaulerBodyBudget({
    emergency: false,
    experimentMax: exp.haulerMaxCost,
    override: Memory.ags?.haulerBudget,
  });
  const nextHaulerBody = bodyForRole("hauler", energyAvailable, {
    haulerMaxCost: haulerBodyBudget,
  });
  const haulerLead = minerReplacementLeadTime({
    bodyParts: nextHaulerBody.length || 2,
    workParts: 0,
    moveParts: Math.max(
      1,
      nextHaulerBody.filter((p) => p === "move").length,
    ),
    range: economy.haulRange ?? 20,
  });
  const haulersDurable = durableCount(haulerSnapshots, haulerLead);

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

  const buildersBelowQuota = liveCounts.builder < want.builder;
  if (
    recycleExcessHaulers(
      spawn,
      want,
      liveCounts,
      infrastructurePush || buildersBelowQuota,
      { durableHaulers: haulersDurable },
    )
  ) {
    return;
  }
  // Overspawned remote haulers (stale pathLength=50 era) reclaim spawn for CAPEX.
  if (recycleExcessRemoteHaulers(spawn)) return;
  const replacementSeatOpen =
    sourceIdForReplacementMiner(
      minerSnapshots,
      minerSourceIds,
      leadTimeFor,
      { minWorkParts: minerMinWork },
    ) != null;
  if (
    recycleExcessMiners(
      spawn,
      { ...want, miner: minerSeatWant },
      liveCounts,
      minersDurable,
      { replacementSeatOpen },
    )
  ) {
    return;
  }
  const targetMinerWork = minerTargetWorkParts(energyCapacityAvailable);
  if (
    infrastructureDedicated &&
    shouldBankForBetterMiners({
      energyCapacityAvailable,
      minerWorkParts,
      sourceCount,
    }) &&
    recycleWeakMiners(spawn, targetMinerWork, energyAvailable, { sourceCount })
  ) {
    return;
  }
  const fillerMaxCost = fillerMaxCostForPlan(Memory.ags?.fillerPlan);
  const fillerMinCarry = fillerTargetCarry(fillerMaxCost);
  // Promote even with empty hub bank — zero fillers must not wait on 400/800.
  if (
    fillerMaxCost > 300 &&
    (room.storage?.store[RESOURCE_ENERGY] ?? 0) >= 2_000 &&
    (liveCounts.filler === 0 || energyAvailable < fillerMaxCost) &&
    promoteHaulerToFiller(room, fillerMinCarry)
  ) {
    return;
  }
  // Mid-size upgrade (4C) already beats thin; recycle leftover once any ≥4C lives.
  const fillerRecycleMinCarry = Math.min(fillerMinCarry, 4);
  if (
    recycleWeakFillers(
      spawn,
      fillerRecycleMinCarry,
      energyAvailable,
      Math.min(fillerMaxCost, 400),
    )
  ) {
    return;
  }
  const economyFloorMet =
    liveCounts.harvester + liveCounts.miner >= sourceCount;
  const minersBelowQuota =
    infrastructureDedicated && minersDurable < minerSeatWant;
  const upgraderSeatEmpty =
    want.upgrader >= 1 && liveCounts.upgrader === 0 && rcl >= 2;
  const canAffordBridgeMiner =
    bodyForRole("miner", energyAvailable, { minerMinWork: 1 }).length > 0;
  const spawnOrder = spawnPriorityOrder(
    infrastructureDedicated,
    economy,
    liveCounts,
    energyAvailable,
    {
      infrastructurePush,
      buildersBelowQuota,
      economyFloorMet,
      upgraderSeatEmpty,
      spawnChain: exp.spawnChain,
      containersAtSources,
    },
  );
  // Cap haulers when economy is empty — a 300-energy hauler blocks the first harvester.
  // Experiment haulerCap (thin) also caps when economy is healthy.
  const haulerMaxCost = homeHaulerBodyBudget({
    emergency:
      hasNoEconomyCreeps(liveCounts) ||
      (liveCounts.miner === 0 && infrastructureDedicated),
    experimentMax: exp.haulerMaxCost,
    override: Memory.ags?.haulerBudget,
  });

  for (const role of spawnOrder) {
    const roleWant = role === "miner" ? minerSeatWant : want[role];
    const filled =
      role === "miner"
        ? minerSourceIds.length === 0
          ? liveCounts.miner
          : minersDurable
        : role === "hauler"
          ? // Don't pre-spawn hauler replacements while builders are missing —
            // 100-energy haulers keep spawn under the 200 builder body.
            buildersBelowQuota
            ? liveCounts.hauler
            : haulersDurable
          : role === "filler" && fillerMaxCost > 300
            ? // Thin leftover must not block the fat refill upgrade.
              countStrongFillers(room.name, fillerMinCarry)
            : liveCounts[role];
    if (filled >= roleWant) continue;
    // Fat upgrade deferral — never when live filler count is 0 (softlock).
    if (
      role === "filler" &&
      shouldDeferFatFillerSpawn({
        fillerMaxCost,
        energyAvailable,
        liveFillerCount: liveCounts.filler,
        midFillerCount: countStrongFillers(room.name, 4),
        roleWant,
      })
    ) {
      continue;
    }
    if (
      role === "harvester" &&
      liveCounts.miner > 0 &&
      containersAtSources >= sourceCount
    ) {
      continue;
    }
    if (
      role === "miner" &&
      liveCounts.miner >= minerLiveCap(minerSeatWant, minerSourceIds.length)
    ) {
      continue;
    }
    // Never spend on builders while sources have no harvester/miner.
    if (role === "builder" && !economyFloorMet) continue;
    // Miner gap: do not spend the bank on upgrader / builder — but still allow
    // haulers when we cannot afford even a 1W bridge miner (refill the bank).
    // Exception: empty controller seat at RCL2+ must not wait on miner TTL math
    // (overnight sims stuck at builder=5 / upgrader=0).
    if (
      minersBelowQuota &&
      role !== "miner" &&
      role !== "harvester" &&
      role !== "filler" &&
      !(role === "hauler" && !canAffordBridgeMiner) &&
      !(role === "upgrader" && upgraderSeatEmpty)
    ) {
      continue;
    }
    const roleMinerMinWork =
      role === "miner"
        ? minerMinWorkForSpawn({
            preferredMinWork: minerMinWork,
            energyAvailable,
            seatsUncovered: minersBelowQuota,
            // TTL handoff with a live incumbent — wait for fat body if bank is fat.
            isPrespawn:
              replacementSeatOpen &&
              !hasUncoveredMinerSeat(minerSnapshots, minerSourceIds),
            storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0,
            storageWaitReserve: storageBlackoutReserve(),
            energyCapacityAvailable,
          })
        : minerMinWork;
    // Bridge only: keep maxWork=minWork so partial spawn energy cannot grow 1→2–4W.
    const bridgingThin =
      role === "miner" && roleMinerMinWork < minerMinWork;
    const body = bodyForRole(role, energyAvailable, {
      haulerMaxCost,
      fillerMaxCost: fillerMaxCostForPlan(Memory.ags?.fillerPlan),
      minerMinWork: roleMinerMinWork,
      minerMaxWork: bridgingThin ? roleMinerMinWork : undefined,
      staticUpgrader:
        role === "upgrader" &&
        upgradeStyleStatic(parseUpgradeStyle(Memory.ags?.upgradeStyle)),
    });
    if (body.length === 0) continue;
    const name = `${role}-${Game.time}-${Math.floor(Math.random() * 1_000_000)}`;
    const memory: CreepMemory = { role };
    if (role === "miner") {
      // Empty seats, TTL handoff, or under-powered upgrade — never stack on a fat miner.
      const seatId = sourceIdForReplacementMiner(
        minerSnapshots,
        minerSourceIds,
        leadTimeFor,
        { minWorkParts: minerMinWork },
      );
      if (!seatId && minerSourceIds.length > 0) continue;
      if (seatId) memory.sourceId = seatId as Id<Source>;
    }
    const result = spawn.spawnCreep(body, name, { memory });
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
      noteSpawnSpend(role, body);
      return;
    }
  }

  // Home queue empty / unaffordable this tick — try post-RCL6 remotes.
  trySpawnRemote(spawn, {
    homeMiners: liveCounts.miner,
    homeMinerWant: minerSeatWant,
    homeFillers: liveCounts.filler,
  });
}
