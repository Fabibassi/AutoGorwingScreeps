import {
  countSourceContainers,
  findSourceContainerSites,
} from "../room/queries";
import { isDowngradeRisk } from "../selfCheck";

/** Cheap WORK+CARRY+MOVE body — bank this before remote container trips. */
export const INFRA_BUILDER_SPAWN_ENERGY = 200;

/** Remote source-container work — only when spawn has a thin buffer. */
export function shouldBuildSourceContainers(
  spawnFillPct: number,
  containersAtSources: number,
  sourceCount: number,
  opts?: { buildersShort?: boolean },
): boolean {
  if (containersAtSources >= Math.max(1, sourceCount)) return false;
  // Short on infra builders: bank a full worker body before room-crossing builds,
  // otherwise spawn stalls ~60–120 forever and the 2nd builder never appears.
  if (opts?.buildersShort) {
    return spawnFillPct >= INFRA_BUILDER_SPAWN_ENERGY / 300;
  }
  // Thin spawn buffer (~60/300): walk to a distant site instead of the spawn trip.
  return spawnFillPct >= 0.2;
}

/** Prefer filling spawn to a worker body while infra builders are short. */
export function needsSpawnBankForInfraBuilder(
  spawnEnergy: number,
  builderCount: number,
  wantBuilders = 2,
): boolean {
  if (builderCount >= wantBuilders) return false;
  return spawnEnergy < INFRA_BUILDER_SPAWN_ENERGY;
}

function closestSourceContainerSite(
  creep: Creep,
  sites: ConstructionSite[],
): ConstructionSite | null {
  if (sites.length === 0) return null;
  return (
    creep.pos.findClosestByPath(sites) ??
    creep.pos.findClosestByRange(sites) ??
    null
  );
}

/** Spend carried energy on a source-container site within range 3. */
function buildLocalSourceContainerSite(creep: Creep): boolean {
  const local = findSourceContainerSites(creep.room).filter(
    (s) => creep.pos.getRangeTo(s) <= 3,
  );
  const site = closestSourceContainerSite(creep, local);
  if (!site) return false;
  if (creep.build(site) === ERR_NOT_IN_RANGE) {
    creep.moveTo(site, { visualizePathStyle: { stroke: "#ffffff" } });
  }
  return true;
}

/** Path to any remaining source-container site (may cross the room). */
function buildRemoteSourceContainerSite(creep: Creep): boolean {
  const site = closestSourceContainerSite(
    creep,
    findSourceContainerSites(creep.room),
  );
  if (!site) return false;
  if (creep.build(site) === ERR_NOT_IN_RANGE) {
    creep.moveTo(site, { visualizePathStyle: { stroke: "#ffffff" } });
  }
  return true;
}

function countBuildersInRoom(roomName: string): number {
  let n = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.room.name === roomName && c.memory.role === "builder") n++;
  }
  return n;
}

function countUpgradersInRoom(roomName: string): number {
  let n = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.room.name === roomName && c.memory.role === "upgrader") n++;
  }
  return n;
}

function upgradeController(creep: Creep, controller: StructureController): void {
  if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller);
  }
}

/** Spawn first, then hungry extensions — keeps energyAvailable alive after wipes. */
export function findHarvesterDeliveryTarget(
  creep: Creep,
  spawn: StructureSpawn | undefined,
): StructureSpawn | StructureExtension | null {
  if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    return spawn;
  }
  const hungry = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureExtension =>
      s.structureType === STRUCTURE_EXTENSION &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (hungry.length === 0) return null;
  return (
    creep.pos.findClosestByPath(hungry) ??
    creep.pos.findClosestByRange(hungry) ??
    null
  );
}

export function runHarvester(creep: Creep): number {
  let harvested = 0;
  const capacity = creep.store.getCapacity(RESOURCE_ENERGY) ?? 0;
  const sources = creep.room.find(FIND_SOURCES).length;
  const atSources = countSourceContainers(creep.room);
  const missingSourceContainers = atSources < Math.max(1, sources);
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  const spawnEnergy = spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  const buildersShort = needsSpawnBankForInfraBuilder(
    spawnEnergy,
    countBuildersInRoom(creep.room.name),
  );

  // WORK+MOVE bootstrap (legacy): drop-mine so a hauler can scoop.
  if (capacity === 0) {
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (!source) return 0;
    const code = creep.harvest(source);
    if (code === OK) {
      const work = creep.getActiveBodyparts(WORK);
      harvested = work * 2;
    } else if (code === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
    return harvested;
  }

  // Spend any carried energy on an adjacent source-container site.
  // Waiting for a full store left creeps stuck harvesting at ~45/50 forever.
  // Skip while spawn still needs a worker body for the 2nd infra builder.
  if (
    missingSourceContainers &&
    !buildersShort &&
    creep.store[RESOURCE_ENERGY] > 0 &&
    buildLocalSourceContainerSite(creep)
  ) {
    return 0;
  }

  if (creep.store.getFreeCapacity() > 0) {
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (!source) return 0;
    const code = creep.harvest(source);
    if (code === OK) {
      const work = creep.getActiveBodyparts(WORK);
      harvested = work * 2; // HARVEST_POWER
    } else if (code === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
    return harvested;
  }

  const controller = creep.room.controller;
  const upgraderCount = countUpgradersInRoom(creep.room.name);
  const controllerUrgent =
    controller != null &&
    isDowngradeRisk(controller.level, controller.ticksToDowngrade, upgraderCount);

  // Feed spawn + extensions before remote builds/upgrade. After a wipe we often
  // still have many empty extensions; spending CARRY on containers/controller
  // while energyAvailable sits at ~300 soft-locks fat spawn bodies forever.
  // Exception: critical downgrade timer beats extension top-ups.
  const delivery = findHarvesterDeliveryTarget(creep, spawn);
  if (delivery) {
    // Keep feeding an empty spawn; otherwise refresh a critical controller first.
    if (controllerUrgent && controller && delivery !== spawn) {
      upgradeController(creep, controller);
      return 0;
    }
    if (creep.transfer(delivery, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(delivery);
    }
    return 0;
  }

  if (controllerUrgent && controller) {
    upgradeController(creep, controller);
    return 0;
  }

  const capacitySpawn = spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 1;
  const fill = spawnEnergy / capacitySpawn;
  const preferRemoteBuild = shouldBuildSourceContainers(
    fill,
    atSources,
    sources,
    { buildersShort },
  );

  if (preferRemoteBuild && buildRemoteSourceContainerSite(creep)) {
    return 0;
  }

  // Spawn + extensions saturated: finish remaining source containers before upgrading.
  if (missingSourceContainers && buildRemoteSourceContainerSite(creep)) {
    return 0;
  }

  if (controller) {
    upgradeController(creep, controller);
  }
  return 0;
}
