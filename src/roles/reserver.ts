/** Keep remote controller reserved (CLAIM parts). */

import { fleeRemoteToHome } from "../defense/remoteThreat";

export function runReserver(creep: Creep): void {
  if (fleeRemoteToHome(creep)) return;
  const targetRoom = creep.memory.targetRoom;
  if (!targetRoom) return;

  if (creep.room.name !== targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), {
      reusePath: 30,
      swampCost: 2,
    });
    return;
  }

  const controller = creep.room.controller;
  if (!controller || controller.my) return;

  if (creep.pos.isNearTo(controller)) {
    if (controller.reservation && controller.reservation.username !== creep.owner.username) {
      creep.attackController(controller);
    } else {
      creep.reserveController(controller);
    }
  } else {
    creep.moveTo(controller, { reusePath: 15 });
  }
}
