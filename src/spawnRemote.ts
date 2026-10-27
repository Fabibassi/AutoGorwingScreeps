/**
 * Spawn remote miners / haulers / reserver after home economy is healthy.
 */
import {
  estimateRemotePathFromMap,
  measureRemotePathLength,
  pickFirstExitRoom,
  remoteQuotasForPlan,
  remoteSpawnGatesOk,
  remoteSurvivalQuotas,
  parseRemotePlan,
  REMOTE_PATH_DEFAULT,
  type RemoteQuotas,
} from "./earlyGame/remotePlan";
import { storageBelowFloor } from "./earlyGame/storageFloor";
import {
  buildRemoteHaulerBody,
  buildRemoteMinerBody,
  buildReserverBody,
} from "./earlyGame/remoteBodies";
import {
  parseRemoteVariant,
  tuningForRemoteVariant,
} from "./earlyGame/remoteVariant";

export type RemoteRole = "reserver" | "remoteMiner" | "remoteHauler";

export function countRemoteRoles(): Record<RemoteRole, number> {
  const counts: Record<RemoteRole, number> = {
    reserver: 0,
    remoteMiner: 0,
    remoteHauler: 0,
  };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role as RemoteRole | undefined;
    if (role && role in counts) counts[role]++;
  }
  return counts;
}

/** Live remote quota for the armed plan (path + sources). */
export function currentRemoteQuotas(home: Room): RemoteQuotas {
  const plan = parseRemotePlan(Memory.ags?.remotePlan);
  const remoteRoom = Memory.ags?.remoteRoom ?? pickFirstExitRoom(home.name);
  const pathLength = Memory.ags?.remotePathLength ?? REMOTE_PATH_DEFAULT;
  const variant = parseRemoteVariant(Memory.ags?.remoteVariant);
  const tuning = tuningForRemoteVariant(variant);
  const remoteSources = remoteRoom
    ? (Game.rooms[remoteRoom]?.find(FIND_SOURCES).length ?? 2)
    : 2;
  return remoteQuotasForPlan(plan, {
    sources: Math.max(1, remoteSources),
    pathLength,
    haulerQuotaScale: tuning.haulerQuotaScale,
  });
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
 * Prefer empty + near spawn; carrying haulers still deliver via role until empty.
 * Never recycle under the storage floor — remotes are income, not spend.
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

/** True when home mining seats look staffed enough to spare spawn for remotes. */
export function homeReadyForRemotes(opts: {
  homeMiners: number;
  homeMinerWant: number;
  homeFillers: number;
}): boolean {
  if (opts.homeMinerWant <= 0) return opts.homeMiners > 0;
  return opts.homeMiners >= Math.min(opts.homeMinerWant, 2) && opts.homeFillers >= 1;
}

/**
 * Attempt one remote spawn. Returns true if spawnCreep OK.
 * Under storage floor: survival restaff only (miner → hauler → reserver).
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
  if (!homeReadyForRemotes(opts)) return false;

  let remoteRoom = Memory.ags?.remoteRoom;
  if (!remoteRoom) {
    remoteRoom = pickFirstExitRoom(room.name);
    if (!remoteRoom) return false;
    if (Memory.ags) Memory.ags.remoteRoom = remoteRoom;
  }

  if (Memory.ags) {
    const measured = measureRemotePathLength(room, remoteRoom);
    if (measured != null) {
      Memory.ags.remotePathLength = measured;
    } else if (Memory.ags.remotePathLength == null) {
      const estimate = estimateRemotePathFromMap(room.name, remoteRoom);
      if (estimate != null) Memory.ags.remotePathLength = estimate;
    }
  }
  const pathLength = Memory.ags?.remotePathLength ?? REMOTE_PATH_DEFAULT;
  const variant = parseRemoteVariant(Memory.ags?.remoteVariant);
  const tuning = tuningForRemoteVariant(variant);
  const remoteSources =
    Game.rooms[remoteRoom]?.find(FIND_SOURCES).length ?? 2;
  const sources = Math.max(1, remoteSources);
  const fullQuotas = remoteQuotasForPlan(plan, {
    sources,
    pathLength,
    haulerQuotaScale: tuning.haulerQuotaScale,
  });
  const survival = remoteSurvivalQuotas(plan, sources);
  const counts = countRemoteRoles();
  const belowFloor = storageBelowFloor({
    rcl,
    hasStorage: room.storage !== undefined,
    storageEnergy,
  });
  const restaff = belowFloor && remoteUnderSurvival(counts, survival);
  if (!remoteSpawnGatesOk({ rcl, storageEnergy, plan, restaff })) {
    return false;
  }

  const quotas = belowFloor ? survival : fullQuotas;
  const order: RemoteRole[] = belowFloor
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
