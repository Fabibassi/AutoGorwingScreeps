export function desiredCreeps(rcl: number): {
  harvester: number;
  upgrader: number;
} {
  if (rcl <= 1) return { harvester: 3, upgrader: 1 };
  return { harvester: 4, upgrader: 2 };
}

import { countCreepsByRole } from "./status";

export function runSpawn(spawn: StructureSpawn): void {
  if (spawn.spawning) return;
  const body: BodyPartConstant[] = [WORK, CARRY, MOVE];
  const room = spawn.room;
  const rcl = room.controller?.level ?? 1;
  const want = desiredCreeps(rcl);
  const counts = countCreepsByRole();
  const order: Array<keyof typeof want> = ["harvester", "upgrader"];
  for (const role of order) {
    if (counts[role] < want[role]) {
      const name = `${role}-${Game.time}`;
      spawn.spawnCreep(body, name, { memory: { role } });
      return;
    }
  }
}
