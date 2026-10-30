/**
 * Cheap remote clearer for NPC Invaders and soft player hostiles (e.g. camping
 * hauler). Strongholds / boosted PvP stay out of scope.
 *
 * Storage gate is intentionally soft: a parked enemy hauler costs more remote
 * income than a 130–520 energy clearer. Only deep blackout blocks spawn.
 */
import { STORAGE_FLOOR_ENERGY } from "../earlyGame/storageFloor";

/** Deep blackout only — do not require floor+buffer (that blocked clears at ~20k). */
export const INVADER_CLEAR_STORAGE_MIN = 5_000;
/** @deprecated alias — tests / call sites may still import the old name. */
export const INVADER_CLEAR_STORAGE_BUFFER = 0;
export const INVADER_CLEAR_MAX_SQUAD = 1;
/** Username used by Screeps World NPC Invaders. */
export const INVADER_USERNAME = "Invader";

export type DefenseMode = "flee" | "clear" | "refill" | "safemode";

const DEFENSE_MODES = new Set<string>(["flee", "clear", "refill", "safemode"]);

/** Sim / live knob. Default clear (after bakeoff locks). */
export function parseDefenseMode(raw: string | undefined): DefenseMode {
  if (raw && DEFENSE_MODES.has(raw)) return raw as DefenseMode;
  return "clear";
}

export function invaderClearStorageMin(_floor = STORAGE_FLOOR_ENERGY): number {
  return INVADER_CLEAR_STORAGE_MIN;
}

/**
 * Pure gate: may we spend spawn energy on a clearer?
 * clear mode required; flee/refill/safemode arms never spawn attack.
 */
export function shouldSpawnInvaderClearer(opts: {
  defenseMode: DefenseMode;
  rcl: number;
  storageEnergy: number;
  threatActive: boolean;
  livingClearers: number;
  energyAvailable: number;
  floor?: number;
  maxSquad?: number;
}): boolean {
  if (opts.defenseMode !== "clear") return false;
  if (opts.rcl < 6) return false;
  if (!opts.threatActive) return false;
  const max = opts.maxSquad ?? INVADER_CLEAR_MAX_SQUAD;
  if (opts.livingClearers >= max) return false;
  if (opts.storageEnergy < invaderClearStorageMin(opts.floor)) return false;
  // Cheap squad: ATTACK+MOVE = 130.
  return opts.energyAvailable >= 130;
}

/** Scale ATTACK/MOVE pairs up to ~4 for two Invaders; always equal MOVE. */
export function buildInvaderClearerBody(
  energyAvailable: number,
): BodyPartConstant[] {
  const pair = 80 + 50; // attack + move
  if (energyAvailable < pair) return [];
  const pairs = Math.min(4, Math.floor(energyAvailable / pair));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < pairs; i++) body.push("attack");
  for (let i = 0; i < pairs; i++) body.push("move");
  return body;
}

function combatParts(creep: Creep): number {
  return (
    creep.getActiveBodyparts("attack") +
    creep.getActiveBodyparts("ranged_attack") +
    creep.getActiveBodyparts("heal")
  );
}

/**
 * Prefer NPC Invaders, then soft player hostiles (hauler/scout), then any.
 */
export function pickInvaderTarget(hostiles: Creep[]): Creep | null {
  if (hostiles.length === 0) return null;
  const npcs = hostiles.filter((h) => h.owner?.username === INVADER_USERNAME);
  const pool = npcs.length > 0 ? npcs : hostiles;
  const soft = pool.filter((h) => combatParts(h) === 0);
  return (soft[0] ?? pool[0]) ?? null;
}

export function countAttackers(homeRoom?: string): number {
  let n = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role !== "attacker") continue;
    if (homeRoom && c.memory.homeRoom && c.memory.homeRoom !== homeRoom) {
      continue;
    }
    n++;
  }
  return n;
}

/**
 * Spawn one clearer into the threatened remote. Runs even while remoteThreat
 * pauses normal remote economy spawns.
 */
export function trySpawnInvaderClearer(
  spawn: StructureSpawn,
  opts: {
    threatActive: boolean;
    remoteRoom: string | undefined;
    defenseMode?: DefenseMode;
  },
): boolean {
  if (spawn.spawning) return false;
  const room = spawn.room;
  const remoteRoom = opts.remoteRoom;
  if (!remoteRoom) return false;

  const mode = opts.defenseMode ?? parseDefenseMode(Memory.ags?.defenseMode);
  if (
    !shouldSpawnInvaderClearer({
      defenseMode: mode,
      rcl: room.controller?.level ?? 0,
      storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0,
      threatActive: opts.threatActive,
      livingClearers: countAttackers(room.name),
      energyAvailable: room.energyAvailable,
    })
  ) {
    return false;
  }

  const body = buildInvaderClearerBody(room.energyAvailable);
  if (body.length === 0) return false;

  const name = `attacker-${Game.time}-${Math.floor(Math.random() * 1_000_000)}`;
  const result = spawn.spawnCreep(body, name, {
    memory: {
      role: "attacker",
      targetRoom: remoteRoom,
      homeRoom: room.name,
    },
  });
  return result === OK;
}
