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

function tileHasRoad(pos: RoomPosition): boolean {
  return (
    pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_ROAD) ||
    pos
      .lookFor(LOOK_CONSTRUCTION_SITES)
      .some((s) => s.structureType === STRUCTURE_ROAD)
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
  // Roads mark walk corridors — never park extensions/towers on them.
  if (tileHasRoad(pos)) return false;
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

/**
 * Tear down illegal spawn-ring blockers (extensions/storage/etc.).
 * Roads/containers stay (walkable). Storage with energy is deferred until empty
 * unless the ring is fully sealed (0 free exits).
 */
export function clearSpawnExitRing(
  room: Room,
  spawnPos: RoomPosition,
): { removedSites: number; destroyedStructures: number } {
  let removedSites = 0;
  let destroyedStructures = 0;

  const ringTiles: RoomPosition[] = [];
  for (const [dx, dy] of ADJACENT_DELTAS) {
    ringTiles.push(new RoomPosition(spawnPos.x + dx, spawnPos.y + dy, room.name));
  }

  for (const pos of ringTiles) {
    for (const site of pos.lookFor(LOOK_CONSTRUCTION_SITES)) {
      if (!blocksSpawnLanding(site.structureType)) continue;
      if (site.remove() === OK) removedSites++;
    }
  }

  const freeBefore = countFreeSpawnExits(room, spawnPos);
  for (const pos of ringTiles) {
    for (const s of pos.lookFor(LOOK_STRUCTURES)) {
      const type = s.structureType;
      if (!blocksSpawnLanding(type)) continue;
      if (type === STRUCTURE_SPAWN) continue;
      if (type === STRUCTURE_STORAGE) {
        const energy = (s as StructureStorage).store[RESOURCE_ENERGY] ?? 0;
        // Keep energy bank unless the spawn is completely sealed.
        if (energy > 0 && freeBefore > 0) continue;
      }
      if (s.destroy() === OK) destroyedStructures++;
    }
  }

  if (removedSites > 0 || destroyedStructures > 0) {
    console.log(
      `[spawn-exit] ${room.name} cleared ring sites=${removedSites} structs=${destroyedStructures} free=${countFreeSpawnExits(room, spawnPos)}`,
    );
  }
  return { removedSites, destroyedStructures };
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
 * preferOffCardinal: keep N/S/E/W corridors open (bunker cross) before filling
 * the axis tiles at that range.
 */
export function findBuildSpotNear(
  room: Room,
  anchor: RoomPosition,
  maxRange = 4,
  minRange = SPAWN_EXIT_MIN_RANGE,
  preferOffCardinal = false,
): RoomPosition | null {
  const start = Math.max(1, minRange);
  const passes: Array<(dx: number, dy: number) => boolean> = preferOffCardinal
    ? [(dx, dy) => dx !== 0 && dy !== 0, () => true]
    : [() => true];
  for (const accept of passes) {
    for (let range = start; range <= maxRange; range++) {
      for (let dx = -range; dx <= range; dx++) {
        for (let dy = -range; dy <= range; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== range) continue;
          if (!accept(dx, dy)) continue;
          const x = anchor.x + dx;
          const y = anchor.y + dy;
          if (!isFreeBuildTile(room, x, y)) continue;
          return new RoomPosition(x, y, room.name);
        }
      }
    }
  }
  return null;
}

/** Remove blocking construction sites that were wrongly placed on roads. */
export function clearBlockingSitesOnRoads(room: Room): number {
  let removed = 0;
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  for (const site of sites) {
    if (
      site.structureType === STRUCTURE_ROAD ||
      site.structureType === STRUCTURE_CONTAINER
    ) {
      continue;
    }
    const onRoad = site.pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_ROAD);
    if (onRoad && site.remove() === OK) removed++;
  }
  if (removed > 0) {
    console.log(`[road-clear] ${room.name} removed ${removed} sites on roads`);
  }
  return removed;
}

export function tryPlaceExtension(room: Room, spawnPos: RoomPosition): boolean {
  // Range 2..6 — leave landing ring + prefer off-cardinal (keep road cross open).
  const spot = findBuildSpotNear(
    room,
    spawnPos,
    6,
    SPAWN_EXIT_MIN_RANGE,
    true,
  );
  if (!spot) return false;
  return room.createConstructionSite(spot, STRUCTURE_EXTENSION) === OK;
}

/** Tower near spawn (range 2..4), never on the exit ring. */
export function tryPlaceTower(room: Room, spawnPos: RoomPosition): boolean {
  const spot = findBuildSpotNear(room, spawnPos, 4, SPAWN_EXIT_MIN_RANGE);
  if (!spot) return false;
  return room.createConstructionSite(spot, STRUCTURE_TOWER) === OK;
}

export function tryPlaceContainer(room: Room, anchor: RoomPosition): boolean {
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  for (const [dx, dy] of ADJACENT_DELTAS) {
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    // Never put a site on the spawn landing ring (even walkable containers clutter exits).
    if (spawn && isSpawnExitTile(spawn.pos, x, y)) continue;
    if (!isFreeBuildTile(room, x, y)) continue;
    const spot = new RoomPosition(x, y, room.name);
    if (room.createConstructionSite(spot, STRUCTURE_CONTAINER) === OK) {
      return true;
    }
  }
  return false;
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
