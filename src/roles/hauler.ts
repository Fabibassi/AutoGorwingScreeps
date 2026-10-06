import { isIncomeStalled } from "../telemetry";

type HaulTarget =
  | StructureSpawn
  | StructureExtension
  | StructureTower
  | StructureContainer
  | StructureStorage;

export interface StorageHaulContext {
  energyIncomePerTick: number;
  baselineIncome?: number;
  spawnFillPct: number;
  extensionsNeedingEnergy: number;
  storageExists: boolean;
  storageEnergy?: number;
}

/** Keep spawn/extensions fed before RCL4 storage absorbs recoverable energy. */
export function shouldDepositInStorage(ctx: StorageHaulContext): boolean {
  if (!ctx.storageExists) return false;
  if (ctx.spawnFillPct < 0.85) return false;
  if (ctx.extensionsNeedingEnergy > 0) return false;
  // Zero income: haulers need overflow target when spawn+extensions are full (#32).
  if (ctx.energyIncomePerTick <= 0) return true;
  // Low-but-positive income: keep energy out of storage until mining recovers (#34).
  if (isIncomeStalled(ctx.energyIncomePerTick, ctx.baselineIncome)) return false;
  return true;
}

/** Pull from storage when income stalled and spawn energy is unavailable for spawning. */
export function shouldWithdrawFromStorage(ctx: StorageHaulContext): boolean {
  if (!ctx.storageExists || (ctx.storageEnergy ?? 0) <= 0) return false;
  if (ctx.spawnFillPct < 0.85) return true;
  return isIncomeStalled(ctx.energyIncomePerTick, ctx.baselineIncome);
}

/**
 * Deliver even with a partial load when spawn/extensions need energy.
 * Waiting for a full CARRY while spawn sits at ~0 left builders draining the bank
 * and energyAvailable never approaching capacity (RCL4 extension push).
 */
export function shouldDeliverNow(
  carried: number,
  freeCapacity: number,
  ctx: Pick<StorageHaulContext, "spawnFillPct" | "extensionsNeedingEnergy">,
): boolean {
  if (carried <= 0) return false;
  if (freeCapacity <= 0) return true;
  return ctx.spawnFillPct < 0.85 || ctx.extensionsNeedingEnergy > 0;
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
  spawnFillPct: number,
): number {
  if (freeCapacity <= 0) return 0;
  if (spawnFillPct < 0.5) return Math.min(freeCapacity, 25);
  // At least 100 or 25% of free space (fat haulers ignore <100 containers).
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
  spawnFillPct: number;
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
    spawnFillPct: number,
    enforceMin: boolean,
  ): string | null => {
    const minEnergy = minWorthwhilePickup(freeCapacity, spawnFillPct);
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
      pickFor(claim.freeCapacity, opts.spawnFillPct, true) ??
      pickFor(claim.freeCapacity, opts.spawnFillPct, false);
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
  const spawnCapacity = spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 1;
  const spawnFillPct =
    (spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) / spawnCapacity;
  const extensionsNeedingEnergy = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureExtension =>
      s.structureType === STRUCTURE_EXTENSION &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }).length;
  const storage = creep.room.storage;
  return {
    energyIncomePerTick: Memory.ags?.metrics.energyIncomePerTick ?? 0,
    baselineIncome: Memory.ags?.baseline?.energyIncomePerTick,
    spawnFillPct,
    extensionsNeedingEnergy,
    storageExists: storage !== undefined,
    storageEnergy: storage?.store[RESOURCE_ENERGY] ?? 0,
  };
}

function findEnergyTarget(creep: Creep): HaulTarget | null {
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return null;

  const spawnFree = spawn.store.getFreeCapacity(RESOURCE_ENERGY);
  const spawnCap = spawn.store.getCapacity(RESOURCE_ENERGY) ?? 1;
  const spawnFillPct =
    (spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) / Math.max(1, spawnCap);

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
  if ((spawnFillPct < 0.5 || miningCreeps === 0) && spawnFree > 0) {
    return spawn;
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

  const ctx = haulContext(creep);
  const storage = creep.room.storage;
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
  if (ctx.spawnFillPct < 0.5 && ctx.extensionsNeedingEnergy === 0) {
    const ext = findExtensionWithEnergy(creep);
    if (ext) return ext;
  }

  // Spawn starving: drain storage before walking to remote source containers.
  const storage = creep.room.storage;
  if (storage && shouldWithdrawFromStorage(ctx) && ctx.spawnFillPct < 0.5) {
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
      const minE = minWorthwhilePickup(freeCapacity, ctx.spawnFillPct);
      if (still && (still.store[RESOURCE_ENERGY] ?? 0) >= minE) {
        return still;
      }
      delete creep.memory.pickupId;
    }

    const pickedId = pickHaulerContainer({
      haulerId: creep.id,
      freeCapacity,
      spawnFillPct: ctx.spawnFillPct,
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
      return 0;
    }
    if (source instanceof Resource) {
      if (creep.pickup(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
      }
      return 0;
    }
    if (creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source);
    }
    return 0;
  }

  delete creep.memory.pickupId;
  const target = findEnergyTarget(creep);
  if (!target) return 0;

  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target);
  }
  return 0;
}
