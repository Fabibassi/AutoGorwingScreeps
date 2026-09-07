export function desiredCreeps(rcl: number): {
  harvester: number;
  upgrader: number;
} {
  if (rcl <= 1) return { harvester: 3, upgrader: 1 };
  return { harvester: 4, upgrader: 2 };
}

export function runSpawn(spawn: StructureSpawn): void {
  if (spawn.spawning) return;
  const body: BodyPartConstant[] = [WORK, CARRY, MOVE];
  const room = spawn.room;
  const rcl = room.controller?.level ?? 1;
  const want = desiredCreeps(rcl);
  const counts = { harvester: 0, upgrader: 0 };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role as keyof typeof counts;
    if (role in counts) counts[role]++;
  }
  const order: Array<keyof typeof want> = ["harvester", "upgrader"];
  for (const role of order) {
    if (counts[role] < want[role]) {
      const name = `${role}-${Game.time}`;
      const code = spawn.spawnCreep(body, name, { memory: { role } });
      if (code === OK) {
        console.log(`[t${Game.time}] spawn ${role} → ${name}`);
      }
      return;
    }
  }
}
