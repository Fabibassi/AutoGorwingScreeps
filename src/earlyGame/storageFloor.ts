/**
 * Absolute storage floor (RCL4+): below this, throttle upgrade/link spend and
 * never bridge T1 miners when capacity can fund fat bodies (blackout spiral).
 * Gameplan / Wave-2: ~20k; override via Memory.ags.storageBlackoutReserve.
 *
 * Kept in its own module so policy ↔ rcl5Mode do not circular-require
 * (Screeps CJS modules reject cycles at load time).
 */
export const STORAGE_FLOOR_ENERGY = 20_000;

/** True when owned storage is at/under the blackout floor (RCL≥4). */
export function storageBelowFloor(opts: {
  rcl: number;
  hasStorage: boolean;
  storageEnergy: number;
  floor?: number;
}): boolean {
  if (!opts.hasStorage || opts.rcl < 4) return false;
  const floor = opts.floor ?? STORAGE_FLOOR_ENERGY;
  return opts.storageEnergy <= floor;
}
