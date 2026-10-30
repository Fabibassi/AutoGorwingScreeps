/**
 * GCL expand: walk to expandRoom and claim an unowned controller.
 */
export function runClaimer(creep: Creep): void {
  const targetRoom = creep.memory.targetRoom ?? Memory.ags?.expandRoom;
  if (!targetRoom) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.inRangeTo(spawn, 3)) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }

  if (creep.room.name !== targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30 });
    return;
  }

  const controller = creep.room.controller;
  if (!controller || controller.my) {
    // Done or invalid — recycle at home.
    const home = creep.memory.homeRoom;
    if (home && creep.room.name !== home) {
      creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
    }
    return;
  }

  if (controller.owner) {
    // Owned by someone else — abort expand target.
    if (Memory.ags?.expandRoom === targetRoom) delete Memory.ags.expandRoom;
    return;
  }

  if (creep.pos.isNearTo(controller)) {
    creep.claimController(controller);
  } else {
    creep.moveTo(controller, { reusePath: 15 });
  }
}
