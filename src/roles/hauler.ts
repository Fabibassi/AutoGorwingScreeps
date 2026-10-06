import { shouldBankForBetterMiners } from "../earlyGame/policy";
import { isIncomeStalled } from "../telemetry";

type HaulTarget =
  | StructureSpawn
  | StructureExtension
  | StructureTower
  | StructureContainer
  | StructureStorage;

/**
 * Absolute energy thresholds (spawn store is always 300 — never % of storage 1M).
 */
export const HAUL_THRESHOLDS = {
  /** Spawn this empty → deliver any carried energy immediately. */
  spawnUrgent: 150,
  /** Spawn below this → deliver once we hold a meaningful partial load. */
  spawnHungry: 250,
  /** Spawn at/above this counts as "topped up" for storage overflow. */
  spawnComfortable: 250,
  /** Min energy in CARRY before turning around for a hungry (non-urgent) spawn. */
  minPartialLoad: 100,
  /** For extension-only need: only early-deliver when CARRY is mostly full. */
  extensionFillRatio: 0.6,
} as const;

export interface StorageHaulContext {
  energyIncomePerTick: number;
  baselineIncome?: number;
  /** Absolute energy in the spawn store (0..300). */
  spawnEnergy: number;
  /** Spawn store capacity (normally 300). */
  spawnCapacity: number;
  extensionsNeedingEnergy: number;
  storageExists: boolean;
  storageEnergy?: number;
}

/** Spawn is nearly full — safe to overflow into storage (absolute, not % of 1M). */
export function spawnIsComfortable(ctx: Pick<StorageHaulContext, "spawnEnergy" | "spawnCapacity">): boolean {
  const cap = Math.max(1, ctx.spawnCapacity);
  // Within 50 of full, or at absolute comfortable floor for tiny/odd caps.
  return (
    ctx.spawnEnergy >= Math.min(HAUL_THRESHOLDS.spawnComfortable, cap - 50) ||
    ctx.spawnEnergy >= cap - 50
  );
}

/** Keep spawn/extensions fed before storage absorbs recoverable energy. */
export function shouldDepositInStorage(ctx: StorageHaulContext): boolean {
  if (!ctx.storageExists) return false;
  if (!spawnIsComfortable(ctx)) return false;
  if (ctx.extensionsNeedingEnergy > 0) return false;
  // Zero income: haulers need overflow target when spawn+extensions are full (#32).
  if (ctx.energyIncomePerTick <= 0) return true;
  // Low-but-positive income: keep energy out of storage until mining recovers (#34).
  if (isIncomeStalled(ctx.energyIncomePerTick, ctx.baselineIncome)) return false;
  return true;
}

/** Haulers dump the whole CARRY into storage; a filler tops spawn/extensions. */
export function shouldDumpToStorage(
  ctx: StorageHaulContext,
  fillerExists: boolean,
): boolean {
  if (!ctx.storageExists) return false;
  if (ctx.spawnEnergy < HAUL_THRESHOLDS.spawnUrgent) return false;
  // Without a filler, keep feeding spawn/extensions ourselves.
  if (!fillerExists) return shouldDepositInStorage(ctx);
  return true;
}
export function shouldWithdrawFromStorage(ctx: StorageHaulContext): boolean {
  if (!ctx.storageExists || (ctx.storageEnergy ?? 0) <= 0) return false;
  if (!spawnIsComfortable(ctx)) return true;
  return isIncomeStalled(ctx.energyIncomePerTick, ctx.baselineIncome);
}

/**
 * When to stop collecting and deliver.
 * Softened: do not U-turn at the mine for every hungry extension with a few energy.
 */
export function shouldDeliverNow(
  carried: number,
  freeCapacity: number,
  ctx: Pick<
    StorageHaulContext,
    "spawnEnergy" | "spawnCapacity" | "extensionsNeedingEnergy"
  >,
): boolean {
  if (carried <= 0) return false;
  if (freeCapacity <= 0) return true;

  // Critical spawn — any energy home now.
  if (ctx.spawnEnergy < HAUL_THRESHOLDS.spawnUrgent) return true;

  // Hungry spawn — only turn around with a worthwhile partial load.
  if (ctx.spawnEnergy < HAUL_THRESHOLDS.spawnHungry) {
    return carried >= HAUL_THRESHOLDS.minPartialLoad;
  }

  // Spawn comfortable; extensions still want energy — finish filling CARRY first.
  if (ctx.extensionsNeedingEnergy > 0) {
    const total = carried + freeCapacity;
    return total > 0 && carried / total >= HAUL_THRESHOLDS.extensionFillRatio;
  }

  // Spawn + extensions saturated: dump whatever we hold (storage/tower) and
  // return empty — do not hike back to the miner half-full to top off CARRY.
  return true;
}

export interface HaulerPickupCandidate {
  id: string;
  energy: number;
  range: number;
}

export interface HaulerPickupPeer {
  id: string;
  freeCapacity: number;
  /** Container/drop this peer is already heading to (memory or inferred). */
  targetId?: string;
  rangeToTarget?: number;
}

/**
 * Don't walk across the room for crumbs when CARRY is large.
 * Spawn-starving haulers accept smaller piles.
 */
export function minWorthwhilePickup(
  freeCapacity: number,
  spawnEnergy: number,
): number {
  if (freeCapacity <= 0) return 0;
  if (spawnEnergy < HAUL_THRESHOLDS.spawnUrgent) {
    return Math.min(freeCapacity, 25);
  }
  // Tiny 1C1M haulers (50) must not wait for a 100-energy pile or they idle at spawn.
  if (freeCapacity < 100) {
    return Math.min(freeCapacity, 25);
  }
  return Math.min(freeCapacity, Math.max(100, Math.floor(freeCapacity * 0.25)));
}

/**
 * Pick a pickup container: prefer piles that cover free capacity, split peers
 * so two haulers don't both race the same thin source.
 *
 * Deterministic: unassigned haulers (no sticky target) claim in id order so
 * every creep computes the same split without shared memory writes.
 */
export function pickHaulerContainer(opts: {
  haulerId: string;
  freeCapacity: number;
  spawnEnergy: number;
  containers: HaulerPickupCandidate[];
  peers: HaulerPickupPeer[];
}): string | null {
  if (opts.containers.length === 0) return null;

  const reserved = new Map<string, number>();
  for (const peer of opts.peers) {
    if (!peer.targetId || peer.id === opts.haulerId) continue;
    reserved.set(
      peer.targetId,
      (reserved.get(peer.targetId) ?? 0) + Math.max(0, peer.freeCapacity),
    );
  }

  const unassigned = [
    { id: opts.haulerId, freeCapacity: opts.freeCapacity },
    ...opts.peers
      .filter((p) => p.id !== opts.haulerId && !p.targetId)
      .map((p) => ({ id: p.id, freeCapacity: p.freeCapacity })),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const pickFor = (
    freeCapacity: number,
    spawnEnergy: number,
    enforceMin: boolean,
  ): string | null => {
    const minEnergy = minWorthwhilePickup(freeCapacity, spawnEnergy);
    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const c of opts.containers) {
      const available = c.energy - (reserved.get(c.id) ?? 0);
      if (available <= 0) continue;
      if (enforceMin && available < minEnergy) continue;
      const score = available / (c.range + 1);
      if (score > bestScore) {
        bestScore = score;
        bestId = c.id;
      }
    }
    return bestId;
  };

  for (const claim of unassigned) {
    const chosen =
      pickFor(claim.freeCapacity, opts.spawnEnergy, true) ??
      pickFor(claim.freeCapacity, opts.spawnEnergy, false);
    if (!chosen) {
      if (claim.id === opts.haulerId) return null;
      continue;
    }
    if (claim.id === opts.haulerId) return chosen;
    reserved.set(
      chosen,
      (reserved.get(chosen) ?? 0) + Math.max(0, claim.freeCapacity),
    );
  }
  return null;
}

function haulContext(creep: Creep): StorageHaulContext {
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  const spawnCapacity = spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 300;
  const spawnEnergy = spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  const extensionsNeedingEnergy = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureExtension =>
      s.structureType === STRUCTURE_EXTENSION &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }).length;
  const storage = creep.room.storage;
  return {
    energyIncomePerTick: Memory.ags?.metrics.energyIncomePerTick ?? 0,
    baselineIncome: Memory.ags?.baseline?.energyIncomePerTick,
    spawnEnergy,
    spawnCapacity,
    extensionsNeedingEnergy,
    storageExists: storage !== undefined,
    storageEnergy: storage?.store[RESOURCE_ENERGY] ?? 0,
  };
}

function findEnergyTarget(creep: Creep): HaulTarget | null {
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return null;

  const spawnFree = spawn.store.getFreeCapacity(RESOURCE_ENERGY);
  const spawnEnergy = spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;

  const extensions = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureExtension =>
      s.structureType === STRUCTURE_EXTENSION &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });

  // Critically empty spawn OR no miners left: refill spawn before extensions so
  // energyAvailable can fund a miner body (extensions-first left spawn stuck at ~58%).
  const miningCreeps = Object.keys(Game.creeps).filter((n) => {
    const role = Game.creeps[n].memory.role;
    return role === "miner" || role === "harvester";
  }).length;
  let minerWorkParts = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === "miner") minerWorkParts += c.getActiveBodyparts(WORK);
  }
  const sourceCount = creep.room.find(FIND_SOURCES).length;
  const bankForMiners = shouldBankForBetterMiners({
    energyCapacityAvailable: creep.room.energyCapacityAvailable,
    minerWorkParts,
    sourceCount,
  });
  // While upgrading miners, keep spawn topped before feeding empty extensions
  // so energyAvailable can climb to a fat miner body (extensions fill after).
  const spawnBankFloor = bankForMiners
    ? HAUL_THRESHOLDS.spawnComfortable
    : HAUL_THRESHOLDS.spawnUrgent;
  if (
    (spawnEnergy < spawnBankFloor || miningCreeps === 0) &&
    spawnFree > 0
  ) {
    return spawn;
  }

  const fillerExists = Object.keys(Game.creeps).some(
    (n) => Game.creeps[n].memory.role === "filler",
  );
  const ctx = haulContext(creep);
  const storage = creep.room.storage;
  if (
    storage &&
    storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
    shouldDumpToStorage(ctx, fillerExists)
  ) {
    return storage;
  }

  if (extensions.length > 0) {
    const closest =
      creep.pos.findClosestByPath(extensions) ??
      creep.pos.findClosestByRange(extensions);
    if (closest) return closest;
  }

  const towers = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureTower =>
      s.structureType === STRUCTURE_TOWER &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (towers.length > 0) {
    const closest =
      creep.pos.findClosestByPath(towers) ??
      creep.pos.findClosestByRange(towers);
    if (closest) return closest;
  }

  if (spawnFree > 0) {
    return spawn;
  }

  const controllerContainer = creep.room.controller?.pos.findInRange(
    FIND_STRUCTURES,
    3,
    {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    },
  )[0];
  if (controllerContainer) return controllerContainer;

  if (
    storage &&
    storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
    shouldDepositInStorage(ctx)
  ) {
    return storage;
  }

  return null;
}

function findExtensionWithEnergy(creep: Creep): StructureExtension | null {
  const extensions = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureExtension =>
      s.structureType === STRUCTURE_EXTENSION && s.store[RESOURCE_ENERGY] > 0,
  });
  if (extensions.length === 0) return null;
  return creep.pos.findClosestByPath(extensions);
}

function findEnergySource(creep: Creep): StructureContainer | StructureStorage | StructureExtension | Resource | null {
  const ctx = haulContext(creep);
  const immobile = creep.getActiveBodyparts(MOVE) === 0;

  // Stationary emergency CARRY: only structures/drops in range 1 (storage is
  // adjacent to spawn). Never path-target remote source containers — moveTo
  // is impossible and blocks soft-lock recovery while energy sits in storage.
  if (immobile) {
    const storage = creep.room.storage;
    if (
      storage &&
      storage.store[RESOURCE_ENERGY] > 0 &&
      creep.pos.isNearTo(storage)
    ) {
      return storage;
    }
    const nearContainer = creep.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.store[RESOURCE_ENERGY] > 0,
    })[0] as StructureContainer | undefined;
    if (nearContainer) return nearContainer;
    const nearExt = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
      filter: (s): s is StructureExtension =>
        s.structureType === STRUCTURE_EXTENSION &&
        s.store[RESOURCE_ENERGY] > 0,
    })[0] as StructureExtension | undefined;
    if (nearExt) return nearExt;
    const nearDrop = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 0,
    })[0];
    return nearDrop ?? null;
  }

  // Soft-lock recovery: pull energy out of extensions when spawn cannot afford bootstrap.
  if (
    ctx.spawnEnergy < HAUL_THRESHOLDS.spawnUrgent &&
    ctx.extensionsNeedingEnergy === 0
  ) {
    const ext = findExtensionWithEnergy(creep);
    if (ext) return ext;
  }

  // Spawn starving: drain storage before walking to remote source containers.
  const storage = creep.room.storage;
  if (
    storage &&
    shouldWithdrawFromStorage(ctx) &&
    ctx.spawnEnergy < HAUL_THRESHOLDS.spawnUrgent
  ) {
    return storage;
  }

  const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const controller = creep.room.controller;
  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER &&
      s.store[RESOURCE_ENERGY] > 0 &&
      (controller === undefined || s.pos.getRangeTo(controller) > 2),
  });
  if (containers.length > 0) {
    const peers: HaulerPickupPeer[] = [];
    for (const name in Game.creeps) {
      const other = Game.creeps[name];
      if (other.id === creep.id) continue;
      if (other.room.name !== creep.room.name) continue;
      if (other.memory.role !== "hauler") continue;
      if ((other.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0) <= 0) continue;
      const targetId = other.memory.pickupId;
      peers.push({
        id: other.id,
        freeCapacity: other.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0,
        targetId,
        rangeToTarget: targetId
          ? other.pos.getRangeTo(
              (Game.getObjectById(targetId) as RoomObject | null)?.pos ??
                other.pos,
            )
          : undefined,
      });
    }

    const candidates: HaulerPickupCandidate[] = containers.map((c) => ({
      id: c.id,
      energy: c.store[RESOURCE_ENERGY] ?? 0,
      range: creep.pos.getRangeTo(c),
    }));

    // Honour sticky target if it still has worthwhile energy.
    const sticky = creep.memory.pickupId;
    if (sticky) {
      const still = containers.find((c) => c.id === sticky);
      const minE = minWorthwhilePickup(freeCapacity, ctx.spawnEnergy);
      if (still && (still.store[RESOURCE_ENERGY] ?? 0) >= minE) {
        return still;
      }
      delete creep.memory.pickupId;
    }

    const pickedId = pickHaulerContainer({
      haulerId: creep.id,
      freeCapacity,
      spawnEnergy: ctx.spawnEnergy,
      containers: candidates,
      peers,
    });
    if (pickedId) {
      const picked = containers.find((c) => c.id === pickedId) ?? null;
      if (picked) {
        creep.memory.pickupId = picked.id;
        return picked;
      }
    }
  }

  // Soft-lock recovery: pick up small piles when spawn cannot afford WORK+MOVE.
  const spawnRef = creep.room.find(FIND_MY_SPAWNS)[0];
  const spawnStarving =
    (spawnRef?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) < 150;
  const minDrop = spawnStarving ? 1 : 25;
  const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= minDrop,
  });
  if (dropped.length > 0) {
    return creep.pos.findClosestByPath(dropped);
  }

  if (storage && shouldWithdrawFromStorage(ctx)) {
    return storage;
  }

  return null;
}

export function runHauler(creep: Creep): number {
  const carried = creep.store[RESOURCE_ENERGY] ?? 0;
  const freeCapacity = creep.store.getFreeCapacity();
  const ctx = haulContext(creep);

  if (!shouldDeliverNow(carried, freeCapacity, ctx)) {
    const source = findEnergySource(creep);
    if (!source) {
      delete creep.memory.pickupId;
      const anchor = creep.room.find(FIND_SOURCES)[0];
      if (anchor && !creep.pos.inRangeTo(anchor, 2)) {
        creep.moveTo(anchor, { reusePath: 5, range: 1 });
      }
      return 0;
    }
    if (source instanceof Resource) {
      if (creep.pickup(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 5 });
      }
      return 0;
    }
    if (creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 5 });
    }
    return 0;
  }

  delete creep.memory.pickupId;
  const target = findEnergyTarget(creep);
  if (!target) return 0;

  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5 });
  }
  return 0;
}
