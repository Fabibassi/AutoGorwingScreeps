/**
 * Spawn a single mineralMiner when extractor+terminal exist and mineral remains.
 */
import { STORAGE_FLOOR_ENERGY } from "./earlyGame/storageFloor";
import { shouldRunMineralMiner } from "./roles/mineralMiner";

export function countMineralMiners(homeRoom: string): number {
  let n = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role !== "mineralMiner") continue;
    if (c.memory.homeRoom && c.memory.homeRoom !== homeRoom) continue;
    n++;
  }
  return n;
}

export function buildMineralMinerBody(
  energyAvailable: number,
): BodyPartConstant[] {
  // Stationary-ish: WORK×n + CARRY + MOVE. Min cost 250.
  const minCost = 250;
  if (energyAvailable < minCost) return [];
  let work = 1;
  let remaining = energyAvailable - minCost;
  while (work < 5 && remaining >= 100) {
    work += 1;
    remaining -= 100;
  }
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < work; i++) body.push("work");
  body.push("carry", "move");
  return body;
}

export function trySpawnMineralMiner(spawn: StructureSpawn): boolean {
  if (spawn.spawning) return false;
  const room = spawn.room;
  const extractor = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_EXTRACTOR,
  })[0];
  const mineral = room.find(FIND_MINERALS)[0];
  if (
    !shouldRunMineralMiner({
      hasExtractor: Boolean(extractor),
      mineralAmount: mineral?.mineralAmount ?? 0,
      hasTerminal: Boolean(room.terminal),
      storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0,
      floor: STORAGE_FLOOR_ENERGY,
    })
  ) {
    return false;
  }
  if (countMineralMiners(room.name) >= 1) return false;

  const body = buildMineralMinerBody(room.energyAvailable);
  if (body.length === 0) return false;

  const name = `mineralMiner-${Game.time}-${Math.floor(Math.random() * 1_000_000)}`;
  return (
    spawn.spawnCreep(body, name, {
      memory: { role: "mineralMiner", homeRoom: room.name },
    }) === OK
  );
}
