export const SPAWN_IDLE_MIN_RANGE = 3;
const SPAWN_IDLE_MAX_RANGE = 6;

function chebyshev(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function posOf(
  target: { pos?: { x: number; y: number } } | { x: number; y: number },
): { x: number; y: number } | null {
  if ("pos" in target && target.pos) return target.pos;
  if ("x" in target && "y" in target) return target as { x: number; y: number };
  return null;
}

function rangeBetween(
  a: { x: number; y: number },
  b: { pos?: { x: number; y: number } } | { x: number; y: number },
): number {
  const pb = posOf(b);
  if (!pb) return 99;
  return chebyshev(a.x, a.y, pb.x, pb.y);
}

function terrainAt(creep: Creep, x: number, y: number): number {
  const roomTerrain = creep.room.getTerrain?.();
  if (roomTerrain) return roomTerrain.get(x, y);
  return Game.map.getRoomTerrain(creep.room.name).get(x, y);
}

function structuresAt(creep: Creep, x: number, y: number): Structure[] {
  if (typeof creep.room.lookForAt !== "function") return [];
  return creep.room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
}

function isBlockingStructure(structureType: StructureConstant): boolean {
  return (
    structureType !== STRUCTURE_ROAD &&
    structureType !== STRUCTURE_CONTAINER &&
    structureType !== STRUCTURE_RAMPART
  );
}

function isWalkable(creep: Creep, x: number, y: number): boolean {
  if (x < 1 || x > 48 || y < 1 || y > 48) return false;
  if (terrainAt(creep, x, y) === TERRAIN_MASK_WALL) return false;
  for (const s of structuresAt(creep, x, y)) {
    if (isBlockingStructure(s.structureType)) return false;
  }
  return true;
}

function hasRoad(creep: Creep, x: number, y: number): boolean {
  return structuresAt(creep, x, y).some((s) => s.structureType === STRUCTURE_ROAD);
}

function occupiedTiles(exceptName: string | undefined): Set<string> {
  const set = new Set<string>();
  for (const name in Game.creeps ?? {}) {
    if (name === exceptName) continue;
    const other = Game.creeps[name];
    set.add(`${other.pos.x},${other.pos.y}`);
  }
  return set;
}

export function pickIdleStand(creep: Creep): { x: number; y: number; roomName: string } | null {
  if (typeof creep.room?.find !== "function") return null;
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return null;
  const occupied = occupiedTiles(creep.name);
  const seed = (creep.name ?? creep.id ?? "").charCodeAt(0) || 0;
  for (let r = SPAWN_IDLE_MIN_RANGE; r <= SPAWN_IDLE_MAX_RANGE; r++) {
    const ring: Array<{ x: number; y: number; score: number }> = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = spawn.pos.x + dx;
        const y = spawn.pos.y + dy;
        if (!isWalkable(creep, x, y)) continue;
        if (occupied.has(`${x},${y}`)) continue;
        const roadPenalty = hasRoad(creep, x, y) ? 0 : 10;
        const score = r * 100 + roadPenalty + ((x * 13 + y * 7 + seed) % 11);
        ring.push({ x, y, score });
      }
    }
    if (ring.length === 0) continue;
    ring.sort((a, b) => a.score - b.score);
    const pick = ring[0];
    if (!pick) continue;
    return { x: pick.x, y: pick.y, roomName: creep.room.name };
  }
  return null;
}

export function shouldStayOnSpawnRing(creep: Creep): boolean {
  if (creep.memory.recycling) return true;
  if (typeof creep.room?.find !== "function") return false;
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return false;
  if (rangeBetween(creep.pos, spawn) > 1) return false;

  const carried = creep.store[RESOURCE_ENERGY] ?? 0;
  const spawnFree = spawn.store.getFreeCapacity?.(RESOURCE_ENERGY) ?? 0;
  const role = creep.memory.role;
  if (
    carried > 0 &&
    spawnFree > 0 &&
    (role === "hauler" || role === "filler" || role === "harvester")
  ) {
    return true;
  }
  return false;
}

/** Move idle creeps off spawn + exit ring (range 0–1) to a stand ≥ range 3. */
export function evictIdleFromSpawnRing(creep: Creep): boolean {
  if (typeof creep.room?.find !== "function") return false;
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return false;
  if (rangeBetween(creep.pos, spawn) > 1) return false;
  if (shouldStayOnSpawnRing(creep)) return false;
  const stand = pickIdleStand(creep);
  if (!stand) return false;
  creep.moveTo(stand as unknown as RoomPosition, { reusePath: 5 });
  return true;
}
