function isBuildableTerrain(room: Room, x: number, y: number): boolean {
  const terrain = Game.map.getRoomTerrain(room.name);
  const t = terrain.get(x, y);
  return t !== TERRAIN_MASK_WALL;
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
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    if (!isBuildableTerrain(room, x, y)) continue;
    const pos = new RoomPosition(x, y, room.name);
    const blocking = pos.lookFor(LOOK_STRUCTURES).some((s) => {
      const type = (s as Structure).structureType;
      return type !== STRUCTURE_ROAD && type !== STRUCTURE_CONTAINER;
    });
    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    if (blocking || sites.length > 0) continue;
    return pos;
  }
  return null;
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
