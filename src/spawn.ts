export type CreepRoleCounts = { harvester: number; upgrader: number };

export type SpawnPriority =
  | { kind: "spawning"; role: string }
  | { kind: "spawn"; role: "harvester" | "upgrader" }
  | { kind: "maintain" };

export function desiredCreeps(rcl: number): CreepRoleCounts {
  if (rcl <= 1) return { harvester: 3, upgrader: 1 };
  return { harvester: 4, upgrader: 2 };
}

export function countCreepsByRole(): CreepRoleCounts {
  const counts: CreepRoleCounts = { harvester: 0, upgrader: 0 };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role as keyof CreepRoleCounts;
    if (role in counts) counts[role]++;
  }
  return counts;
}

export function getSpawnPriority(spawn: StructureSpawn): SpawnPriority {
  if (spawn.spawning) {
    const role = spawn.spawning.name.split("-")[0] || "unknown";
    return { kind: "spawning", role };
  }
  const rcl = spawn.room.controller?.level ?? 1;
  const want = desiredCreeps(rcl);
  const counts = countCreepsByRole();
  const order: Array<keyof CreepRoleCounts> = ["harvester", "upgrader"];
  for (const role of order) {
    if (counts[role] < want[role]) {
      return { kind: "spawn", role };
    }
  }
  return { kind: "maintain" };
}

export function runSpawn(spawn: StructureSpawn): void {
  if (spawn.spawning) return;
  const priority = getSpawnPriority(spawn);
  if (priority.kind !== "spawn") return;

  const body: BodyPartConstant[] = [WORK, CARRY, MOVE];
  const name = `${priority.role}-${Game.time}`;
  const code = spawn.spawnCreep(body, name, { memory: { role: priority.role } });
  if (code === OK) {
    console.log(`[t${Game.time}] spawn ${priority.role} → ${name}`);
  }
}
