import { linkFeedFloor, parseUpgradeStyle } from "../earlyGame/upgradeStyle";
import {
  classifyLinkRole,
  shouldFillStorageLink,
  shouldTransferStorageToController,
  transferAmount,
} from "./plan";

function feedFloor(): number {
  return linkFeedFloor(parseUpgradeStyle(Memory.ags?.upgradeStyle));
}

function ownedLinks(room: Room): StructureLink[] {
  return room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureLink => s.structureType === STRUCTURE_LINK,
  });
}

function pickPair(room: Room): {
  storageLink: StructureLink | null;
  controllerLink: StructureLink | null;
} {
  const storage = room.storage;
  const controller = room.controller;
  let storageLink: StructureLink | null = null;
  let controllerLink: StructureLink | null = null;
  for (const link of ownedLinks(room)) {
    const role = classifyLinkRole({
      linkPos: link.pos,
      storagePos: storage?.pos,
      controllerPos: controller?.pos,
    });
    if (role === "controller" && !controllerLink) controllerLink = link;
    else if (role === "storage" && !storageLink) storageLink = link;
  }
  return { storageLink, controllerLink };
}

/** Opportunistic: adjacent CARRY creep moves energy storage → storage link. */
function tryFillStorageLink(room: Room, storageLink: StructureLink): void {
  const storage = room.storage;
  if (!storage) return;
  const linkEnergy = storageLink.store[RESOURCE_ENERGY] ?? 0;
  if (
    !shouldFillStorageLink({
      linkEnergy,
      storageEnergy: storage.store[RESOURCE_ENERGY] ?? 0,
      storageFloor: feedFloor(),
    })
  ) {
    return;
  }

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;
    if (creep.getActiveBodyparts(CARRY) === 0) continue;
    if (!creep.pos.inRangeTo(storageLink, 1)) continue;

    const carried = creep.store[RESOURCE_ENERGY] ?? 0;
    if (carried > 0) {
      creep.transfer(storageLink, RESOURCE_ENERGY);
      return;
    }
    if (
      creep.pos.inRangeTo(storage, 1) &&
      (storage.store[RESOURCE_ENERGY] ?? 0) > 0
    ) {
      creep.withdraw(storage, RESOURCE_ENERGY);
      return;
    }
  }
}

/**
 * RCL5 hub pipeline: storage link → controller link.
 * Filler (and nearby CARRY) tops the storage link; upgraders withdraw controller link.
 */
export function runLinks(room: Room): void {
  if (!room.controller?.my || !room.storage) return;
  const { storageLink, controllerLink } = pickPair(room);
  if (!storageLink || !controllerLink) return;

  tryFillStorageLink(room, storageLink);

  const storageEnergy = storageLink.store[RESOURCE_ENERGY] ?? 0;
  const controllerEnergy = controllerLink.store[RESOURCE_ENERGY] ?? 0;
  const controllerFree =
    controllerLink.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0;

  if (
    !shouldTransferStorageToController({
      storageEnergy,
      controllerEnergy,
      storageCooldown: storageLink.cooldown,
      controllerFree,
      roomStorageEnergy: room.storage.store[RESOURCE_ENERGY] ?? 0,
      storageFloor: feedFloor(),
    })
  ) {
    return;
  }

  const amount = transferAmount(storageEnergy, controllerFree);
  if (amount <= 0) return;
  storageLink.transferEnergy(controllerLink, amount);
}
