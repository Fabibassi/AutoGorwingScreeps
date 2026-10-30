/**
 * Cheap remote clearer: walk to targetRoom, attack Invaders, idle/home when clear.
 */
import { pickInvaderTarget } from "../defense/invaderClear";
import { remoteThreatActive } from "../defense/remoteThreat";

export function runAttacker(creep: Creep): void {
  const targetRoom = creep.memory.targetRoom;
  const home = creep.memory.homeRoom;

  if (targetRoom && creep.room.name !== targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 20 });
    return;
  }

  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  const target =
    creep.pos.findClosestByPath(hostiles) ??
    creep.pos.findClosestByRange(hostiles) ??
    pickInvaderTarget(hostiles);

  if (target) {
    if (creep.attack(target) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { reusePath: 5, visualizePathStyle: { stroke: "#f00" } });
    }
    return;
  }

  // Room clear: head home and park near spawn (recycle when threat window ends).
  if (home && creep.room.name !== home) {
    creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
    return;
  }

  if (!remoteThreatActive(Memory.ags, Game.time)) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn) {
      if (creep.pos.isNearTo(spawn)) {
        spawn.recycleCreep(creep);
      } else {
        creep.moveTo(spawn, { reusePath: 10 });
      }
      return;
    }
  }

  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.inRangeTo(spawn, 3)) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}
