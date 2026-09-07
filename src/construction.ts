import {
  constructionPriority,
  shouldBuildRoads,
  shouldBuildWalls,
} from "./earlyGame";

function isBuildableTerrain(room: Room, x: number, y: number): boolean {
  const terrain = Game.map.getRoomTerrain(room.name);
  const t = terrain.get(x, y);
  return t !== TERRAIN_MASK_WALL;
}

function findAdjacentSpot(room: Room, anchor: RoomPosition): RoomPosition | null {
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

function countStructures(room: Room, type: StructureConstant): number {
  return room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === type })
    .length;
}

function hasControllerContainer(room: Room): boolean {
  const controller = room.controller;
  if (!controller) return false;
  const near = controller.pos.findInRange(FIND_STRUCTURES, 2, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  });
  return near.length > 0;
}

function countSourceContainers(room: Room): number {
  const sources = room.find(FIND_SOURCES);
  let count = 0;
  for (const source of sources) {
    const near = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    const sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    if (near.length > 0 || sites.length > 0) count++;
  }
  return count;
}

function sourceMissingContainer(room: Room): Source | null {
  for (const source of room.find(FIND_SOURCES)) {
    const has =
      source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }).length > 0 ||
      source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }).length > 0;
    if (!has) return source;
  }
  return null;
}

function tryPlaceContainer(room: Room, anchor: RoomPosition): boolean {
  const spot = findAdjacentSpot(room, anchor);
  if (!spot) return false;
  return room.createConstructionSite(spot, STRUCTURE_CONTAINER) === OK;
}

function tryPlaceRoadOnPath(
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

export function runConstruction(room: Room): void {
  const rcl = room.controller?.level ?? 1;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn || !room.controller?.my) return;

  const existingSites = room.find(FIND_CONSTRUCTION_SITES);
  const nonRoadSites = existingSites.filter((s) => s.structureType !== STRUCTURE_ROAD);
  if (nonRoadSites.length >= 3) return;

  const sourceCount = room.find(FIND_SOURCES).length;
  const sourceContainerCount = countSourceContainers(room);
  const controllerContainer = hasControllerContainer(room);
  const hasStorage = countStructures(room, STRUCTURE_STORAGE) > 0;
  const spawnEnergy = spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  const roadSitesAllowed = shouldBuildRoads(
    rcl,
    spawnEnergy,
    nonRoadSites.length > 0,
  );

  const queue = constructionPriority(rcl, {
    sourceContainerCount,
    sourceCount,
    hasControllerContainer: controllerContainer,
    hasStorage,
    roadSitesAllowed,
  });

  for (const structureType of queue) {
    if (structureType === STRUCTURE_CONTAINER) {
      const source = sourceMissingContainer(room);
      if (source && tryPlaceContainer(room, source.pos)) return;
      if (!controllerContainer && room.controller) {
        if (tryPlaceContainer(room, room.controller.pos)) return;
      }
      continue;
    }

    if (structureType === STRUCTURE_STORAGE && room.controller) {
      const spot = findAdjacentSpot(room, spawn.pos);
      if (spot && room.createConstructionSite(spot, STRUCTURE_STORAGE) === OK) {
        return;
      }
      continue;
    }

    if (structureType === STRUCTURE_ROAD) {
      const controller = room.controller;
      if (controller && tryPlaceRoadOnPath(room, spawn.pos, controller.pos)) {
        return;
      }
      const source = room.find(FIND_SOURCES)[0];
      if (source && tryPlaceRoadOnPath(room, spawn.pos, source.pos)) {
        return;
      }
    }
  }

  // Explicitly skip walls/ramparts in early game even if damaged.
  if (shouldBuildWalls(rcl)) {
    return;
  }
}
