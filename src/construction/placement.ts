import {
  EDGE_MOUTH_FULL_OPEN_MAX,
  edgeTilesOnPathsToExits,
  pickChokeGate,
  type ExitSide,
} from "./edgeWalls";

/**
 * Room-edge wall line (Screeps exits sit on 0/49).
 * Fixed band at 2 / 47 — ignore swamp / deeper chokes.
 */
export const WALL_EDGE_COORD = 2;
export const WALL_EDGE_HI = 49 - WALL_EDGE_COORD; // 47

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

function tileHasBlockingStructure(pos: RoomPosition): boolean {
  return pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => blocksSpawnLanding((s as Structure).structureType));
}

/**
 * Hard rule (Screeps basics): never seal the spawn ring with blocking structures.
 * Extensions/storage/towers on all 8 adjacent tiles → spawnCreep cannot deliver.
 * Keep the entire Chebyshev-range-1 ring free of blocking builds; only roads OK.
 */
export const SPAWN_EXIT_MIN_RANGE = 2;

/** How far the N/S/E/W hub road rays extend from spawn. */
export const HUB_CORRIDOR_RAY = 4;

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

/**
 * Reserved walk network (diamond hub):
 * - range-1 exit ring around spawn
 * - cardinal rays N/S/E/W through the hub
 * Roads belong here; blocking structures never do — even before a road exists.
 */
export function isHubCorridor(
  spawnPos: RoomPosition,
  x: number,
  y: number,
  maxRay = HUB_CORRIDOR_RAY,
): boolean {
  const dx = x - spawnPos.x;
  const dy = y - spawnPos.y;
  const r = Math.max(Math.abs(dx), Math.abs(dy));
  if (r === 0) return true;
  if (r === 1) return true;
  if ((dx === 0 || dy === 0) && r <= maxRay) return true;
  return false;
}

/**
 * Diamond extension pockets relative to spawn.
 * Roads form the cross; structures sit in the gaps (community diagonal/bunker pattern).
 */
export const HUB_EXTENSION_STAMP: ReadonlyArray<readonly [number, number]> = [
  // r2 pockets (not the exit ring — [±1,±1] is still range 1)
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2],
  // r3
  [3, 1],
  [3, -1],
  [-3, 1],
  [-3, -1],
  [1, 3],
  [1, -3],
  [-1, 3],
  [-1, -3],
  [3, 2],
  [3, -2],
  [-3, 2],
  [-3, -2],
  [2, 3],
  [2, -3],
  [-2, 3],
  [-2, -3],
  [3, 3],
  [3, -3],
  [-3, 3],
  [-3, -3],
  // r4
  [4, 1],
  [4, -1],
  [-4, 1],
  [-4, -1],
  [1, 4],
  [1, -4],
  [-1, 4],
  [-1, -4],
  [4, 2],
  [4, -2],
  [-4, 2],
  [-4, -2],
  [2, 4],
  [2, -4],
  [-2, 4],
  [-2, -4],
  [4, 3],
  [4, -3],
  [-4, 3],
  [-4, -3],
  [3, 4],
  [3, -4],
  [-3, 4],
  [-3, -4],
  [4, 4],
  [4, -4],
  [-4, 4],
  [-4, -4],
  // r5 — extra pockets when walkway-buffer / roads fill r2–r4 (live RCL5 stall ~23 ext).
  [5, 1],
  [5, -1],
  [-5, 1],
  [-5, -1],
  [1, 5],
  [1, -5],
  [-1, 5],
  [-1, -5],
  [5, 2],
  [5, -2],
  [-5, 2],
  [-5, -2],
  [2, 5],
  [2, -5],
  [-2, 5],
  [-2, -5],
  [5, 3],
  [5, -3],
  [-5, 3],
  [-5, -3],
  [3, 5],
  [3, -5],
  [-3, 5],
  [-3, -5],
  [5, 4],
  [5, -4],
  [-5, 4],
  [-5, -4],
  [4, 5],
  [4, -5],
  [-4, 5],
  [-4, -5],
  [5, 5],
  [5, -5],
  [-5, 5],
  [-5, -5],
];

/** Hub road stamp: exit ring + cardinal rays. */
export const HUB_ROAD_STAMP: ReadonlyArray<readonly [number, number]> = [
  ...ADJACENT_DELTAS,
  [0, 2],
  [0, -2],
  [2, 0],
  [-2, 0],
  [0, 3],
  [0, -3],
  [3, 0],
  [-3, 0],
  [0, 4],
  [0, -4],
  [4, 0],
  [-4, 0],
];

/** Min Chebyshev gap to walls/sources: 2 walkable tiles (no 1-creep tunnels). */
export const WALKWAY_BUFFER = 2;

function isWalkwayObstruction(room: Room, x: number, y: number): boolean {
  if (x < 0 || x > 49 || y < 0 || y > 49) return true;
  if (!isBuildableTerrain(room, x, y)) return true;
  const controller = room.controller;
  if (controller && controller.pos.x === x && controller.pos.y === y) {
    return true;
  }
  const pos = new RoomPosition(x, y, room.name);
  if (typeof pos.lookFor === "function") {
    if (typeof LOOK_SOURCES !== "undefined") {
      if (pos.lookFor(LOOK_SOURCES).length > 0) return true;
    }
    if (typeof LOOK_MINERALS !== "undefined") {
      if (pos.lookFor(LOOK_MINERALS).length > 0) return true;
    }
    for (const s of pos.lookFor(LOOK_STRUCTURES)) {
      if (
        typeof STRUCTURE_WALL !== "undefined" &&
        s.structureType === STRUCTURE_WALL
      ) {
        return true;
      }
    }
  }
  return false;
}

/** True when a blocking hub structure would pinch a 1-tile tunnel against walls. */
export function tooCloseToWalkwayObstruction(
  room: Room,
  x: number,
  y: number,
): boolean {
  for (let dx = -WALKWAY_BUFFER; dx <= WALKWAY_BUFFER; dx++) {
    for (let dy = -WALKWAY_BUFFER; dy <= WALKWAY_BUFFER; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (isWalkwayObstruction(room, x + dx, y + dy)) return true;
    }
  }
  return false;
}

/** Minimum walkable seats next to storage so filler/hauler can withdraw. */
export const MIN_STORAGE_ACCESS = 2;

/** True if (x,y) is on storage's Chebyshev-range-1 ring. */
export function isStorageAccessTile(
  storagePos: RoomPosition,
  x: number,
  y: number,
): boolean {
  const chebyshev = Math.max(
    Math.abs(x - storagePos.x),
    Math.abs(y - storagePos.y),
  );
  return chebyshev === 1;
}

/** Walkable adjacent tiles around storage (roads/containers OK; blockers count). */
export function countFreeStorageAccess(
  room: Room,
  storagePos: RoomPosition,
): number {
  let free = 0;
  for (const [dx, dy] of ADJACENT_DELTAS) {
    const x = storagePos.x + dx;
    const y = storagePos.y + dy;
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    if (!isBuildableTerrain(room, x, y)) continue;
    const pos = new RoomPosition(x, y, room.name);
    if (tileHasBlockingStructure(pos)) continue;
    if (
      pos
        .lookFor(LOOK_CONSTRUCTION_SITES)
        .some((s) => blocksSpawnLanding(s.structureType))
    ) {
      continue;
    }
    free++;
  }
  return free;
}

/**
 * Tear down blockers on storage's access ring until ≥ MIN_STORAGE_ACCESS seats.
 * Prefer extensions, then towers; keep links if possible. Live softlock: spawn
 * empty while storage full because filler cannot stand next to storage.
 *
 * Blocking sites on the ring are always removed (links exempt). Placement must
 * not re-site there — otherwise place→clear thrash under storage (live home).
 */
export function clearStorageAccessRing(
  room: Room,
  storagePos: RoomPosition,
): { removedSites: number; destroyedStructures: number } {
  let removedSites = 0;
  let destroyedStructures = 0;

  const accessTiles: RoomPosition[] = [];
  for (const [dx, dy] of ADJACENT_DELTAS) {
    const x = storagePos.x + dx;
    const y = storagePos.y + dy;
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    accessTiles.push(new RoomPosition(x, y, room.name));
  }

  for (const pos of accessTiles) {
    for (const site of pos.lookFor(LOOK_CONSTRUCTION_SITES)) {
      if (!blocksSpawnLanding(site.structureType)) continue;
      if (site.structureType === STRUCTURE_LINK) continue;
      if (site.remove() === OK) removedSites++;
    }
  }

  const destroyPriority = (type: StructureConstant): number => {
    if (type === STRUCTURE_EXTENSION) return 0;
    if (type === STRUCTURE_TOWER) return 1;
    if (type === STRUCTURE_LINK) return 2;
    return 3;
  };

  while (countFreeStorageAccess(room, storagePos) < MIN_STORAGE_ACCESS) {
    let victim: Structure | null = null;
    let bestPri = 99;
    for (const pos of accessTiles) {
      for (const s of pos.lookFor(LOOK_STRUCTURES)) {
        const type = s.structureType;
        if (!blocksSpawnLanding(type)) continue;
        if (type === STRUCTURE_STORAGE || type === STRUCTURE_SPAWN) continue;
        const pri = destroyPriority(type);
        if (pri < bestPri) {
          bestPri = pri;
          victim = s as Structure;
        }
      }
    }
    if (!victim) break;
    if (victim.destroy() === OK) destroyedStructures++;
    else break;
  }

  if (removedSites > 0 || destroyedStructures > 0) {
    console.log(
      `[storage-access] ${room.name} cleared sites=${removedSites} structs=${destroyedStructures} free=${countFreeStorageAccess(room, storagePos)}`,
    );
  }
  return { removedSites, destroyedStructures };
}

/** Tile free for a blocking structure (extension/tower/storage). */
function isFreeBuildTile(
  room: Room,
  x: number,
  y: number,
  spawnPos?: RoomPosition,
  opts?: { walkwayBuffer?: boolean; allowStorageAccess?: boolean },
): boolean {
  if (x < 1 || x > 48 || y < 1 || y > 48) return false;
  if (!isBuildableTerrain(room, x, y)) return false;
  if (spawnPos && isHubCorridor(spawnPos, x, y)) return false;
  if (opts?.walkwayBuffer && tooCloseToWalkwayObstruction(room, x, y)) {
    return false;
  }
  const storage = room.storage;
  if (
    storage &&
    !opts?.allowStorageAccess &&
    isStorageAccessTile(storage.pos, x, y)
  ) {
    // Entire Chebyshev-1 ring stays walkable for filler/hauler (links may opt in).
    return false;
  }
  const pos = new RoomPosition(x, y, room.name);
  if (tileHasBlockingStructure(pos)) return false;
  if (tileHasRoad(pos)) return false;
  return pos.lookFor(LOOK_CONSTRUCTION_SITES).length === 0;
}

/** Walkable adjacent tiles (no blocking structure; roads OK). */
export function countFreeSpawnExits(
  room: Room,
  spawnPos: RoomPosition,
): number {
  let free = 0;
  for (const [dx, dy] of ADJACENT_DELTAS) {
    const x = spawnPos.x + dx;
    const y = spawnPos.y + dy;
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    if (!isBuildableTerrain(room, x, y)) continue;
    const pos = new RoomPosition(x, y, room.name);
    if (tileHasBlockingStructure(pos)) continue;
    if (pos.lookFor(LOOK_CONSTRUCTION_SITES).some((s) => blocksSpawnLanding(s.structureType))) {
      continue;
    }
    free++;
  }
  return free;
}

/**
 * Tear down illegal blockers on the diamond walk network:
 * spawn exit ring (range 1) and N/S/E/W hub rays (range 2–4).
 * Roads/containers stay (walkable). Storage with energy is deferred until empty
 * unless the ring is fully sealed (0 free exits).
 */
export function clearSpawnExitRing(
  room: Room,
  spawnPos: RoomPosition,
): { removedSites: number; destroyedStructures: number } {
  let removedSites = 0;
  let destroyedStructures = 0;

  const corridorTiles: RoomPosition[] = [];
  for (const [dx, dy] of HUB_ROAD_STAMP) {
    const x = spawnPos.x + dx;
    const y = spawnPos.y + dy;
    if (x < 0 || x > 49 || y < 0 || y > 49) continue;
    corridorTiles.push(new RoomPosition(x, y, room.name));
  }

  for (const pos of corridorTiles) {
    for (const site of pos.lookFor(LOOK_CONSTRUCTION_SITES)) {
      if (!blocksSpawnLanding(site.structureType)) continue;
      if (site.remove() === OK) removedSites++;
    }
  }

  const freeBefore = countFreeSpawnExits(room, spawnPos);
  for (const pos of corridorTiles) {
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
 * Expanding ring around spawn (legacy helper / non-stamp structures).
 * Default minRange=2 — never place blocking structures on the spawn exit ring.
 * preferOffCardinal: keep N/S/E/W corridors open before axis tiles.
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
          if (!isFreeBuildTile(room, x, y, anchor)) continue;
          return new RoomPosition(x, y, room.name);
        }
      }
    }
  }
  return null;
}

/**
 * Remove blocking construction sites on roads or reserved hub corridors
 * (cardinal rays + exit ring) — the researched diamond walk network.
 */
export function clearBlockingSitesOnRoads(room: Room): number {
  const spawn = room.find(FIND_MY_SPAWNS)[0];
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
    const onCorridor =
      spawn != null && isHubCorridor(spawn.pos, site.pos.x, site.pos.y);
    if ((onRoad || onCorridor) && site.remove() === OK) removed++;
  }
  if (removed > 0) {
    console.log(`[road-clear] ${room.name} removed ${removed} sites on corridors/roads`);
  }
  return removed;
}

/** Place next missing hub road from the diamond stamp (exits + cardinal rays). */
export function tryPlaceHubRoad(
  room: Room,
  spawnPos: RoomPosition,
): boolean {
  for (const [dx, dy] of HUB_ROAD_STAMP) {
    const x = spawnPos.x + dx;
    const y = spawnPos.y + dy;
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    if (!isBuildableTerrain(room, x, y)) continue;
    const pos = new RoomPosition(x, y, room.name);
    if (tileHasRoad(pos)) continue;
    if (tileHasBlockingStructure(pos)) continue;
    if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) continue;
    if (room.createConstructionSite(pos, STRUCTURE_ROAD) === OK) return true;
  }
  return false;
}

export function tryPlaceExtension(room: Room, spawnPos: RoomPosition): boolean {
  // Stamp pockets first (walkway buffer), then stamp without buffer, then ring search.
  for (const useBuffer of [true, false]) {
    for (const [dx, dy] of HUB_EXTENSION_STAMP) {
      const x = spawnPos.x + dx;
      const y = spawnPos.y + dy;
      if (
        !isFreeBuildTile(room, x, y, spawnPos, { walkwayBuffer: useBuffer })
      ) {
        continue;
      }
      if (room.createConstructionSite(x, y, STRUCTURE_EXTENSION) === OK) {
        return true;
      }
    }
  }
  const spot = findBuildSpotNear(room, spawnPos, 7, SPAWN_EXIT_MIN_RANGE, true);
  if (
    spot &&
    room.createConstructionSite(spot, STRUCTURE_EXTENSION) === OK
  ) {
    return true;
  }
  return false;
}

/** Tower in a stamp pocket near spawn (same diamond gaps as extensions). */
/**
 * Place rampart sites on hub tiles when walls are armed.
 * Covers all spawns, storage, terminal, towers (shared tile — early gate shell).
 * Places every missing anchor this tick (not just one) so a wipe recovers fast.
 */
export function tryPlaceHubRamparts(room: Room): boolean {
  const anchors: RoomPosition[] = [];
  for (const spawn of room.find(FIND_MY_SPAWNS)) {
    anchors.push(spawn.pos);
  }
  if (room.storage) anchors.push(room.storage.pos);
  if (room.terminal) anchors.push(room.terminal.pos);
  for (const tower of room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureTower => s.structureType === STRUCTURE_TOWER,
  })) {
    anchors.push(tower.pos);
  }

  let placed = false;
  let lastFail: number | undefined;
  for (const pos of anchors) {
    const hasRampart = pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_RAMPART);
    if (hasRampart) continue;
    const hasSite = pos
      .lookFor(LOOK_CONSTRUCTION_SITES)
      .some((s) => s.structureType === STRUCTURE_RAMPART);
    if (hasSite) continue;
    const code = room.createConstructionSite(pos, STRUCTURE_RAMPART);
    if (code === OK) {
      placed = true;
    } else {
      lastFail = code;
    }
  }
  if (lastFail != null && Memory.ags) {
    Memory.ags.lastWallPlaceFail = {
      tick: Game.time,
      code: lastFail,
      kind: "hubRampart",
    };
  }
  return placed;
}

const HUB_STAMP_SET = new Set(
  HUB_EXTENSION_STAMP.map(([dx, dy]) => `${dx},${dy}`),
);

/** True on diamond extension pockets (walls must never seal these). */
export function isHubStampTile(
  spawnPos: RoomPosition,
  x: number,
  y: number,
): boolean {
  const dx = x - spawnPos.x;
  const dy = y - spawnPos.y;
  return HUB_STAMP_SET.has(`${dx},${dy}`);
}

/** Perimeter tiles for the fixed edge wall (full 2/47 frame). */
export function isRoomEdgeWallTile(x: number, y: number): boolean {
  const onV = x === WALL_EDGE_COORD || x === WALL_EDGE_HI;
  const onH = y === WALL_EDGE_COORD || y === WALL_EDGE_HI;
  if (!onV && !onH) return false;
  if (x < WALL_EDGE_COORD || x > WALL_EDGE_HI) return false;
  if (y < WALL_EDGE_COORD || y > WALL_EDGE_HI) return false;
  return true;
}

function exitSides(): Array<{ side: ExitSide; find: ExitConstant }> {
  return [
    { side: "top", find: FIND_EXIT_TOP },
    { side: "right", find: FIND_EXIT_RIGHT },
    { side: "bottom", find: FIND_EXIT_BOTTOM },
    { side: "left", find: FIND_EXIT_LEFT },
  ];
}

function terrainWalkable(room: Room, x: number, y: number): boolean {
  if (x < 0 || x > 49 || y < 0 || y > 49) return false;
  return isBuildableTerrain(room, x, y);
}

/** Existing walls + wall sites that already block pathing. */
export function existingWallBlockSet(room: Room): Set<string> {
  const blocked = new Set<string>();
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_WALL) {
      blocked.add(`${s.pos.x},${s.pos.y}`);
    }
  }
  for (const s of room.find(FIND_CONSTRUCTION_SITES)) {
    if (s.structureType === STRUCTURE_WALL) {
      blocked.add(`${s.pos.x},${s.pos.y}`);
    }
  }
  return blocked;
}

export function edgeSideAt(x: number, y: number): ExitSide | null {
  if (y === WALL_EDGE_COORD) return "top";
  if (y === WALL_EDGE_HI) return "bottom";
  if (x === WALL_EDGE_COORD) return "left";
  if (x === WALL_EDGE_HI) return "right";
  return null;
}

function exitsForSide(room: Room, side: ExitSide): RoomPosition[] {
  const row = exitSides().find((s) => s.side === side);
  if (!row) return [];
  return room.find(row.find) as RoomPosition[];
}

/** Walkable tiles on the 2/47 line for one side. */
export function walkableEdgeTilesForSide(
  room: Room,
  side: ExitSide,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let a = WALL_EDGE_COORD; a <= WALL_EDGE_HI; a++) {
    const p =
      side === "top" || side === "bottom"
        ? { x: a, y: side === "top" ? WALL_EDGE_COORD : WALL_EDGE_HI }
        : { x: side === "left" ? WALL_EDGE_COORD : WALL_EDGE_HI, y: a };
    if (terrainWalkable(room, p.x, p.y)) out.push(p);
  }
  return out;
}

function isEdgeTileOnSide(side: ExitSide, x: number, y: number): boolean {
  switch (side) {
    case "top":
      return y === WALL_EDGE_COORD;
    case "bottom":
      return y === WALL_EDGE_HI;
    case "left":
      return x === WALL_EDGE_COORD;
    case "right":
      return x === WALL_EDGE_HI;
  }
}

/**
 * Exit-approach mouth = edge tiles on spawn↔exit paths.
 * Only these can ever get walls (dead edge pockets have no defensive value).
 */
export function exitMouthTilesForSide(
  room: Room,
  spawnPos: RoomPosition,
  side: ExitSide,
): Set<string> {
  const exits = exitsForSide(room, side);
  if (exits.length === 0) return new Set();
  const walk = (x: number, y: number) => terrainWalkable(room, x, y);
  return edgeTilesOnPathsToExits(walk, spawnPos, exits, (x, y) =>
    isEdgeTileOnSide(side, x, y),
  );
}

/**
 * Tiles that must stay open: whole narrow mouth, or one gate on a wide mouth.
 */
export function openEdgeTilesForSide(
  room: Room,
  spawnPos: RoomPosition,
  side: ExitSide,
): Set<string> {
  const mouth = exitMouthTilesForSide(room, spawnPos, side);
  if (mouth.size === 0) return mouth;
  if (mouth.size <= EDGE_MOUTH_FULL_OPEN_MAX) return mouth;
  const tiles = [...mouth].map((k) => {
    const [xs, ys] = k.split(",");
    return { x: Number(xs), y: Number(ys) };
  });
  const gate = pickChokeGate(tiles, spawnPos);
  const open = new Set<string>();
  if (gate) open.add(`${gate.x},${gate.y}`);
  return open;
}

export function isEdgeWallGate(
  room: Room,
  spawnPos: RoomPosition,
  x: number,
  y: number,
): boolean {
  const side = edgeSideAt(x, y);
  if (!side) return false;
  return openEdgeTilesForSide(room, spawnPos, side).has(`${x},${y}`);
}

/**
 * Wall only where it controls an exit approach:
 * - tile must lie on a spawn↔exit mouth
 * - narrow mouths (≤3) stay fully open (no walls)
 * - wide mouths: wall mouth tiles except one gate
 * Dead edge holes that lead nowhere are never walled.
 */
export function isAllowedEdgeWallTile(
  room: Room,
  spawnPos: RoomPosition,
  x: number,
  y: number,
): boolean {
  if (!isRoomEdgeWallTile(x, y)) return false;
  if (isHubStampTile(spawnPos, x, y)) return false;
  if (isSpawnExitTile(spawnPos, x, y)) return false;
  if (isHubCorridor(spawnPos, x, y)) return false;
  if (!terrainWalkable(room, x, y)) return false;
  const side = edgeSideAt(x, y);
  if (!side) return false;
  const mouth = exitMouthTilesForSide(room, spawnPos, side);
  if (mouth.size === 0) return false;
  if (!mouth.has(`${x},${y}`)) return false; // dead pocket → no benefit
  if (mouth.size <= EDGE_MOUTH_FULL_OPEN_MAX) return false; // narrow: leave open
  const open = openEdgeTilesForSide(room, spawnPos, side);
  if (open.has(`${x},${y}`)) return false; // gate
  return true;
}

/**
 * Scrub wall sites that are not allowed edge walls (wrong tile / gate / no-exit side).
 */
export function clearWallSitesInHub(
  room: Room,
  spawnPos: RoomPosition,
): number {
  let removed = 0;
  for (const site of room.find(FIND_CONSTRUCTION_SITES)) {
    if (site.structureType !== STRUCTURE_WALL) continue;
    const { x, y } = site.pos;
    if (!isAllowedEdgeWallTile(room, spawnPos, x, y)) {
      if (site.remove() === OK) removed += 1;
    }
  }
  return removed;
}

/**
 * Place one wall site on the fixed 2/47 frame (path-safe per side).
 */
export function tryPlaceWallRing(
  room: Room,
  spawnPos: RoomPosition,
): boolean {
  const edges: Array<[number, number]> = [];
  for (let i = WALL_EDGE_COORD; i <= WALL_EDGE_HI; i++) {
    edges.push([i, WALL_EDGE_COORD]);
    edges.push([i, WALL_EDGE_HI]);
    edges.push([WALL_EDGE_COORD, i]);
    edges.push([WALL_EDGE_HI, i]);
  }

  for (const [x, y] of edges) {
    if (!isAllowedEdgeWallTile(room, spawnPos, x, y)) continue;
    const pos = new RoomPosition(x, y, room.name);
    if (tileHasBlockingStructure(pos)) continue;
    if (
      pos
        .lookFor(LOOK_CONSTRUCTION_SITES)
        .some((s) => s.structureType === STRUCTURE_WALL)
    ) {
      continue;
    }
    if (
      pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_WALL)
    ) {
      continue;
    }
    if (room.createConstructionSite(x, y, STRUCTURE_WALL) === OK) {
      return true;
    }
  }
  return false;
}

/**
 * Second spawn (RCL7+): stamp pocket near first spawn, never on exit ring.
 */
export function tryPlaceSecondSpawn(
  room: Room,
  spawnPos: RoomPosition,
): boolean {
  for (const useBuffer of [true, false]) {
    for (const [dx, dy] of HUB_EXTENSION_STAMP) {
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      if (r < 2 || r > 5) continue;
      const x = spawnPos.x + dx;
      const y = spawnPos.y + dy;
      if (
        !isFreeBuildTile(room, x, y, spawnPos, { walkwayBuffer: useBuffer })
      ) {
        continue;
      }
      if (room.createConstructionSite(x, y, STRUCTURE_SPAWN) === OK) {
        return true;
      }
    }
  }
  const spot = findBuildSpotNear(room, spawnPos, 6, SPAWN_EXIT_MIN_RANGE, true);
  if (spot && room.createConstructionSite(spot, STRUCTURE_SPAWN) === OK) {
    return true;
  }
  return false;
}

export function tryPlaceTower(room: Room, spawnPos: RoomPosition): boolean {
  for (const useBuffer of [true, false]) {
    for (const [dx, dy] of HUB_EXTENSION_STAMP) {
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      if (r > 5) continue;
      const x = spawnPos.x + dx;
      const y = spawnPos.y + dy;
      if (
        !isFreeBuildTile(room, x, y, spawnPos, { walkwayBuffer: useBuffer })
      ) {
        continue;
      }
      if (room.createConstructionSite(x, y, STRUCTURE_TOWER) === OK) return true;
    }
  }
  const spot = findBuildSpotNear(room, spawnPos, 6, SPAWN_EXIT_MIN_RANGE, true);
  if (spot && room.createConstructionSite(spot, STRUCTURE_TOWER) === OK) {
    return true;
  }
  return false;
}

export function tryPlaceContainer(room: Room, anchor: RoomPosition): boolean {
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  for (const [dx, dy] of ADJACENT_DELTAS) {
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    // Never put a site on the spawn landing ring (even walkable containers clutter exits).
    if (spawn && isSpawnExitTile(spawn.pos, x, y)) continue;
    if (spawn && isHubCorridor(spawn.pos, x, y)) continue;
    if (!isFreeBuildTile(room, x, y, spawn?.pos)) continue;
    const spot = new RoomPosition(x, y, room.name);
    if (room.createConstructionSite(spot, STRUCTURE_CONTAINER) === OK) {
      return true;
    }
  }
  return false;
}

/** Storage in a stamp pocket near spawn — never on exit ring / corridor. */
export function tryPlaceStorageNearSpawn(
  room: Room,
  spawnPos: RoomPosition,
): boolean {
  for (const [dx, dy] of HUB_EXTENSION_STAMP) {
    const r = Math.max(Math.abs(dx), Math.abs(dy));
    if (r > 3) continue;
    const x = spawnPos.x + dx;
    const y = spawnPos.y + dy;
    if (!isFreeBuildTile(room, x, y, spawnPos, { walkwayBuffer: true })) continue;
    if (room.createConstructionSite(x, y, STRUCTURE_STORAGE) === OK) return true;
  }
  return false;
}

/**
 * Link next to storage (prefer stamp pocket in range ≤2 of storage).
 * Falls back to ring search around storage, then spawn.
 */
export function tryPlaceStorageLink(
  room: Room,
  spawnPos: RoomPosition,
  storagePos: RoomPosition,
): boolean {
  // Links may sit on a storage access tile only while ≥ MIN seats remain after.
  const allowAccess =
    countFreeStorageAccess(room, storagePos) > MIN_STORAGE_ACCESS;
  for (const useBuffer of [true, false]) {
    for (const [dx, dy] of HUB_EXTENSION_STAMP) {
      const x = spawnPos.x + dx;
      const y = spawnPos.y + dy;
      const chebyshev = Math.max(
        Math.abs(x - storagePos.x),
        Math.abs(y - storagePos.y),
      );
      if (chebyshev > 2) continue;
      if (
        !isFreeBuildTile(room, x, y, spawnPos, {
          walkwayBuffer: useBuffer,
          allowStorageAccess: allowAccess,
        })
      ) {
        continue;
      }
      if (room.createConstructionSite(x, y, STRUCTURE_LINK) === OK) return true;
    }
  }
  const nearStorage = findBuildSpotNear(room, storagePos, 2, 1, true);
  if (
    nearStorage &&
    room.createConstructionSite(nearStorage, STRUCTURE_LINK) === OK
  ) {
    return true;
  }
  const nearSpawn = findBuildSpotNear(
    room,
    spawnPos,
    3,
    SPAWN_EXIT_MIN_RANGE,
    true,
  );
  if (nearSpawn && room.createConstructionSite(nearSpawn, STRUCTURE_LINK) === OK) {
    return true;
  }
  return false;
}

/** Controller link in Chebyshev range ≤2 (upgrade withdraw seat). */
export function tryPlaceControllerLink(
  room: Room,
  spawnPos: RoomPosition,
  controllerPos: RoomPosition,
): boolean {
  const spot = findBuildSpotNear(room, controllerPos, 2, 1, true);
  if (spot && room.createConstructionSite(spot, STRUCTURE_LINK) === OK) {
    return true;
  }
  // Fallback: any free tile in range 2 ignoring stamp preference.
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = controllerPos.x + dx;
      const y = controllerPos.y + dy;
      if (!isFreeBuildTile(room, x, y, spawnPos)) continue;
      if (room.createConstructionSite(x, y, STRUCTURE_LINK) === OK) return true;
    }
  }
  return false;
}

/**
 * Place a link adjacent to `anchor` (storage or controller), then near-ring fallback.
 * Respects spawn exit ring / hub corridors like other blocking structures.
 */
export function tryPlaceLinkNear(
  room: Room,
  anchor: RoomPosition,
  spawnPos?: RoomPosition,
): boolean {
  const spawn = spawnPos ?? room.find(FIND_MY_SPAWNS)[0]?.pos;
  for (const useBuffer of [true, false]) {
    for (const [dx, dy] of ADJACENT_DELTAS) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (!isFreeBuildTile(room, x, y, spawn, { walkwayBuffer: useBuffer })) {
        continue;
      }
      if (room.createConstructionSite(x, y, STRUCTURE_LINK) === OK) return true;
    }
  }
  const spot = findBuildSpotNear(room, anchor, 3, 1, true);
  if (spot && room.createConstructionSite(spot, STRUCTURE_LINK) === OK) {
    return true;
  }
  return false;
}

/** Terminal near storage (RCL6). Keeps spawn exit / storage access free. */
export function tryPlaceTerminalNearStorage(
  room: Room,
  storagePos: RoomPosition,
  spawnPos?: RoomPosition,
): boolean {
  const spawn = spawnPos ?? room.find(FIND_MY_SPAWNS)[0]?.pos;
  for (const useBuffer of [true, false]) {
    for (const [dx, dy] of ADJACENT_DELTAS) {
      const x = storagePos.x + dx;
      const y = storagePos.y + dy;
      if (!isFreeBuildTile(room, x, y, spawn, { walkwayBuffer: useBuffer })) {
        continue;
      }
      if (room.createConstructionSite(x, y, STRUCTURE_TERMINAL) === OK) {
        return true;
      }
    }
  }
  const spot = findBuildSpotNear(room, storagePos, 3, 1, true);
  if (spot && room.createConstructionSite(spot, STRUCTURE_TERMINAL) === OK) {
    return true;
  }
  return false;
}

/** Extractor on the mineral tile (RCL6). */
export function tryPlaceExtractor(room: Room): boolean {
  const mineral = room.find(FIND_MINERALS)[0];
  if (!mineral) return false;
  const has =
    mineral.pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_EXTRACTOR) ||
    mineral.pos
      .lookFor(LOOK_CONSTRUCTION_SITES)
      .some((s) => s.structureType === STRUCTURE_EXTRACTOR);
  if (has) return false;
  return room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR) === OK;
}

/** Lab cluster near terminal (fallback: storage / spawn stamp). */
export function tryPlaceLab(room: Room, spawnPos: RoomPosition): boolean {
  const anchor =
    room.terminal?.pos ?? room.storage?.pos ?? spawnPos;
  for (const useBuffer of [true, false]) {
    for (const [dx, dy] of HUB_EXTENSION_STAMP) {
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      if (r > 4) continue;
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (
        !isFreeBuildTile(room, x, y, spawnPos, { walkwayBuffer: useBuffer })
      ) {
        continue;
      }
      if (room.createConstructionSite(x, y, STRUCTURE_LAB) === OK) return true;
    }
  }
  const spot = findBuildSpotNear(room, anchor, 5, 1, true);
  if (spot && room.createConstructionSite(spot, STRUCTURE_LAB) === OK) {
    return true;
  }
  return false;
}

/**
 * RCL6 3rd link: place beside a source that does not already have a nearby link.
 */
export function tryPlaceSourceLink(
  room: Room,
  spawnPos: RoomPosition,
): boolean {
  for (const source of room.find(FIND_SOURCES)) {
    const nearLink = source.pos
      .findInRange(FIND_MY_STRUCTURES, 2)
      .some((s) => s.structureType === STRUCTURE_LINK);
    const nearSite = source.pos
      .findInRange(FIND_CONSTRUCTION_SITES, 2)
      .some((s) => s.structureType === STRUCTURE_LINK);
    if (nearLink || nearSite) continue;
    if (tryPlaceLinkNear(room, source.pos, spawnPos)) return true;
  }
  return false;
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
