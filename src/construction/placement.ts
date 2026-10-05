function isBuildableTerrain(room: Room, x: number, y: number): boolean {
  const terrain = Game.map.getRoomTerrain(room.name);
  const t = terrain.get(x, y);
  return t !== TERRAIN_MASK_WALL;
}

/** Structures that block a newborn creep from landing (roads/containers are OK). */
function blocksSpawnLanding(structureType: StructureConstant): boolean {
  return (
    structureType !== STRUCTURE_ROAD && structureType !== STRUCTURE_CONTAINER
  );
}

function isFreeBuildTile(room: Room, x: number, y: number): boolean {
  if (x < 1 || x > 48 || y < 1 || y > 48) return false;
  if (!isBuildableTerrain(room, x, y)) return false;
  const pos = new RoomPosition(x, y, room.name);
  const blocking = pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => blocksSpawnLanding((s as Structure).structureType));
  if (blocking) return false;
  return pos.lookFor(LOOK_CONSTRUCTION_SITES).length === 0;
}

/**
 * Hard rule (Screeps basics): never seal the spawn ring with blocking structures.
 * Extensions/storage/towers on all 8 adjacent tiles → spawnCreep cannot deliver.
 * Keep the entire Chebyshev-range-1 ring free of blocking builds; only roads OK.
 */
export const SPAWN_EXIT_MIN_RANGE = 2;

const ADJACENT_DELTAS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Walkable adjacent tiles (no blocking structure/site, not wall). */
export function countFreeSpawnExits(
  room: Room,
  spawnPos: RoomPosition,
): number {
  let free = 0;
  for (const [dx, dy] of ADJACENT_DELTAS) {
    const x = spawnPos.x + dx;
    const y = spawnPos.y + dy;
    if (isFreeBuildTile(room, x, y)) free++;
  }
  return free;
}

/** True if (x,y) is on the spawn's range-1 ring (illegal for extensions/storage). */
export function isSpawnExitTile(
  spawnPos: RoomPosition,
  x: number,
  y: number,
): boolean {
  const chebyshev = Math.max(
    Math.abs(x - spawnPos.x),
    Math.abs(y - spawnPos.y),
  );
  return chebyshev === 1;
}

export function findAdjacentSpot(
  room: Room,
  anchor: RoomPosition,
): RoomPosition | null {
  for (const [dx, dy] of ADJACENT_DELTAS) {
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    if (!isFreeBuildTile(room, x, y)) continue;
    return new RoomPosition(x, y, room.name);
  }
  return null;
}

/**
 * Expanding ring around spawn for extensions/storage.
 * Default minRange=2 — never place blocking structures on the spawn exit ring.
 */
export function findBuildSpotNear(
  room: Room,
  anchor: RoomPosition,
  maxRange = 4,
  minRange = SPAWN_EXIT_MIN_RANGE,
): RoomPosition | null {
  const start = Math.max(1, minRange);
  for (let range = start; range <= maxRange; range++) {
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== range) continue;
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (!isFreeBuildTile(room, x, y)) continue;
        return new RoomPosition(x, y, room.name);
      }
    }
  }
  return null;
}

export function tryPlaceExtension(room: Room, spawnPos: RoomPosition): boolean {
  // Range 2..6 — leave the spawn landing ring completely open.
  const spot = findBuildSpotNear(room, spawnPos, 6, SPAWN_EXIT_MIN_RANGE);
  if (!spot) return false;
  return room.createConstructionSite(spot, STRUCTURE_EXTENSION) === OK;
}

export function tryPlaceContainer(room: Room, anchor: RoomPosition): boolean {
  const spot = findAdjacentSpot(room, anchor);
  if (!spot) return false;
  return room.createConstructionSite(spot, STRUCTURE_CONTAINER) === OK;
}

/** Storage near spawn, never on the exit ring. */
export function tryPlaceStorageNearSpawn(
  room: Room,
  spawnPos: RoomPosition,
): boolean {
  const spot = findBuildSpotNear(room, spawnPos, 3, SPAWN_EXIT_MIN_RANGE);
  if (!spot) return false;
  return room.createConstructionSite(spot, STRUCTURE_STORAGE) === OK;
}

export function tryPlaceRoadOnPath(
  room: Room,
  from: RoomPosition,
  to: RoomPosition,
): boolean {
  const path = from.findPathTo(to, { ignoreCreeps: true, swampCost: 2 });
  for (const step of path) {
    const pos = new RoomPosition(step.x, step.y, room.name);
    const hasRoad =
      pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === STRUCTURE_ROAD) ||
      pos
        .lookFor(LOOK_CONSTRUCTION_SITES)
        .some((s) => s.structureType === STRUCTURE_ROAD);
    if (hasRoad) continue;
    const blocked = pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => blocksSpawnLanding(s.structureType));
    if (blocked) continue;
    if (room.createConstructionSite(pos, STRUCTURE_ROAD) === OK) {
      return true;
    }
  }
  return false;
}
