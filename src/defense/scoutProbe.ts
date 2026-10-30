/**
 * Scout / probe response: sticky home threat for non-NPC hostiles.
 * Towers + combat refill already fire; this arms Memory for later clear/safemode
 * and distinguishes Invader clear from player probes.
 */
import { INVADER_USERNAME } from "./invaderClear";

export const HOME_PROBE_HOLD_TICKS = 200;

export type ScoutProbeMemory = {
  homeProbeUntil?: number;
  homeProbeCount?: number;
  homeProbePlayer?: boolean;
};

export function isNpcHostile(creep: Creep): boolean {
  return creep.owner?.username === INVADER_USERNAME;
}

export function countPlayerHostiles(hostiles: Creep[]): number {
  return hostiles.filter((h) => !isNpcHostile(h)).length;
}

/**
 * Arm sticky probe window when a non-Invader hostile is in home.
 * Invader-only rooms do not arm probe (clearer path handles those).
 */
export function tickHomeProbe(
  mem: ScoutProbeMemory,
  opts: { tick: number; hostiles: Creep[] },
): { active: boolean; player: boolean; count: number } {
  const players = countPlayerHostiles(opts.hostiles);
  const count = opts.hostiles.length;
  let until = mem.homeProbeUntil ?? 0;
  let player = Boolean(mem.homeProbePlayer);

  if (players > 0) {
    until = opts.tick + HOME_PROBE_HOLD_TICKS;
    player = true;
  } else if (opts.tick >= until) {
    until = 0;
    player = false;
  }

  if (until > 0) {
    mem.homeProbeUntil = until;
    mem.homeProbeCount = Math.max(players, count);
    mem.homeProbePlayer = player;
  } else {
    delete mem.homeProbeUntil;
    delete mem.homeProbeCount;
    delete mem.homeProbePlayer;
  }

  return {
    active: opts.tick < until || players > 0,
    player,
    count: players > 0 ? players : mem.homeProbeCount ?? 0,
  };
}

export function homeProbeActive(
  mem: ScoutProbeMemory | undefined,
  tick: number,
): boolean {
  if (!mem) return false;
  return tick < (mem.homeProbeUntil ?? 0);
}

/**
 * Probe response: safe mode if spawn is hit; otherwise towers (refill already
 * combat-prioritized). Returns action label for telemetry / bakeoff scoring.
 */
export function probeResponseAction(opts: {
  probeActive: boolean;
  playerProbe: boolean;
  spawnDamaged: boolean;
  safeModeAvailable: number;
}): "none" | "towers" | "safemode" {
  if (!opts.probeActive) return "none";
  if (opts.spawnDamaged && opts.safeModeAvailable > 0) return "safemode";
  return "towers";
}
