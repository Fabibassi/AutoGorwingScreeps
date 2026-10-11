import {
  constructionPriority,
  extensionQuota,
  shouldBankForBetterMiners,
  shouldBuildRoads,
  shouldBuildStorage,
  shouldBuildWalls,
  sourceContainerEnergySurplus,
  stagedExtensionBuildCap,
} from "../earlyGame";
import {
  maybeArmWalls,
  shouldPlaceHubRamparts,
} from "../earlyGame/wallArm";
import {
  parseRcl5Mode,
  shouldPlaceRcl5Links,
} from "../earlyGame/rcl5Mode";
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
import { classifyLinkRole, nextLinkSlot } from "../links/plan";
import {
  countSourceContainers,
  countStructures,
  findSourceContainerSites,
  hasControllerContainer,
  removeOrphanContainerSites,
  removeRedundantSourceContainerSites,
  sourceMissingContainer,
  sumSourceContainerEnergy,
} from "../room/queries";
import {
  clearBlockingSitesOnRoads,
  clearSpawnExitRing,
  clearStorageAccessRing,
  tryPlaceContainer,
  tryPlaceControllerLink,
  tryPlaceExtension,
  tryPlaceHubRoad,
  tryPlaceRoadOnPath,
  tryPlaceStorageLink,
  tryPlaceHubRamparts,
  tryPlaceStorageNearSpawn,
  tryPlaceTower,
} from "./placement";

function linkBuiltAndSites(room: Room): number {
  return (
    countStructures(room, STRUCTURE_LINK) +
    room
      .find(FIND_CONSTRUCTION_SITES)
      .filter((s) => s.structureType === STRUCTURE_LINK).length
  );
}

function linkSlotCoverage(room: Room): {
  hasStorageLink: boolean;
  hasControllerLink: boolean;
} {
  const storage = room.storage;
  const controller = room.controller;
  let hasStorageLink = false;
  let hasControllerLink = false;
  for (const s of room.find(FIND_MY_STRUCTURES, {
    filter: (x) => x.structureType === STRUCTURE_LINK,
  })) {
    const role = classifyLinkRole({
      linkPos: s.pos,
      storagePos: storage?.pos,
      controllerPos: controller?.pos,
    });
    if (role === "storage") hasStorageLink = true;
    if (role === "controller") hasControllerLink = true;
  }
  for (const site of room.find(FIND_CONSTRUCTION_SITES)) {
    if (site.structureType !== STRUCTURE_LINK) continue;
    const role = classifyLinkRole({
      linkPos: site.pos,
      storagePos: storage?.pos,
      controllerPos: controller?.pos,
    });
    if (role === "storage") hasStorageLink = true;
    if (role === "controller") hasControllerLink = true;
  }
  return { hasStorageLink, hasControllerLink };
}

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

  // Hub ramparts: arm (economy/raid) then place sites on spawn/storage tiles.
  maybeArmWalls(room);
  if (
    shouldPlaceHubRamparts({ wallsArmed: Boolean(Memory.ags?.wallsArmed) }) &&
    tryPlaceHubRamparts(room)
  ) {
    return;
  }

  // Before any early-return cleanup: drop ghost / orphan container sites
  // (live W21N35 @ 14,32 kept growing while spawn-exit clears returned every tick).
  if (
    removeRedundantSourceContainerSites(room) > 0 ||
    removeOrphanContainerSites(room) > 0
  ) {
    return;
  }

  // Priority 0: never seal the spawn — creeps cannot walk through structures.
  const cleared = clearSpawnExitRing(room, spawn.pos);
  if (cleared.removedSites > 0 || cleared.destroyedStructures > 0) return;
  // Priority 0b: never seal storage — filler withdraw needs ≥2 adjacent seats.
  // Live W21N35: extensions boxed storage → spawn~empty while storage~150k (T1 spiral).
  if (room.storage) {
    const storageClear = clearStorageAccessRing(room, room.storage.pos);
    if (
      storageClear.removedSites > 0 ||
      storageClear.destroyedStructures > 0
    ) {
      return;
    }
  }
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
  let minerWorkParts = 0;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name || creep.memory.role !== "miner") continue;
    minerWorkParts += creep.getActiveBodyparts(WORK);
  }
  const energyCapacityAvailable = room.energyCapacityAvailable;
  const stagedCap = stagedExtensionBuildCap({
    fullQuota: extensionQuota(rcl),
    minerWorkParts,
    sourceCount,
    rcl,
  });
  const bootstrapCap = extensionBootstrapCap(exp, rcl, extensionQuota(rcl));
  const bankForMiners = shouldBankForBetterMiners({
    energyCapacityAvailable,
    minerWorkParts,
    sourceCount,
  });
  // Cap open extension sites at the 5W gate (drop surplus / already-satisfied stage).
  const stageTarget = Math.min(stagedCap, bootstrapCap);
  if (extensionSites > 0 && extensionCount > stageTarget) {
    let excess = extensionCount - stageTarget;
    for (const site of existingSites) {
      if (excess <= 0) break;
      if (site.structureType !== STRUCTURE_EXTENSION) continue;
      site.remove();
      excess -= 1;
    }
    return;
  }
  const extCap =
    bankForMiners && extensionBuilt >= stagedCap
      ? extensionBuilt
      : stageTarget;
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

  const controllerContainer = hasControllerContainer(room);
  const hasStorage = countStructures(room, STRUCTURE_STORAGE) > 0;
  const storageSites = existingSites.filter(
    (s) => s.structureType === STRUCTURE_STORAGE,
  ).length;
  const sourceContainerEnergy = sumSourceContainerEnergy(room);
  const needStorage =
    !hasStorage &&
    shouldBuildStorage(rcl) &&
    !needSourceContainers &&
    (storageSites > 0 || sourceContainerEnergySurplus(sourceContainerEnergy));

  // At the 3-site cap: never sacrifice source-container / tower / storage sites.
  // Roads do NOT count toward this cap — when full of extensions we must still
  // place roads (live W21N35: 3 extension sites forever blocked all roads).
  let skipNonRoadPlacement = false;
  if (nonRoadSites.length >= MAX_NON_ROAD_SITES) {
    if (needSourceContainers || (needStorage && storageSites === 0)) {
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
          s.structureType !== STRUCTURE_TOWER &&
          s.structureType !== STRUCTURE_STORAGE &&
          s.structureType !== STRUCTURE_LINK,
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

  // Post-hub RCL5 link_boost: place Storage↔Controller pair (opt-in via rcl5Plan).
  if (
    !skipNonRoadPlacement &&
    hasStorage &&
    room.storage &&
    room.controller &&
    shouldPlaceRcl5Links({
      plan: Memory.ags?.rcl5Plan,
      rcl,
      extensions: extensionBuilt,
      towers: towerBuilt,
      linkCount: linkBuiltAndSites(room),
    })
  ) {
    const coverage = linkSlotCoverage(room);
    const slot = nextLinkSlot(coverage);
    if (
      slot === "storage" &&
      tryPlaceStorageLink(room, spawn.pos, room.storage.pos)
    ) {
      return;
    }
    if (
      slot === "controller" &&
      tryPlaceControllerLink(room, spawn.pos, room.controller.pos)
    ) {
      return;
    }
  }

  const placeRoads = (): boolean => {
    if (!roadSitesAllowed) return false;
    // Diamond hub first: exit ring + N/S/E/W corridors, then source/controller paths.
    if (tryPlaceHubRoad(room, spawn.pos)) return true;
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
    minerWorkParts,
    energyCapacityAvailable,
    sourceContainerEnergy,
    storageSiteOpen: storageSites > 0,
    rcl5Mode: parseRcl5Mode(Memory.ags?.rcl5Mode),
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
