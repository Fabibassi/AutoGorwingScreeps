import {
  countSourceContainers,
  findSourceContainerSites,
} from "../room/queries";

/** Remote source-container work — only when spawn has a thin buffer. */
export function shouldBuildSourceContainers(
  spawnFillPct: number,
  containersAtSources: number,
  sourceCount: number,
): boolean {
  if (containersAtSources >= Math.max(1, sourceCount)) return false;
  // Thin spawn buffer (~60/300): walk to a distant site instead of the spawn trip.
  return spawnFillPct >= 0.2;
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

export function runHarvester(creep: Creep): number {
  let harvested = 0;
  const capacity = creep.store.getCapacity(RESOURCE_ENERGY) ?? 0;

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

  const sources = creep.room.find(FIND_SOURCES).length;
  const atSources = countSourceContainers(creep.room);
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  const capacitySpawn = spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 1;
  const fill =
    (spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) / capacitySpawn;
  const preferRemoteBuild = shouldBuildSourceContainers(fill, atSources, sources);

  // Always finish a local source-container site before any spawn trip.
  // Walking away at ~20% fill was stalling sites near 0–200/5000.
  if (atSources < sources && buildLocalSourceContainerSite(creep)) {
    return 0;
  }

  if (preferRemoteBuild && buildRemoteSourceContainerSite(creep)) {
    return 0;
  }

  if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawn);
    }
    return 0;
  }

  // Spawn full: finish remaining source containers before upgrading.
  if (atSources < sources && buildRemoteSourceContainerSite(creep)) {
    return 0;
  }

  const controller = creep.room.controller;
  if (controller) {
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller);
    }
  }
  return 0;
}
