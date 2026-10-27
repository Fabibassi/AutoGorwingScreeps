/** Haul remote energy (drop/container) to home storage. */

function homeStorage(creep: Creep): StructureStorage | null {
  const home = creep.memory.homeRoom;
  if (!home) return null;
  const room = Game.rooms[home];
  return room?.storage ?? null;
}

function pickRemoteEnergy(
  creep: Creep,
): Resource | StructureContainer | null {
  const roomName = creep.memory.targetRoom;
  if (!roomName || creep.room.name !== roomName) return null;

  const drops = creep.room
    .find(FIND_DROPPED_RESOURCES)
    .filter((r) => r.resourceType === RESOURCE_ENERGY && r.amount > 20)
    .sort((a, b) => b.amount - a.amount);
  if (drops[0]) return drops[0];

  const containers = creep.room
    .find(FIND_STRUCTURES, {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER &&
        (s.store[RESOURCE_ENERGY] ?? 0) > 50,
    })
    .sort(
      (a, b) =>
        (b.store[RESOURCE_ENERGY] ?? 0) - (a.store[RESOURCE_ENERGY] ?? 0),
    );
  return containers[0] ?? null;
}

export function runRemoteHauler(creep: Creep): void {
  const home = creep.memory.homeRoom ?? creep.memory.targetRoom;
  const targetRoom = creep.memory.targetRoom;
  const carrying = creep.store[RESOURCE_ENERGY] ?? 0;
  const cap = creep.store.getCapacity(RESOURCE_ENERGY) ?? 0;

  // Spawn marked us surplus — deliver cargo then walk home for recycle.
  if (creep.memory.recycling) {
    if (carrying > 0) {
      const storage = homeStorage(creep);
      if (storage) {
        if (creep.room.name !== storage.room.name) {
          creep.moveTo(storage, { reusePath: 20 });
          return;
        }
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, { reusePath: 10 });
        }
        return;
      }
    }
    if (home && creep.room.name !== home) {
      creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
    }
    return;
  }

  if (carrying > 0 && (carrying >= cap || creep.memory.hauling)) {
    creep.memory.hauling = true;
    const storage = homeStorage(creep);
    if (!storage) {
      if (home && creep.room.name !== home) {
        creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
      }
      return;
    }
    if (creep.room.name !== storage.room.name) {
      creep.moveTo(storage, { reusePath: 20 });
      return;
    }
    if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 10 });
    }
    if ((creep.store[RESOURCE_ENERGY] ?? 0) === 0) {
      delete creep.memory.hauling;
    }
    return;
  }

  delete creep.memory.hauling;
  if (targetRoom && creep.room.name !== targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 20 });
    return;
  }

  const src = pickRemoteEnergy(creep);
  if (!src) {
    if (targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30 });
    }
    return;
  }

  if (src instanceof Resource) {
    if (creep.pickup(src) === ERR_NOT_IN_RANGE) {
      creep.moveTo(src, { reusePath: 10 });
    }
  } else if (creep.withdraw(src, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(src, { reusePath: 10 });
  }
}
