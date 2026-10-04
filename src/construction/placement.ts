function isBuildableTerrain(room: Room, x: number, y: number): boolean {
  const terrain = Game.map.getRoomTerrain(room.name);
  const t = terrain.get(x, y);
  return t !== TERRAIN_MASK_WALL;
}

function isFreeBuildTile(room: Room, x: number, y: number): boolean {
  if (x < 1 || x > 48 || y < 1 || y > 48) return false;
  if (!isBuildableTerrain(room, x, y)) return false;
  const pos = new RoomPosition(x, y, room.name);
  const blocking = pos.lookFor(LOOK_STRUCTURES).some((s) => {
    const type = (s as Structure).structureType;
    return type !== STRUCTURE_ROAD && type !== STRUCTURE_CONTAINER;
  });
  if (blocking) return false;
  return pos.lookFor(LOOK_CONSTRUCTION_SITES).length === 0;
}

export function findAdjacentSpot(room: Room, anchor: RoomPosition): RoomPosition | null {
  const deltas = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [dx, dy] of deltas) {
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    if (!isFreeBuildTile(room, x, y)) continue;
    return new RoomPosition(x, y, room.name);
  }
  return null;
}

/** Expanding ring around spawn for extensions (range 1..maxRange). */
export function findBuildSpotNear(
  room: Room,
  anchor: RoomPosition,
  maxRange = 4,
): RoomPosition | null {
  for (let range = 1; range <= maxRange; range++) {
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
  const spot = findBuildSpotNear(room, spawnPos, 4);
  if (!spot) return false;
  return room.createConstructionSite(spot, STRUCTURE_EXTENSION) === OK;
}

export function tryPlaceContainer(room: Room, anchor: RoomPosition): boolean {
  const spot = findAdjacentSpot(room, anchor);
  if (!spot) return false;
  return room.createConstructionSite(spot, STRUCTURE_CONTAINER) === OK;
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
      .some(
        (s) =>
          s.structureType !== STRUCTURE_ROAD &&
          s.structureType !== STRUCTURE_CONTAINER,
      );
    if (blocked) continue;
    if (room.createConstructionSite(pos, STRUCTURE_ROAD) === OK) {
      return true;
    }
  }
  return false;
}
