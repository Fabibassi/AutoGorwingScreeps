/**
 * Remote income pause + evacuate when hostiles are seen in the remote room.
 * Blackout exception: remoteHaulers may salvage drops while the sticky window
 * holds IF the room is clear of hostiles this tick (no meat grinder).
 */

import { STORAGE_FLOOR_ENERGY } from "../earlyGame/storageFloor";

/** Keep spawn paused / flee sticky after last hostile sighting. */
export const REMOTE_THREAT_HOLD_TICKS = 300;

export type RemoteThreatMemory = {
  remoteThreatUntil?: number;
  remoteThreatCount?: number;
};

/**
 * Update sticky threat window from vision (or lack of it).
 * hostilesNow: count when room visible; null when no vision this tick.
 */
export function tickRemoteThreat(
  mem: RemoteThreatMemory,
  opts: { tick: number; hostilesNow: number | null },
): { active: boolean; until: number; count: number } {
  let until = mem.remoteThreatUntil ?? 0;
  let count = mem.remoteThreatCount ?? 0;

  if (opts.hostilesNow != null && opts.hostilesNow > 0) {
    until = opts.tick + REMOTE_THREAT_HOLD_TICKS;
    count = opts.hostilesNow;
  } else if (opts.tick >= until) {
    until = 0;
    count = 0;
  }

  if (until > 0) {
    mem.remoteThreatUntil = until;
    mem.remoteThreatCount = count;
  } else {
    delete mem.remoteThreatUntil;
    delete mem.remoteThreatCount;
  }

  const active =
    opts.tick < until ||
    (opts.hostilesNow != null && opts.hostilesNow > 0);
  return { active, until, count };
}

export function remoteThreatActive(
  mem: RemoteThreatMemory | undefined,
  tick: number,
): boolean {
  if (!mem) return false;
  const until = mem.remoteThreatUntil ?? 0;
  return tick < until;
}

/**
 * Pure evacuate gate (testable).
 * Live hostiles → always flee. Sticky threat → flee, except blackout salvage
 * for remoteHaulers while their current room is clear (incl. travel from home).
 */
export function shouldEvacuateRemoteOpts(opts: {
  threatSticky: boolean;
  hostilesInCreepRoom: number;
  role?: string;
  storageEnergy: number;
  floor?: number;
}): boolean {
  if (opts.hostilesInCreepRoom > 0) return true;
  if (!opts.threatSticky) return false;
  const floor = opts.floor ?? STORAGE_FLOOR_ENERGY;
  // Salvage: haul the remote pile home even while sticky hold is active.
  if (opts.role === "remoteHauler" && opts.storageEnergy <= floor) {
    return false;
  }
  return true;
}

/** True when creep should abort remote work and go/stay home. */
export function shouldEvacuateRemote(
  creep: Creep,
  mem: RemoteThreatMemory | undefined = Memory.ags,
): boolean {
  const home = creep.memory.homeRoom;
  const storageEnergy = home
    ? (Game.rooms[home]?.storage?.store[RESOURCE_ENERGY] ?? 0)
    : 0;
  return shouldEvacuateRemoteOpts({
    threatSticky: remoteThreatActive(mem, Game.time),
    hostilesInCreepRoom: creep.room.find(FIND_HOSTILE_CREEPS).length,
    role: creep.memory.role,
    storageEnergy,
  });
}

/**
 * During sticky threat + blackout, still allow spawning salvage haulers
 * (not miners/reservers — those stay paused).
 */
export function allowRemoteSalvageSpawn(opts: {
  threatActive: boolean;
  storageEnergy: number;
  floor?: number;
}): boolean {
  if (!opts.threatActive) return false;
  return opts.storageEnergy <= (opts.floor ?? STORAGE_FLOOR_ENERGY);
}

/**
 * Flee to homeRoom (deliver energy if hauler). Returns true when evacuating
 * so the role should skip normal work.
 */
export function fleeRemoteToHome(creep: Creep): boolean {
  if (!shouldEvacuateRemote(creep)) return false;

  const home = creep.memory.homeRoom;
  if (!home) return true;

  const carrying =
    creep.store?.getUsedCapacity?.(RESOURCE_ENERGY) ??
    (creep.store as { energy?: number } | undefined)?.energy ??
    0;

  if (creep.room.name !== home) {
    creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
    return true;
  }

  if (carrying > 0) {
    const storage = Game.rooms[home]?.storage;
    if (storage) {
      if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 10 });
      }
      return true;
    }
  }

  // Park near home spawn while threat window holds.
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.inRangeTo(spawn, 3)) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
  return true;
}
