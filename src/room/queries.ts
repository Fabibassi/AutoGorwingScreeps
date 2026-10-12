import type { CreepQuotas } from "../earlyGame";

const KNOWN_ROLES: Array<keyof CreepQuotas> = [
  "harvester",
  "miner",
  "hauler",
  "upgrader",
  "builder",
  "filler",
];

const REMOTE_ROLES = ["remoteMiner", "remoteHauler", "reserver"] as const;

/** Spawn names are `{role}-{tick}-…`; restore role when Memory.creeps lost it. */
export function healCreepRoleFromName(creep: Creep): boolean {
  const current = creep.memory.role as string | undefined;
  if (current && (KNOWN_ROLES as string[]).includes(current)) return false;
  if (current && (REMOTE_ROLES as readonly string[]).includes(current)) {
    return false;
  }
  const prefix = creep.name.split("-")[0];
  if ((REMOTE_ROLES as readonly string[]).includes(prefix)) {
    creep.memory.role = prefix;
    return true;
  }
  if (!(KNOWN_ROLES as string[]).includes(prefix)) return false;
  creep.memory.role = prefix as keyof CreepQuotas;
  return true;
}

export function healCreepRoles(): void {
  for (const name in Game.creeps) {
    healCreepRoleFromName(Game.creeps[name]);
  }
}

export function countCreepsByRole(): CreepQuotas {
  const counts: CreepQuotas = {
    harvester: 0,
    miner: 0,
    hauler: 0,
    upgrader: 0,
    builder: 0,
    filler: 0,
  };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role as keyof CreepQuotas | undefined;
    if (role && role in counts) counts[role]++;
  }
  return counts;
}

/**
 * How close a container may sit to count as a source-mining seat.
 * Range 1 is ideal; range 2 still covers real rooms where the only free tile
 * ended up one step farther (live home falsely reported 1/2 containers).
 */
export const SOURCE_CONTAINER_RANGE = 2;

/** Chebyshev distance — same metric as Screeps findInRange. */
export function chebyshevDist(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Pure: how many sources have at least one container within `range`. */
export function countSourcesWithNearbyContainers(
  sources: Array<{ x: number; y: number }>,
  containers: Array<{ x: number; y: number }>,
  range: number = SOURCE_CONTAINER_RANGE,
): number {
  let count = 0;
  for (const source of sources) {
    if (containers.some((c) => chebyshevDist(source, c) <= range)) count++;
  }
  return count;
}

export function countSourceContainers(
  room: Room,
  opts: { includeSites?: boolean; range?: number } = {},
): number {
  const includeSites = opts.includeSites ?? false;
  const range = opts.range ?? SOURCE_CONTAINER_RANGE;
  let count = 0;
  for (const source of room.find(FIND_SOURCES)) {
    const hasStructure =
      source.pos.findInRange(FIND_STRUCTURES, range, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }).length > 0;
    if (hasStructure) {
      count++;
      continue;
    }
    if (includeSites) {
      const hasSite =
        source.pos.findInRange(FIND_CONSTRUCTION_SITES, range, {
          filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        }).length > 0;
      if (hasSite) count++;
    }
  }
  return count;
}

/** Sum energy stored in finished containers near sources. */
export function sumSourceContainerEnergy(room: Room): number {
  let total = 0;
  const seen = new Set<Id<StructureContainer>>();
  for (const source of room.find(FIND_SOURCES)) {
    for (const struct of source.pos.findInRange(
      FIND_STRUCTURES,
      SOURCE_CONTAINER_RANGE,
      {
        filter: (s): s is StructureContainer =>
          s.structureType === STRUCTURE_CONTAINER,
      },
    )) {
      if (seen.has(struct.id)) continue;
      seen.add(struct.id);
      total += struct.store[RESOURCE_ENERGY] ?? 0;
    }
  }
  return total;
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
      source.pos.findInRange(FIND_STRUCTURES, SOURCE_CONTAINER_RANGE, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }).length > 0 ||
      source.pos.findInRange(FIND_CONSTRUCTION_SITES, SOURCE_CONTAINER_RANGE, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }).length > 0;
    if (!has) return source;
  }
  return null;
}

/** Sources that already have a finished nearby container (ready for static miners). */
export function findSourcesWithContainers(room: Room): Source[] {
  return room.find(FIND_SOURCES).filter(
    (source) =>
      source.pos.findInRange(FIND_STRUCTURES, SOURCE_CONTAINER_RANGE, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }).length > 0,
  );
}

/** Container construction sites near a source (not controller/storage). */
export function findSourceContainerSites(room: Room): ConstructionSite[] {
  const sites: ConstructionSite[] = [];
  const seen = new Set<Id<ConstructionSite>>();
  for (const source of room.find(FIND_SOURCES)) {
    for (const site of source.pos.findInRange(
      FIND_CONSTRUCTION_SITES,
      SOURCE_CONTAINER_RANGE,
      {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      },
    )) {
      if (seen.has(site.id)) continue;
      seen.add(site.id);
      sites.push(site);
    }
  }
  return sites;
}

/**
 * Cancel container sites next to a source that already has a finished container.
 * Live symptom: bot counted range-1 only → thought a source was bare → kept a
 * duplicate site (e.g. W0N0 @ 14,32) while both seats already stood.
 */
export function removeRedundantSourceContainerSites(room: Room): number {
  let removed = 0;
  for (const source of room.find(FIND_SOURCES)) {
    const finished = source.pos.findInRange(FIND_STRUCTURES, SOURCE_CONTAINER_RANGE, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    if (finished.length === 0) continue;
    for (const site of source.pos.findInRange(
      FIND_CONSTRUCTION_SITES,
      SOURCE_CONTAINER_RANGE,
      {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      },
    )) {
      if (site.remove() === OK) removed++;
    }
  }
  return removed;
}

/**
 * Cancel container sites that sit near neither a source nor the controller.
 * live home kept building (14,32) — far from both sources — while both seats
 * already stood at (23,9) and (42,23).
 */
export function removeOrphanContainerSites(room: Room): number {
  let removed = 0;
  const sources = room.find(FIND_SOURCES);
  const controller = room.controller;
  for (const site of room.find(FIND_CONSTRUCTION_SITES, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  })) {
    const nearSource = sources.some((src) =>
      site.pos.inRangeTo(src.pos, SOURCE_CONTAINER_RANGE),
    );
    if (nearSource) continue;
    if (controller && site.pos.inRangeTo(controller.pos, 2)) continue;
    if (site.remove() === OK) removed++;
  }
  return removed;
}

/** Primary owned room (spawn first) — never a random vision room from Game.rooms. */
export function pickHomeRoom(
  rooms: Record<string, Room>,
  spawns: Record<string, StructureSpawn>,
): Room | undefined {
  for (const name in spawns) {
    const room = spawns[name].room;
    if (room.controller?.my) return room;
  }
  for (const name in rooms) {
    const room = rooms[name];
    if (room.controller?.my) return room;
  }
  return undefined;
}

export function countStructures(room: Room, type: StructureConstant): number {
  return room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === type })
    .length;
}
