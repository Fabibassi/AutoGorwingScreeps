/**
 * When to arm hub ramparts/walls.
 *
 * Economy arm is RCL6+ once storage clears the blackout floor (same 20k family
 * as remotes / link feed). Raid arm is sticky for the next wave — too late for
 * first build, so economy arm must fire before a raid.
 */

import { STORAGE_FLOOR_ENERGY } from "./storageFloor";

export const WALL_ARM_MIN_RCL = 6;
export const WALL_ARM_MIN_STORAGE = STORAGE_FLOOR_ENERGY;

export type WallPolicy = "off" | "auto" | "force" | "raid_only";

export type WallArmInput = {
  rcl: number;
  storageEnergy: number;
  hostilesInRoom: number;
  spawnDamaged: boolean;
  alreadyArmed: boolean;
  policy?: WallPolicy;
  minRcl?: number;
  minStorage?: number;
};

export type WallArmDecision = {
  arm: boolean;
  reason:
    | "policy_off"
    | "force"
    | "sticky"
    | "economy"
    | "raid"
    | "wait";
};

export function parseWallPolicy(raw: unknown): WallPolicy {
  if (raw === "off" || raw === "force" || raw === "raid_only" || raw === "auto") {
    return raw;
  }
  return "auto";
}

export function decideWallArm(input: WallArmInput): WallArmDecision {
  const policy = input.policy ?? "auto";
  if (policy === "off") return { arm: false, reason: "policy_off" };
  if (policy === "force") return { arm: true, reason: "force" };
  if (input.alreadyArmed) return { arm: true, reason: "sticky" };

  const minRcl = input.minRcl ?? WALL_ARM_MIN_RCL;
  const minStorage = input.minStorage ?? WALL_ARM_MIN_STORAGE;

  // Raid-reactive arm is too late to save the spawn (walls-timing sim), but at
  // RCL≥minRcl it still sticky-arms hub ramparts for the next wave. Never arm
  // walls in RCL5 — that steals energy from the RCL6 push.
  const raidSignal =
    input.hostilesInRoom > 0 || input.spawnDamaged;
  if (raidSignal && input.rcl >= minRcl) {
    return { arm: true, reason: "raid" };
  }

  if (policy === "raid_only") return { arm: false, reason: "wait" };

  if (input.rcl >= minRcl && input.storageEnergy >= minStorage) {
    return { arm: true, reason: "economy" };
  }
  return { arm: false, reason: "wait" };
}

export function shouldPlaceHubRamparts(opts: {
  wallsArmed: boolean;
}): boolean {
  return opts.wallsArmed;
}

/** Wall ring only after hub shell + storage comfortably above floor. */
export const WALL_RING_STORAGE_BUFFER = 10_000;

export function shouldPlaceWallRing(opts: {
  hubRampartsReady: boolean;
  storageEnergy: number;
  floor?: number;
  buffer?: number;
  /** Wall ring is a late RCL6/7 spend — default require RCL≥6. */
  rcl?: number;
  minRcl?: number;
}): boolean {
  if (!opts.hubRampartsReady) return false;
  const minRcl = opts.minRcl ?? 6;
  if ((opts.rcl ?? 0) < minRcl) return false;
  const floor = opts.floor ?? STORAGE_FLOOR_ENERGY;
  const buffer = opts.buffer ?? WALL_RING_STORAGE_BUFFER;
  return opts.storageEnergy >= floor + buffer;
}

/** True when spawn (+ storage if present) already has a finished rampart. */
export function hubRampartsReady(room: Room): boolean {
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return false;
  const spawnOk = spawn.pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => s.structureType === STRUCTURE_RAMPART);
  if (!spawnOk) return false;
  if (!room.storage) return true;
  return room.storage.pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => s.structureType === STRUCTURE_RAMPART);
}

/** Open rampart construction sites on spawn/storage tiles. */
export function hubRampartSitesOpen(room: Room): number {
  let n = 0;
  const anchors: RoomPosition[] = [];
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (spawn) anchors.push(spawn.pos);
  if (room.storage) anchors.push(room.storage.pos);
  for (const pos of anchors) {
    if (
      pos
        .lookFor(LOOK_CONSTRUCTION_SITES)
        .some((s) => s.structureType === STRUCTURE_RAMPART)
    ) {
      n++;
    }
  }
  return n;
}

/**
 * Sticky-arm Memory.ags.wallsArmed from room signals.
 * Returns whether walls are armed after this tick.
 */
export function maybeArmWalls(room: Room): boolean {
  const mem = Memory.ags;
  if (!mem) return false;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
  const spawnDamaged = Boolean(
    spawn && spawn.hits < spawn.hitsMax,
  );
  const storageEnergy = room.storage?.store[RESOURCE_ENERGY] ?? 0;
  const decision = decideWallArm({
    rcl: room.controller?.level ?? 0,
    storageEnergy,
    hostilesInRoom: hostiles,
    spawnDamaged,
    alreadyArmed: Boolean(mem.wallsArmed),
    policy: parseWallPolicy(mem.wallPolicy),
  });
  if (decision.arm) {
    mem.wallsArmed = true;
    mem.wallArmReason = decision.reason;
  }
  return Boolean(mem.wallsArmed);
}
