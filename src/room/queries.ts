import type { CreepQuotas } from "../earlyGame";

export function countCreepsByRole(): CreepQuotas {
  const counts: CreepQuotas = {
    harvester: 0,
    miner: 0,
    hauler: 0,
    upgrader: 0,
    builder: 0,
  };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role as keyof CreepQuotas | undefined;
    if (role && role in counts) counts[role]++;
  }
  return counts;
}

export function countSourceContainers(
  room: Room,
  opts: { includeSites?: boolean } = {},
): number {
  const includeSites = opts.includeSites ?? false;
  let count = 0;
  for (const source of room.find(FIND_SOURCES)) {
    const hasStructure =
      source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }).length > 0;
    if (hasStructure) {
      count++;
      continue;
    }
    if (includeSites) {
      const hasSite =
        source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
          filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        }).length > 0;
      if (hasSite) count++;
    }
  }
  return count;
}

export function hasControllerContainer(room: Room): boolean {
  const controller = room.controller;
  if (!controller) return false;
  const near = controller.pos.findInRange(FIND_STRUCTURES, 2, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  });
  return near.length > 0;
}

export function sourceMissingContainer(room: Room): Source | null {
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

/** Sources that already have a finished adjacent container (ready for static miners). */
export function findSourcesWithContainers(room: Room): Source[] {
  return room.find(FIND_SOURCES).filter(
    (source) =>
      source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }).length > 0,
  );
}

/** Container construction sites adjacent to a source (not controller/storage). */
export function findSourceContainerSites(room: Room): ConstructionSite[] {
  const sites: ConstructionSite[] = [];
  const seen = new Set<Id<ConstructionSite>>();
  for (const source of room.find(FIND_SOURCES)) {
    for (const site of source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    })) {
      if (seen.has(site.id)) continue;
      seen.add(site.id);
      sites.push(site);
    }
  }
  return sites;
}

export function countStructures(room: Room, type: StructureConstant): number {
  return room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === type })
    .length;
}
