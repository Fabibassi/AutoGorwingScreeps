import { isIncomeStalled } from "../telemetry";

type HaulTarget = StructureSpawn | StructureExtension | StructureContainer | StructureStorage;

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

  const extensions = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureExtension =>
      s.structureType === STRUCTURE_EXTENSION &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (extensions.length > 0) {
    return creep.pos.findClosestByPath(extensions);
  }

  if (spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
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
  // Soft-lock recovery: pull energy out of extensions when spawn cannot afford bootstrap.
  if (ctx.spawnFillPct < 0.5 && ctx.extensionsNeedingEnergy === 0) {
    const ext = findExtensionWithEnergy(creep);
    if (ext) return ext;
  }

  const controller = creep.room.controller;
  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER &&
      s.store[RESOURCE_ENERGY] > 0 &&
      (controller === undefined || s.pos.getRangeTo(controller) > 2),
  });
  if (containers.length > 0) {
    return creep.pos.findClosestByPath(containers);
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

  const storage = creep.room.storage;
  if (storage && shouldWithdrawFromStorage(ctx)) {
    return storage;
  }

  return null;
}

export function runHauler(creep: Creep): number {
  if (creep.store.getFreeCapacity() > 0) {
    const source = findEnergySource(creep);
    if (!source) return 0;
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

  const target = findEnergyTarget(creep);
  if (!target) return 0;

  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target);
  }
  return 0;
}
