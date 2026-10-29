/** Static remote miner: harvest at target source; drop or transfer to container. */

import { fleeRemoteToHome } from "../defense/remoteThreat";

function findRemoteSource(creep: Creep): Source | null {
  const id = creep.memory.sourceId as Id<Source> | undefined;
  if (id) {
    const s = Game.getObjectById(id);
    if (s) return s;
  }
  const roomName = creep.memory.targetRoom;
  if (!roomName || creep.room.name !== roomName) return null;
  const sources = creep.room.find(FIND_SOURCES);
  return sources[0] ?? null;
}

function adjacentContainer(source: Source): StructureContainer | null {
  const structs = source.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  });
  return (structs[0] as StructureContainer | undefined) ?? null;
}

export function runRemoteMiner(creep: Creep): number {
  if (fleeRemoteToHome(creep)) return 0;
  const targetRoom = creep.memory.targetRoom;
  if (targetRoom && creep.room.name !== targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), {
      reusePath: 20,
      swampCost: 2,
    });
    return 0;
  }

  const source = findRemoteSource(creep);
  if (!source) {
    if (targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 20 });
    }
    return 0;
  }
  if (!creep.memory.sourceId) creep.memory.sourceId = source.id;

  if (!creep.pos.isNearTo(source)) {
    creep.moveTo(source, { reusePath: 10, ignoreCreeps: false });
    return 0;
  }

  const site = source.pos
    .findInRange(FIND_CONSTRUCTION_SITES, 1)
    .find((s) => s.structureType === STRUCTURE_CONTAINER);
  const energy = creep.store[RESOURCE_ENERGY] ?? 0;
  if (site && energy > 0) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) creep.moveTo(site);
    return 0;
  }

  const harvested = creep.harvest(source);
  if (harvested !== OK) return 0;

  const after = creep.store[RESOURCE_ENERGY] ?? 0;
  if (after <= 0) return 1;

  const container = adjacentContainer(source);
  if (container && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    creep.transfer(container, RESOURCE_ENERGY);
  } else if (!site) {
    creep.drop(RESOURCE_ENERGY);
  }
  return 1;
}
