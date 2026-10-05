import {
  constructionPriority,
  extensionQuota,
  shouldBuildRoads,
  shouldBuildWalls,
} from "../earlyGame";
import {
  countSourceContainers,
  countStructures,
  findSourceContainerSites,
  hasControllerContainer,
  sourceMissingContainer,
} from "../room/queries";
import {
  findAdjacentSpot,
  tryPlaceContainer,
  tryPlaceExtension,
  tryPlaceRoadOnPath,
  tryPlaceStorageNearSpawn,
} from "./placement";

const MAX_NON_ROAD_SITES = 3;

export function runConstruction(room: Room): void {
  const rcl = room.controller?.level ?? 1;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn || !room.controller?.my) return;

  const existingSites = room.find(FIND_CONSTRUCTION_SITES);
  const nonRoadSites = existingSites.filter((s) => s.structureType !== STRUCTURE_ROAD);
  const sourceCount = room.find(FIND_SOURCES).length;
  // Finished only — sites must not count as "done" or we delete them for extensions.
  const finishedSourceContainers = countSourceContainers(room);
  const sourceContainersAndSites = countSourceContainers(room, {
    includeSites: true,
  });
  const needSourceContainers = finishedSourceContainers < sourceCount;
  const extensionBuilt = countStructures(room, STRUCTURE_EXTENSION);
  const extensionSites = existingSites.filter(
    (s) => s.structureType === STRUCTURE_EXTENSION,
  ).length;
  const extensionCount = extensionBuilt + extensionSites;
  const needExtensions = extensionCount < extensionQuota(rcl);

  // Drop controller/other container sites until every source container is done.
  if (needSourceContainers) {
    const sourceSites = new Set(findSourceContainerSites(room).map((s) => s.id));
    const stray = nonRoadSites.find(
      (s) =>
        s.structureType === STRUCTURE_CONTAINER && !sourceSites.has(s.id),
    );
    if (stray) {
      stray.remove();
      return;
    }
  }

  // At the 3-site cap: never sacrifice source-container sites.
  if (nonRoadSites.length >= MAX_NON_ROAD_SITES) {
    if (needSourceContainers) {
      const extensionSite = nonRoadSites.find(
        (s) => s.structureType === STRUCTURE_EXTENSION,
      );
      if (extensionSite) extensionSite.remove();
      else return;
    } else if (needExtensions) {
      const sacrificial = nonRoadSites.find(
        (s) =>
          s.structureType !== STRUCTURE_EXTENSION &&
          s.structureType !== STRUCTURE_CONTAINER,
      );
      if (sacrificial) sacrificial.remove();
      else return;
    } else {
      return;
    }
  }
  const controllerContainer = hasControllerContainer(room);
  const hasStorage = countStructures(room, STRUCTURE_STORAGE) > 0;
  const spawnEnergy = spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  const roadSitesAllowed = shouldBuildRoads(
    rcl,
    spawnEnergy,
    nonRoadSites.length > 0 || needSourceContainers || needExtensions,
  );

  const queue = constructionPriority(rcl, {
    // Include sites so we do not place a 3rd duplicate container site.
    sourceContainerCount: sourceContainersAndSites,
    sourceCount,
    hasControllerContainer: controllerContainer,
    hasStorage,
    roadSitesAllowed,
    // Do not queue extensions until source containers are finished.
    extensionCount: needSourceContainers
      ? extensionQuota(rcl)
      : extensionCount,
  });

  for (const structureType of queue) {
    if (structureType === STRUCTURE_EXTENSION) {
      if (tryPlaceExtension(room, spawn.pos)) return;
      continue;
    }

    if (structureType === STRUCTURE_CONTAINER) {
      const source = sourceMissingContainer(room);
      if (source && tryPlaceContainer(room, source.pos)) return;
      if (
        !needSourceContainers &&
        !controllerContainer &&
        room.controller
      ) {
        if (tryPlaceContainer(room, room.controller.pos)) return;
      }
      continue;
    }

    if (structureType === STRUCTURE_STORAGE && room.controller) {
      if (tryPlaceStorageNearSpawn(room, spawn.pos)) return;
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
