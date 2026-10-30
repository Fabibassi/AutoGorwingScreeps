import {
  constructionPriority,
  extensionQuota,
  linkQuota,
  shouldBankForBetterMiners,
  shouldBuildExtractor,
  shouldBuildRoads,
  shouldBuildStorage,
  shouldBuildSecondSpawn,
  shouldBuildTerminal,
  shouldBuildWalls,
  spawnQuota,
  sourceContainerEnergySurplus,
  stagedExtensionBuildCap,
  towerQuota,
} from "../earlyGame";
import {
  nextRcl7HitStructure,
  parseRcl7BuildOrder,
} from "../earlyGame/rcl7Hit";
import {
  hubRampartSitesOpen,
  hubRampartsPresent,
  hubRampartsReady,
  maybeArmWalls,
  shouldPlaceHubRamparts,
  shouldPlaceWallRing,
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
  tryPlaceExtractor,
  tryPlaceSecondSpawn,
  tryPlaceSourceLink,
  tryPlaceStorageNearSpawn,
  tryPlaceTerminalNearStorage,
  tryPlaceTower,
  tryPlaceWallRing,
  tryPlaceLab,
} from "./placement";
import { shouldPlaceLabs } from "../earlyGame/nextLeaps";
import { terminalMineralTypes } from "../market/run";

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

  // Hub ramparts: arm, place missing sites, hold other CAPEX until structures exist.
  // (1-HP is enough to unblock; towers push hits. Wall ring waits for ready hits.)
  maybeArmWalls(room);
  if (shouldPlaceHubRamparts({ wallsArmed: Boolean(Memory.ags?.wallsArmed) })) {
    tryPlaceHubRamparts(room);
    if (!hubRampartsPresent(room)) {
      return;
    }
  }

  // Before any early-return cleanup: drop ghost / orphan container sites
  // (live home @ 14,32 kept growing while spawn-exit clears returned every tick).
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
  // live home: extensions boxed storage → spawn~empty while storage~150k (T1 spiral).
  if (room.storage) {
    const storageClear = clearStorageAccessRing(room, room.storage.pos);
    if (
      storageClear.removedSites > 0 ||
      storageClear.destroyedStructures > 0
    ) {
      return;
    }
  }
  // Extensions on roads plug the hub corridors (live home south exit).
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
  // extensions must not permanently block source roads (live home symptom).
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
  // place roads (live home: 3 extension sites forever blocked all roads).
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

  // RCL6: 3rd link (source), then terminal, then extractor. Labs later.
  if (!skipNonRoadPlacement && hasStorage && room.storage) {
    const linksNow = linkBuiltAndSites(room);
    if (
      linksNow >= 2 &&
      linksNow < linkQuota(rcl) &&
      tryPlaceSourceLink(room, spawn.pos)
    ) {
      return;
    }
    if (shouldBuildTerminal(rcl)) {
      const hasTerminal =
        countStructures(room, STRUCTURE_TERMINAL) > 0 ||
        existingSites.some((s) => s.structureType === STRUCTURE_TERMINAL);
      if (
        !hasTerminal &&
        tryPlaceTerminalNearStorage(room, room.storage.pos, spawn.pos)
      ) {
        return;
      }
    }
    if (shouldBuildExtractor(rcl) && tryPlaceExtractor(room)) {
      return;
    }
  }

  // RCL7 hit order (ext_first default; sim: tower_first | spawn_first).
  if (!skipNonRoadPlacement && rcl >= 7) {
    const spawnBuilt = countStructures(room, STRUCTURE_SPAWN);
    const spawnSites = existingSites.filter(
      (s) => s.structureType === STRUCTURE_SPAWN,
    ).length;
    const next = nextRcl7HitStructure({
      order: parseRcl7BuildOrder(Memory.ags?.rcl7BuildOrder),
      extensions: extensionCount,
      extensionQuota: extensionQuota(rcl),
      towers: towerCount,
      towerQuota: towerQuota(rcl),
      spawns: spawnBuilt + spawnSites,
      spawnQuota: spawnQuota(rcl),
      links: linkBuiltAndSites(room),
      linkQuota: linkQuota(rcl),
    });
    if (next === STRUCTURE_EXTENSION && tryPlaceExtension(room, spawn.pos)) {
      return;
    }
    if (next === STRUCTURE_TOWER && tryPlaceTower(room, spawn.pos)) {
      return;
    }
    if (
      next === STRUCTURE_SPAWN &&
      shouldBuildSecondSpawn(rcl) &&
      tryPlaceSecondSpawn(room, spawn.pos)
    ) {
      return;
    }
    if (
      next === STRUCTURE_LINK &&
      room.storage &&
      tryPlaceSourceLink(room, spawn.pos)
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

  // Labs after RCL7 hit + mineral in terminal (Wave E — no factory-first).
  if (!skipNonRoadPlacement && room.terminal) {
    const labBuilt = countStructures(room, STRUCTURE_LAB);
    const labSites = existingSites.filter(
      (s) => s.structureType === STRUCTURE_LAB,
    ).length;
    const mineralAmt = terminalMineralTypes(room.terminal.store).reduce(
      (sum, r) => sum + (room.terminal!.store[r] ?? 0),
      0,
    );
    if (
      shouldPlaceLabs({
        rcl,
        extensions: extensionBuilt,
        extensionQuota: extensionQuota(rcl),
        towers: towerBuilt,
        towerQuota: towerQuota(rcl),
        spawns: countStructures(room, STRUCTURE_SPAWN),
        spawnQuota: spawnQuota(rcl),
        terminalMineral: mineralAmt,
        labs: labBuilt + labSites,
      }) &&
      tryPlaceLab(room, spawn.pos)
    ) {
      return;
    }
  }

  // Wall ring after hub shell is at ready hits (Wave C). Sites are free.
  if (
    !skipNonRoadPlacement &&
    shouldBuildWalls(rcl) &&
    Boolean(Memory.ags?.wallsArmed) &&
    shouldPlaceWallRing({
      hubRampartsReady: hubRampartsReady(room),
      storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0,
      rcl,
    }) &&
    tryPlaceWallRing(room, spawn.pos)
  ) {
    return;
  }

  // Still placing hub rampart sites? Prefer those over roads spam.
  if (
    Boolean(Memory.ags?.wallsArmed) &&
    hubRampartSitesOpen(room) > 0 &&
    !hubRampartsPresent(room)
  ) {
    return;
  }
}
