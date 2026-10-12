/** Pure helpers for RCL5 Storage↔Controller link pipeline (testable). */

export const CONTROLLER_LINK_MAX_RANGE = 2;
export const STORAGE_LINK_MAX_RANGE = 2;
/** Controller link requests energy below this fill. */
export const CONTROLLER_LINK_RECEIVE_THRESHOLD = 400;
/** Storage link needs at least this much before sending. */
export const STORAGE_LINK_SEND_MIN = 200;
/** Storage link requests a top-up below this fill. */
export const STORAGE_LINK_FILL_THRESHOLD = 200;

export type LinkRole = "storage" | "controller" | "other";
export type LinkSlot = "storage" | "controller";

function chebyshev(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Placement order: storage link first, then controller link. */
export function nextLinkSlot(opts: {
  hasStorageLink: boolean;
  hasControllerLink: boolean;
}): LinkSlot | null {
  if (!opts.hasStorageLink) return "storage";
  if (!opts.hasControllerLink) return "controller";
  return null;
}

export function classifyLinkRole(opts: {
  linkPos: { x: number; y: number };
  storagePos?: { x: number; y: number } | null;
  controllerPos?: { x: number; y: number } | null;
}): LinkRole {
  // Controller wins ties (upgrade sink is the RCL5 bottleneck).
  if (
    opts.controllerPos &&
    chebyshev(opts.linkPos, opts.controllerPos) <= CONTROLLER_LINK_MAX_RANGE
  ) {
    return "controller";
  }
  if (
    opts.storagePos &&
    chebyshev(opts.linkPos, opts.storagePos) <= STORAGE_LINK_MAX_RANGE
  ) {
    return "storage";
  }
  return "other";
}

export function shouldFillStorageLink(opts: {
  linkEnergy: number;
  storageEnergy: number;
  /** Room storage floor — do not pull controller feed at/under floor. */
  storageFloor?: number;
}): boolean {
  const floor = opts.storageFloor ?? 0;
  if (opts.storageEnergy <= floor) return false;
  return opts.linkEnergy < STORAGE_LINK_FILL_THRESHOLD;
}

export function shouldTransferStorageToController(opts: {
  storageEnergy: number;
  controllerEnergy: number;
  storageCooldown: number;
  controllerFree: number;
  /** Room storage energy (not link). Gate controller pipeline on floor. */
  roomStorageEnergy?: number;
  storageFloor?: number;
}): boolean {
  if (opts.storageCooldown > 0) return false;
  if (opts.storageEnergy < STORAGE_LINK_SEND_MIN) return false;
  if (opts.controllerEnergy >= CONTROLLER_LINK_RECEIVE_THRESHOLD) return false;
  if (opts.controllerFree <= 0) return false;
  const floor = opts.storageFloor ?? 0;
  if (
    opts.roomStorageEnergy !== undefined &&
    opts.roomStorageEnergy <= floor
  ) {
    return false;
  }
  return true;
}

/** Amount to send: fill controller free capacity without emptying under send min. */
export function transferAmount(
  storageEnergy: number,
  controllerFree: number,
): number {
  return Math.max(
    0,
    Math.min(storageEnergy, controllerFree, storageEnergy - 0),
  );
}
