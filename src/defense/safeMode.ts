/**
 * Activate controller safe mode when the hub is under serious attack.
 * Triggers: spawn damaged, or many hostiles in home while towers exist.
 */

export const SAFE_MODE_HOSTILE_THRESHOLD = 3;

export function shouldActivateSafeMode(opts: {
  safeModeAvailable: number;
  safeModeCooldown: number;
  spawnDamaged: boolean;
  hostileCount: number;
  hostileThreshold?: number;
}): boolean {
  if (opts.safeModeAvailable <= 0) return false;
  if (opts.safeModeCooldown > 0) return false;
  if (opts.spawnDamaged) return true;
  const threshold = opts.hostileThreshold ?? SAFE_MODE_HOSTILE_THRESHOLD;
  return opts.hostileCount >= threshold;
}

/** Tick hook: activate safe mode when spawn is hit or mass hostiles arrive. */
export function maybeActivateSafeMode(room: Room): boolean {
  const controller = room.controller;
  if (!controller?.my) return false;

  const spawns = room.find(FIND_MY_SPAWNS);
  const spawnDamaged = spawns.some((s) => s.hits < s.hitsMax);
  const hostileCount = room.find(FIND_HOSTILE_CREEPS).length;

  if (
    !shouldActivateSafeMode({
      safeModeAvailable: controller.safeModeAvailable ?? 0,
      safeModeCooldown: controller.safeModeCooldown ?? 0,
      spawnDamaged,
      hostileCount,
    })
  ) {
    return false;
  }

  return controller.activateSafeMode() === OK;
}
