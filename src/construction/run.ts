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
  clearBlockingSitesOnRoads,
  clearSpawnExitRing,
  tryPlaceContainer,
  tryPlaceExtension,
  tryPlaceRoadOnPath,
  tryPlaceStorageNearSpawn,
  tryPlaceTower,
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

  // Priority 0: never seal the spawn — creeps cannot walk through structures.
  const cleared = clearSpawnExitRing(room, spawn.pos);
  if (cleared.removedSites > 0 || cleared.destroyedStructures > 0) return;
  // Extensions on roads plug the hub corridors (live W21N35 south exit).
  if (clearBlockingSitesOnRoads(room) > 0) return;

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
  // Only starve roads during RCL2 extension bootstrap. At RCL3+ unfinished
  // extensions must not permanently block source roads (live W21N35 symptom).
  const roadsBlockedByExtensionPush = rcl < 3 && needExtensions;

  if (roadsBlockedByExtensionPush) {
    const roads = existingSites.filter((s) => s.structureType === STRUCTURE_ROAD);
    if (roads.length > 0) {
      for (const road of roads) road.remove();
      return;
    }
  }

  // Drop controller/other container sites until every source container is done
  // (unless experiment explicitly allows early controller containers).
  if (
    needSourceContainers &&
    !allowControllerContainer(exp, rcl, needSourceContainers ? 1 : 0)
  ) {
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

  // At the 3-site cap: never sacrifice source-container / tower sites.
  // Roads do NOT count toward this cap — when full of extensions we must still
  // place roads (live W21N35: 3 extension sites forever blocked all roads).
  let skipNonRoadPlacement = false;
  if (nonRoadSites.length >= MAX_NON_ROAD_SITES) {
    if (needSourceContainers) {
      const extensionSite = nonRoadSites.find(
        (s) => s.structureType === STRUCTURE_EXTENSION,
      );
      if (extensionSite) {
        extensionSite.remove();
        return;
      }
      skipNonRoadPlacement = true;
    } else if (needExtensions) {
      const sacrificial = nonRoadSites.find(
        (s) =>
          s.structureType !== STRUCTURE_EXTENSION &&
          s.structureType !== STRUCTURE_CONTAINER &&
          s.structureType !== STRUCTURE_TOWER,
      );
      if (sacrificial) {
        sacrificial.remove();
        return;
      }
      skipNonRoadPlacement = true;
    } else {
      skipNonRoadPlacement = true;
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
    !roadsBlockedByExtensionPush &&
    canPlaceMoreRoads &&
    shouldBuildRoads(rcl, spawnEnergy, containersBlockRoads, {
      minRcl: roadMinRcl(policy),
      minSpawnEnergy: minEnergyForRoads(exp),
    });
  const towerBuilt = countStructures(room, STRUCTURE_TOWER);
  const towerSites = existingSites.filter((s) => s.structureType === STRUCTURE_TOWER)
    .length;
  const towerCount = towerBuilt + towerSites;

  const placeRoads = (): boolean => {
    if (!roadSitesAllowed) return false;
    if (preferSourceRoads(policy)) {
      if (tryPlaceSourceRoads(room, spawn)) return true;
      if (tryPlaceControllerRoad(room, spawn)) return true;
    } else {
      if (tryPlaceControllerRoad(room, spawn)) return true;
      if (tryPlaceSourceRoads(room, spawn)) return true;
    }
    return false;
  };

  // Early / parallel: push at least one source-path road even mid-container-build.
  if (
    roadSitesAllowed &&
    roadsWhileContainersMissing(policy) &&
    roadCount + roadSites < 1
  ) {
    if (placeRoads()) return;
  }

  // Baseline: guarantee one road after source containers (even at non-road site cap).
  if (
    !needSourceContainers &&
    roadSitesAllowed &&
    roadCount + roadSites < 1
  ) {
    if (placeRoads()) return;
  }

  // Non-road cap full: still keep laying roads up to MAX_ROAD_SITES.
  if (skipNonRoadPlacement) {
    if (placeRoads()) return;
    return;
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
    towerCount,
    experiment: exp,
  });

  for (const structureType of queue) {
    if (structureType === STRUCTURE_TOWER) {
      if (tryPlaceTower(room, spawn.pos)) return;
      continue;
    }

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
      if (placeRoads()) return;
    }
  }

  // Explicitly skip walls/ramparts in early game even if damaged.
  if (shouldBuildWalls(rcl)) {
    return;
  }
}
