import { linkFeedFloor, parseUpgradeStyle } from "../earlyGame/upgradeStyle";
import { classifyLinkRole } from "../links/plan";
import { HAUL_THRESHOLDS } from "./hauler";

type FillTarget =
  | StructureSpawn
  | StructureExtension
  | StructureTower
  | StructureLink;

function findStorageLink(room: Room): StructureLink | null {
  const storage = room.storage;
  if (!storage) return null;
  const links = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureLink => s.structureType === STRUCTURE_LINK,
  });
  for (const link of links) {
    if (
      classifyLinkRole({
        linkPos: link.pos,
        storagePos: storage.pos,
        controllerPos: room.controller?.pos,
      }) === "storage" &&
      (link.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0) > 0
    ) {
      return link;
    }
  }
  return null;
}

function findFillTarget(creep: Creep): FillTarget | null {
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    const spawnEnergy = spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
    if (spawnEnergy < HAUL_THRESHOLDS.spawnComfortable) return spawn;
  }

  const hungry = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureExtension | StructureTower =>
      (s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_TOWER) &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (hungry.length > 0) {
    return (
      creep.pos.findClosestByRange(hungry) ??
      creep.pos.findClosestByPath(hungry)
    );
  }

  if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return spawn;

  // Hub spawn/ext/towers full: top storage link — but not under blackout floor.
  const storageEnergy = creep.room.storage?.store[RESOURCE_ENERGY] ?? 0;
  const floor = linkFeedFloor(parseUpgradeStyle(Memory.ags?.upgradeStyle));
  if (storageEnergy <= floor) return null;
  return findStorageLink(creep.room);
}

/** Stationary hub: storage → spawn / extensions / towers. One transfer hop. */
export function runFiller(creep: Creep): void {
  const storage = creep.room.storage;
  const carried = creep.store[RESOURCE_ENERGY] ?? 0;

  if (carried > 0) {
    const target = findFillTarget(creep);
    if (!target) {
      if (storage && !creep.pos.isNearTo(storage)) {
        creep.moveTo(storage);
      }
      return;
    }
    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
    }
    return;
  }

  if (!storage || (storage.store[RESOURCE_ENERGY] ?? 0) <= 0) return;
  if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(storage);
  }
}
