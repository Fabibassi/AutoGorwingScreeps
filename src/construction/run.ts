import {
  constructionPriority,
  shouldBuildRoads,
  shouldBuildWalls,
} from "../earlyGame";
import {
  countSourceContainers,
  countStructures,
  hasControllerContainer,
  sourceMissingContainer,
} from "../room/queries";
import { findAdjacentSpot, tryPlaceContainer, tryPlaceRoadOnPath } from "./placement";

export function runConstruction(room: Room): void {
  const rcl = room.controller?.level ?? 1;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn || !room.controller?.my) return;

  const existingSites = room.find(FIND_CONSTRUCTION_SITES);
  const nonRoadSites = existingSites.filter((s) => s.structureType !== STRUCTURE_ROAD);
  if (nonRoadSites.length >= 3) return;

  const sourceCount = room.find(FIND_SOURCES).length;
  const sourceContainerCount = countSourceContainers(room, { includeSites: true });
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
