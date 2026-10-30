/**
 * Wave E — later leaps after RCL7 hub is stable.
 * Gates only; full dual-remote / boosts / GCL expand land in later slices.
 */

/** CONTROLLER_STRUCTURES.lab mirror. */
export const LABS_BY_RCL: Record<number, number> = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
  6: 3,
  7: 6,
  8: 10,
};

export function labQuota(rcl: number): number {
  return LABS_BY_RCL[rcl] ?? 0;
}

/** Labs after RCL7 hit (ext/tower/spawn) + mineral flowing into terminal. */
export function shouldPlaceLabs(opts: {
  rcl: number;
  extensions: number;
  extensionQuota: number;
  towers: number;
  towerQuota: number;
  spawns: number;
  spawnQuota: number;
  terminalMineral: number;
  labs: number;
}): boolean {
  if (opts.rcl < 7) return false;
  if (opts.extensions < opts.extensionQuota) return false;
  if (opts.towers < opts.towerQuota) return false;
  if (opts.spawns < opts.spawnQuota) return false;
  if (opts.terminalMineral <= 0) return false;
  return opts.labs < labQuota(opts.rcl);
}

/**
 * Second remote only when first remote plan is active, storage healthy, and
 * home RCL7 hit structures are filled.
 */
export function shouldArmSecondRemote(opts: {
  rcl: number;
  firstRemoteActive: boolean;
  storageEnergy: number;
  floor: number;
  extensions: number;
  extensionQuota: number;
  secondRemoteArmed?: boolean;
}): boolean {
  if (opts.secondRemoteArmed) return true;
  if (!opts.firstRemoteActive) return false;
  if (opts.rcl < 7) return false;
  if (opts.storageEnergy < opts.floor + 10_000) return false;
  return opts.extensions >= opts.extensionQuota;
}

/** GCL / second room — only after labs quota started and storage fat. */
export function shouldPrepGclExpand(opts: {
  gcl: number;
  roomsOwned: number;
  labs: number;
  storageEnergy: number;
  floor: number;
}): boolean {
  if (opts.roomsOwned >= opts.gcl) return false;
  if (opts.labs < 3) return false;
  return opts.storageEnergy >= opts.floor + 50_000;
}
