/**
 * Spawn remote miners / haulers / reserver after home economy is healthy.
 * Supports a second remote room once Wave-E gates arm.
 */
import {
  estimateRemotePathFromMap,
  measureRemotePathLength,
  pickFirstExitRoom,
  pickSecondExitRoom,
  remoteQuotasForPlan,
  remoteSpawnGatesOk,
  remoteSurvivalQuotas,
  parseRemotePlan,
  remotePlanIsActive,
  REMOTE_PATH_DEFAULT,
  type RemoteQuotas,
} from "./earlyGame/remotePlan";
import { shouldArmSecondRemote } from "./earlyGame/nextLeaps";
import { STORAGE_FLOOR_ENERGY, storageBelowFloor } from "./earlyGame/storageFloor";
import {
  buildRemoteHaulerBody,
  buildRemoteMinerBody,
  buildReserverBody,
} from "./earlyGame/remoteBodies";
import {
  parseRemoteVariant,
  tuningForRemoteVariant,
} from "./earlyGame/remoteVariant";
import { remoteThreatActive } from "./defense/remoteThreat";
import { extensionQuota } from "./earlyGame/policy";

export type RemoteRole = "reserver" | "remoteMiner" | "remoteHauler";

export function countRemoteRoles(
  targetRoom?: string,
): Record<RemoteRole, number> {
  const counts: Record<RemoteRole, number> = {
    reserver: 0,
    remoteMiner: 0,
    remoteHauler: 0,
  };
  const primary = Memory.ags?.remoteRoom;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = creep.memory.role as RemoteRole | undefined;
    if (!role || !(role in counts)) continue;
    if (targetRoom) {
      const assigned = creep.memory.targetRoom;
      // Legacy creeps without targetRoom count toward the primary remote.
      if (assigned) {
        if (assigned !== targetRoom) continue;
      } else if (targetRoom !== primary) {
        continue;
      }
    }
    counts[role]++;
  }
  return counts;
}

/** Active remote room names (1 and optionally 2). Does not mutate Memory. */
export function activeRemoteRooms(home: Room): string[] {
  const rooms: string[] = [];
  const first = Memory.ags?.remoteRoom ?? pickFirstExitRoom(home.name);
  if (first) rooms.push(first);

  const rcl = home.controller?.level ?? 0;
  const storageEnergy = home.storage?.store[RESOURCE_ENERGY] ?? 0;
  let extensions = 0;
  if (typeof FIND_MY_STRUCTURES !== "undefined") {
    extensions = home
      .find(FIND_MY_STRUCTURES)
      .filter((s) => s.structureType === STRUCTURE_EXTENSION).length;
  }
  const armSecond = shouldArmSecondRemote({
    rcl,
    firstRemoteActive: remotePlanIsActive(Memory.ags?.remotePlan),
    storageEnergy,
    floor: STORAGE_FLOOR_ENERGY,
    extensions,
    extensionQuota: extensionQuota(rcl),
    secondRemoteArmed: Boolean(Memory.ags?.remoteRoom2),
  });
  if (!armSecond) return rooms;

  const second =
    Memory.ags?.remoteRoom2 ?? pickSecondExitRoom(home.name, first);
  if (second && second !== first) rooms.push(second);
  return rooms;
}

function pathLengthForRemote(
  home: Room,
  remoteRoom: string,
  slot: 1 | 2,
): number {
  const measured = measureRemotePathLength(home, remoteRoom);
  if (Memory.ags) {
    if (slot === 1) {
      if (measured != null) Memory.ags.remotePathLength = measured;
      else if (Memory.ags.remotePathLength == null) {
        const estimate = estimateRemotePathFromMap(home.name, remoteRoom);
        if (estimate != null) Memory.ags.remotePathLength = estimate;
      }
      return Memory.ags.remotePathLength ?? REMOTE_PATH_DEFAULT;
    }
    if (measured != null) Memory.ags.remotePathLength2 = measured;
    else if (Memory.ags.remotePathLength2 == null) {
      const estimate = estimateRemotePathFromMap(home.name, remoteRoom);
      if (estimate != null) Memory.ags.remotePathLength2 = estimate;
    }
    return Memory.ags.remotePathLength2 ?? REMOTE_PATH_DEFAULT;
  }
  return measured ?? REMOTE_PATH_DEFAULT;
}

function quotasForRemoteRoom(
  home: Room,
  remoteRoom: string,
  slot: 1 | 2,
): RemoteQuotas {
  const plan = parseRemotePlan(Memory.ags?.remotePlan);
  const pathLength = pathLengthForRemote(home, remoteRoom, slot);
  const variant = parseRemoteVariant(Memory.ags?.remoteVariant);
  const tuning = tuningForRemoteVariant(variant);
  const remoteSources =
    Game.rooms[remoteRoom]?.find(FIND_SOURCES).length ?? 2;
  return remoteQuotasForPlan(plan, {
    sources: Math.max(1, remoteSources),
    pathLength,
    haulerQuotaScale: tuning.haulerQuotaScale,
  });
}

/** Live remote quota for the first armed plan (path + sources). */
export function currentRemoteQuotas(home: Room): RemoteQuotas {
  const rooms = activeRemoteRooms(home);
  if (rooms.length === 0) {
    return remoteQuotasForPlan(parseRemotePlan(Memory.ags?.remotePlan), {
      sources: 2,
      pathLength: REMOTE_PATH_DEFAULT,
    });
  }
  let total: RemoteQuotas = { remoteMiner: 0, remoteHauler: 0, reserver: 0 };
  rooms.forEach((remoteRoom, i) => {
    const q = quotasForRemoteRoom(home, remoteRoom, i === 0 ? 1 : 2);
    total = {
      remoteMiner: total.remoteMiner + q.remoteMiner,
      remoteHauler: total.remoteHauler + q.remoteHauler,
      reserver: total.reserver + q.reserver,
    };
  });
  return total;
}

function remoteUnderSurvival(
  counts: Record<RemoteRole, number>,
  survival: RemoteQuotas,
): boolean {
  return (
    counts.remoteMiner < survival.remoteMiner ||
    counts.remoteHauler < survival.remoteHauler ||
    counts.reserver < survival.reserver
  );
}

/**
 * Surplus remoteHaulers walk home and recycle so CAPEX builders get spawn.
 */
export function recycleExcessRemoteHaulers(spawn: StructureSpawn): boolean {
  if (spawn.spawning) return false;
  const room = spawn.room;
  const rcl = room.controller?.level ?? 0;
  const storageEnergy = room.storage?.store[RESOURCE_ENERGY] ?? 0;
  if (
    storageBelowFloor({
      rcl,
      hasStorage: room.storage !== undefined,
      storageEnergy,
    })
  ) {
    return false;
  }

  const want = currentRemoteQuotas(spawn.room).remoteHauler;
  const counts = countRemoteRoles();
  if (counts.remoteHauler <= want) {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.memory.role !== "remoteHauler") continue;
      if (creep.memory.homeRoom && creep.memory.homeRoom !== spawn.room.name) {
        continue;
      }
      if (creep.memory.recycling) delete creep.memory.recycling;
    }
    return false;
  }

  let best: Creep | null = null;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.role !== "remoteHauler") continue;
    if (creep.memory.homeRoom && creep.memory.homeRoom !== spawn.room.name) {
      continue;
    }
    const carried =
      creep.store?.getUsedCapacity?.(RESOURCE_ENERGY) ??
      (creep.store as { energy?: number } | undefined)?.energy ??
      0;
    const empty = carried <= 0;
    const near = creep.room.name === spawn.room.name && creep.pos.isNearTo(spawn);
    if (!best) {
      best = creep;
      continue;
    }
    const bestCarried =
      best.store?.getUsedCapacity?.(RESOURCE_ENERGY) ??
      (best.store as { energy?: number } | undefined)?.energy ??
      0;
    const bestEmpty = bestCarried <= 0;
    const bestNear =
      best.room.name === spawn.room.name && best.pos.isNearTo(spawn);
    if (empty && !bestEmpty) best = creep;
    else if (empty === bestEmpty && near && !bestNear) best = creep;
  }
  if (!best) return false;

  best.memory.recycling = true;
  if (best.room.name !== spawn.room.name) {
    best.moveTo(spawn, { reusePath: 20 });
    return true;
  }
  if (best.pos.isNearTo(spawn)) {
    return spawn.recycleCreep(best) === OK;
  }
  best.moveTo(spawn, { reusePath: 10 });
  return true;
}

export function homeReadyForRemotes(opts: {
  homeMiners: number;
  homeMinerWant: number;
  homeFillers: number;
}): boolean {
  if (opts.homeMinerWant <= 0) return opts.homeMiners > 0;
  return opts.homeMiners >= Math.min(opts.homeMinerWant, 2) && opts.homeFillers >= 1;
}

function trySpawnRemoteForRoom(
  spawn: StructureSpawn,
  remoteRoom: string,
  slot: 1 | 2,
  opts: { belowFloor: boolean },
): boolean {
  const room = spawn.room;
  const plan = parseRemotePlan(Memory.ags?.remotePlan);
  const variant = parseRemoteVariant(Memory.ags?.remoteVariant);
  const tuning = tuningForRemoteVariant(variant);
  const fullQuotas = quotasForRemoteRoom(room, remoteRoom, slot);
  const remoteSources =
    Game.rooms[remoteRoom]?.find(FIND_SOURCES).length ?? 2;
  const survival = remoteSurvivalQuotas(plan, Math.max(1, remoteSources));
  const counts = countRemoteRoles(remoteRoom);
  const quotas = opts.belowFloor ? survival : fullQuotas;
  const order: RemoteRole[] = opts.belowFloor
    ? ["remoteMiner", "remoteHauler", "reserver"]
    : ["reserver", "remoteMiner", "remoteHauler"];
  const energyAvailable = room.energyAvailable;
  const home = room.name;

  for (const role of order) {
    const want =
      role === "reserver"
        ? quotas.reserver
        : role === "remoteMiner"
          ? quotas.remoteMiner
          : quotas.remoteHauler;
    if (counts[role] >= want) continue;

    let body: BodyPartConstant[] = [];
    if (role === "reserver") body = buildReserverBody(energyAvailable, tuning);
    else if (role === "remoteMiner") {
      body = buildRemoteMinerBody(energyAvailable, tuning);
    } else body = buildRemoteHaulerBody(energyAvailable, tuning);
    if (body.length === 0) continue;

    const name = `${role}-${Game.time}-${Math.floor(Math.random() * 1_000_000)}`;
    const memory: CreepMemory = {
      role,
      targetRoom: remoteRoom,
      homeRoom: home,
    };
    const result = spawn.spawnCreep(body, name, { memory });
    if (result === OK) return true;
  }
  return false;
}

/**
 * Attempt one remote spawn (room1 then room2). Returns true if spawnCreep OK.
 */
export function trySpawnRemote(
  spawn: StructureSpawn,
  opts: {
    homeMiners: number;
    homeMinerWant: number;
    homeFillers: number;
  },
): boolean {
  if (spawn.spawning) return false;
  const room = spawn.room;
  const rcl = room.controller?.level ?? 0;
  const storageEnergy = room.storage?.store[RESOURCE_ENERGY] ?? 0;
  const plan = parseRemotePlan(Memory.ags?.remotePlan);
  if (remoteThreatActive(Memory.ags, Game.time)) return false;
  if (!homeReadyForRemotes(opts)) return false;

  const remotes = activeRemoteRooms(room);
  if (remotes.length === 0) return false;

  // Sticky-arm room names once we are actually spawning for them.
  if (Memory.ags) {
    if (!Memory.ags.remoteRoom && remotes[0]) {
      Memory.ags.remoteRoom = remotes[0];
    }
    if (remotes[1] && !Memory.ags.remoteRoom2) {
      Memory.ags.remoteRoom2 = remotes[1];
    }
  }

  const belowFloor = storageBelowFloor({
    rcl,
    hasStorage: room.storage !== undefined,
    storageEnergy,
  });
  // Survival restaff: any understaffed remote room.
  let restaff = false;
  if (belowFloor) {
    for (let i = 0; i < remotes.length; i++) {
      const remoteRoom = remotes[i];
      const survival = remoteSurvivalQuotas(
        plan,
        Math.max(1, Game.rooms[remoteRoom]?.find(FIND_SOURCES).length ?? 2),
      );
      if (remoteUnderSurvival(countRemoteRoles(remoteRoom), survival)) {
        restaff = true;
        break;
      }
    }
  }
  if (!remoteSpawnGatesOk({ rcl, storageEnergy, plan, restaff })) {
    return false;
  }

  for (let i = 0; i < remotes.length; i++) {
    if (
      trySpawnRemoteForRoom(spawn, remotes[i], i === 0 ? 1 : 2, { belowFloor })
    ) {
      return true;
    }
  }
  return false;
}
