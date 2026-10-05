import {
  constructionPriority,
  extensionQuota,
  shouldBuildRoads,
  shouldBuildWalls,
} from "../earlyGame";
import {
  allowControllerContainer,
  extensionBootstrapCap,
  minEnergyForRoads,
  resolveExperiment,
} from "../earlyGame/experimentPolicy";
import {
  parseRoadPolicy,
  preferSourceRoads,
  roadMinRcl,
  roadsBlockedByContainers,
  roadsWhileContainersMissing,
} from "../earlyGame/roadPolicy";
import {
  countSourceContainers,
  countStructures,
  findSourceContainerSites,
  hasControllerContainer,
  sourceMissingContainer,
} from "../room/queries";
import {
  tryPlaceContainer,
  tryPlaceExtension,
  tryPlaceRoadOnPath,
  tryPlaceStorageNearSpawn,
} from "./placement";

const MAX_NON_ROAD_SITES = 3;

function tryPlaceSourceRoads(room: Room, spawn: StructureSpawn): boolean {
  const controller = room.controller;
  const sources = room.find(FIND_SOURCES);
  for (const source of sources) {
    if (tryPlaceRoadOnPath(room, spawn.pos, source.pos)) return true;
    if (controller && tryPlaceRoadOnPath(room, controller.pos, source.pos)) {
      return true;
    }
  }
  return false;
}

function tryPlaceControllerRoad(room: Room, spawn: StructureSpawn): boolean {
  const controller = room.controller;
  if (!controller) return false;
  return tryPlaceRoadOnPath(room, spawn.pos, controller.pos);
}

export function runConstruction(room: Room): void {
  const rcl = room.controller?.level ?? 1;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn || !room.controller?.my) return;

  const policy = parseRoadPolicy(Memory.ags?.roadPolicy);
  const exp = resolveExperiment(Memory.ags);
  const existingSites = room.find(FIND_CONSTRUCTION_SITES);
  const nonRoadSites = existingSites.filter((s) => s.structureType !== STRUCTURE_ROAD);
  const sourceCount = room.find(FIND_SOURCES).length;
  // Finished only — sites must not count as "done" or we delete them for extensions.
  const finishedSourceContainers = countSourceContainers(room);
  const sourceContainersAndSites = countSourceContainers(room, {
    includeSites: true,
  });
  const sourceContainerSites = findSourceContainerSites(room).length;
  const needSourceContainers = finishedSourceContainers < sourceCount;
  const extensionBuilt = countStructures(room, STRUCTURE_EXTENSION);
  const extensionSites = existingSites.filter(
    (s) => s.structureType === STRUCTURE_EXTENSION,
  ).length;
  const extensionCount = extensionBuilt + extensionSites;
  const extCap = extensionBootstrapCap(exp, rcl, extensionQuota(rcl));
  const needExtensions = extensionCount < extCap;

  // Extensions starve when dozens of road sites dilute builders — remove roads first.
  if (needExtensions) {
    const roadSite = existingSites.find((s) => s.structureType === STRUCTURE_ROAD);
    if (roadSite) {
      roadSite.remove();
      return;
    }
  }

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
  const roadCount = countStructures(room, STRUCTURE_ROAD);
  const roadSites = existingSites.filter((s) => s.structureType === STRUCTURE_ROAD)
    .length;
  /** Cap unfinished road sites so parallel policies cannot flood the room. */
  const MAX_ROAD_SITES = 3;
  const canPlaceMoreRoads = roadSites < MAX_ROAD_SITES;
  const containersBlockRoads =
    roadsBlockedByContainers(policy) && needSourceContainers;
  const roadSitesAllowed =
    !needExtensions &&
    canPlaceMoreRoads &&
    shouldBuildRoads(rcl, spawnEnergy, containersBlockRoads, {
      minRcl: roadMinRcl(policy),
      minSpawnEnergy: minEnergyForRoads(exp),
    });

  // Early / parallel: push at least one source-path road even mid-container-build.
  if (
    roadSitesAllowed &&
    roadsWhileContainersMissing(policy) &&
    roadCount + roadSites < 1
  ) {
    if (preferSourceRoads(policy)) {
      if (tryPlaceSourceRoads(room, spawn)) return;
      if (tryPlaceControllerRoad(room, spawn)) return;
    } else if (tryPlaceControllerRoad(room, spawn)) {
      return;
    }
  }

  // Baseline: guarantee one road after source containers.
  if (
    !needSourceContainers &&
    roadSitesAllowed &&
    roadCount + roadSites < 1
  ) {
    if (preferSourceRoads(policy)) {
      if (tryPlaceSourceRoads(room, spawn)) return;
      if (tryPlaceControllerRoad(room, spawn)) return;
    } else {
      if (tryPlaceControllerRoad(room, spawn)) return;
      if (tryPlaceSourceRoads(room, spawn)) return;
    }
  }

  const queue = constructionPriority(rcl, {
    // Include sites so we do not place a 3rd duplicate container site.
    sourceContainerCount: sourceContainersAndSites,
    sourceCount,
    hasControllerContainer: controllerContainer,
    hasStorage,
    roadSitesAllowed,
    // Do not queue extensions until source containers are finished (unless later-mode).
    extensionCount:
      needSourceContainers && exp.containerTiming !== "later"
        ? extCap
        : extensionCount,
    extensionBuilt,
    sourceContainerSites,
    experiment: exp,
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
        allowControllerContainer(exp, rcl, needSourceContainers ? 1 : 0) &&
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
      if (preferSourceRoads(policy)) {
        if (tryPlaceSourceRoads(room, spawn)) return;
        if (tryPlaceControllerRoad(room, spawn)) return;
      } else {
        if (tryPlaceControllerRoad(room, spawn)) return;
        if (tryPlaceSourceRoads(room, spawn)) return;
      }
    }
  }

  // Explicitly skip walls/ramparts in early game even if damaged.
  if (shouldBuildWalls(rcl)) {
    return;
  }
}
