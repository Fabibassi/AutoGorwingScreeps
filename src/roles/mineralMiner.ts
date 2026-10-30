/**
 * RCL6+ mineral harvest at extractor → dump into terminal (else storage).
 */

function findMineralDump(
  room: Room,
): StructureTerminal | StructureStorage | null {
  const terminal = room.terminal;
  if (terminal && terminal.store.getFreeCapacity() > 0) return terminal;
  const storage = room.storage;
  if (storage && storage.store.getFreeCapacity() > 0) return storage;
  return null;
}

export function shouldRunMineralMiner(opts: {
  hasExtractor: boolean;
  mineralAmount: number;
  hasTerminal: boolean;
  storageEnergy: number;
  floor: number;
}): boolean {
  if (!opts.hasExtractor || !opts.hasTerminal) return false;
  if (opts.mineralAmount <= 0) return false;
  return opts.storageEnergy > opts.floor;
}

export function runMineralMiner(creep: Creep): number {
  const room = creep.room;
  const mineral = room.find(FIND_MINERALS)[0];
  if (!mineral || mineral.mineralAmount <= 0) {
    // Cool-down / depleted — park near spawn for recycle.
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.inRangeTo(spawn, 3)) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return 0;
  }

  const carried = creep.store.getUsedCapacity();
  const free = creep.store.getFreeCapacity();

  if (carried > 0 && free === 0) {
    const dump = findMineralDump(room);
    if (!dump) return 0;
    const resource = Object.keys(creep.store).find(
      (k) => (creep.store[k as ResourceConstant] ?? 0) > 0,
    ) as ResourceConstant | undefined;
    if (!resource) return 0;
    if (creep.transfer(dump, resource) === ERR_NOT_IN_RANGE) {
      creep.moveTo(dump, { reusePath: 10 });
    }
    return 0;
  }

  if (!creep.pos.isNearTo(mineral)) {
    creep.moveTo(mineral, { reusePath: 20, visualizePathStyle: { stroke: "#88f" } });
    return 0;
  }

  const code = creep.harvest(mineral);
  if (code === OK) {
    return creep.getActiveBodyparts(WORK);
  }
  // Inventory full or no extractor — walk dump / stay seated.
  if (creep.store.getFreeCapacity() === 0) {
    const dump = findMineralDump(room);
    if (dump) creep.moveTo(dump, { reusePath: 5 });
  }
  return 0;
}
