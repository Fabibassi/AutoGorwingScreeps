/**
 * Post-RCL6 remote mining plan (orthogonal to rcl5Mode / fillerPlan).
 * Production default off until bakeoff winner is armed.
 */

import {
  evaluateRemoteEconomics,
  type RemoteEconPlan,
} from "./remoteEconomics";

export const REMOTE_PLANS = [
  "off",
  "home_only",
  "drop_unreserved",
  "reserved_drop",
  "reserved_container",
] as const;

export type RemotePlan = (typeof REMOTE_PLANS)[number];

/**
 * Bakeoff winner (remote-income 15k, 2026-10-11): reserved_drop @ mid range
 * best floorOk netPerTick (−2.24 vs off floor-fail). Live arm only at RCL≥6.
 */
export const REMOTE_BAKEOFF_WINNER: RemotePlan = "reserved_drop";

/**
 * Fallback one-way haul tiles when Memory / vision has no measurement.
 * Adjacent remote mid-haul ≈30; old default 50 over-requested ~14 haulers.
 */
export const REMOTE_PATH_DEFAULT = 30;

/** Hard cap so a bad pathLength cannot flood spawn with remote haulers. */
export const REMOTE_HAULER_CAP = 6;

export function clampRemoteHaulerQuota(
  count: number,
  cap: number = REMOTE_HAULER_CAP,
): number {
  return Math.max(1, Math.min(Math.floor(cap), Math.floor(count)));
}

/**
 * Average one-way path length home storage/spawn → remote sources.
 * Needs vision of the remote room. Returns undefined when unmeasurable.
 */
export function measureRemotePathLength(
  home: Room,
  remoteName: string,
): number | undefined {
  const remote = Game.rooms[remoteName];
  if (!remote || remoteName === home.name) return undefined;
  const from = home.storage?.pos ?? home.find(FIND_MY_SPAWNS)[0]?.pos;
  if (!from) return undefined;
  const sources = remote.find(FIND_SOURCES);
  if (sources.length === 0) return undefined;
  let sum = 0;
  let n = 0;
  for (const source of sources) {
    const path = from.findPathTo(source.pos, {
      ignoreCreeps: true,
      swampCost: 2,
    });
    if (path.length > 0) {
      sum += path.length;
      n++;
    }
  }
  if (n === 0) return undefined;
  return Math.max(1, Math.round(sum / n));
}

/** Soft estimate without vision: room hops × ~25 tiles. */
export function estimateRemotePathFromMap(
  homeName: string,
  remoteName: string,
): number | undefined {
  if (homeName === remoteName) return undefined;
  try {
    const hops = Game.map.getRoomLinearDistance(homeName, remoteName, false);
    if (!Number.isFinite(hops) || hops < 1) return undefined;
    return Math.max(1, Math.round(hops * 25));
  } catch {
    return undefined;
  }
}

export function isRemotePlan(raw: unknown): raw is RemotePlan {
  return (
    typeof raw === "string" &&
    (REMOTE_PLANS as readonly string[]).includes(raw)
  );
}

export function parseRemotePlan(raw?: string): RemotePlan {
  if (raw === "home_only") return "off";
  return isRemotePlan(raw) ? raw : "off";
}

export function remotePlanIsActive(plan: RemotePlan | string | undefined): boolean {
  const p = parseRemotePlan(typeof plan === "string" ? plan : undefined);
  return p !== "off";
}

export function remotePlanNeedsReserve(
  plan: RemotePlan | string | undefined,
): boolean {
  const p = parseRemotePlan(typeof plan === "string" ? plan : undefined);
  return p === "reserved_drop" || p === "reserved_container";
}

export function remotePlanNeedsContainer(
  plan: RemotePlan | string | undefined,
): boolean {
  return parseRemotePlan(typeof plan === "string" ? plan : undefined) ===
    "reserved_container";
}

export interface RemoteQuotas {
  remoteMiner: number;
  remoteHauler: number;
  reserver: number;
}

export function remoteQuotasForPlan(
  plan: RemotePlan | string | undefined,
  opts: {
    sources: number;
    pathLength: number;
    /** Scale hauler seats (variant lean_haul / fat_haul). */
    haulerQuotaScale?: number;
  },
): RemoteQuotas {
  const p = parseRemotePlan(typeof plan === "string" ? plan : undefined);
  if (p === "off") {
    return { remoteMiner: 0, remoteHauler: 0, reserver: 0 };
  }
  const econ = evaluateRemoteEconomics({
    plan: p as RemoteEconPlan,
    sources: Math.max(1, opts.sources),
    pathLength: Math.max(1, opts.pathLength),
  });
  const scale = opts.haulerQuotaScale ?? 1;
  const haulers = clampRemoteHaulerQuota(
    Math.max(1, Math.ceil(econ.haulerCount * scale)),
  );
  return {
    remoteMiner: Math.max(1, opts.sources),
    remoteHauler: haulers,
    reserver: remotePlanNeedsReserve(p) ? 1 : 0,
  };
}

/**
 * Sticky-arm bakeoff winner after RCL6 + storage floor.
 * Skip explicit off / non-winner sim arms.
 */
export function maybeArmRemotePlanPostRcl6(
  rcl: number,
  currentPlan: string | undefined,
  opts: { storageEnergy: number; storageFloor?: number },
): RemotePlan | undefined {
  const winner = REMOTE_BAKEOFF_WINNER;
  if (winner === "off" || winner === "home_only") return undefined;
  if (rcl < 6) return undefined;
  const floor = opts.storageFloor ?? 20_000;
  if (opts.storageEnergy < floor) return undefined;
  if (currentPlan === "off" || currentPlan === "home_only") return undefined;
  if (
    currentPlan === "drop_unreserved" ||
    currentPlan === "reserved_drop" ||
    currentPlan === "reserved_container"
  ) {
    // Explicit sim / manual arm — do not overwrite.
    if (currentPlan !== winner) return undefined;
    return undefined;
  }
  if (currentPlan === winner) return undefined;
  return winner;
}

/**
 * Survival crew under storage floor: keep income alive without expanding haulers.
 * Miner seats = sources; one hauler; reserver only for reserved plans.
 */
export function remoteSurvivalQuotas(
  plan: RemotePlan | string | undefined,
  sources: number,
): RemoteQuotas {
  const p = parseRemotePlan(typeof plan === "string" ? plan : undefined);
  if (p === "off") {
    return { remoteMiner: 0, remoteHauler: 0, reserver: 0 };
  }
  return {
    remoteMiner: Math.max(1, sources),
    remoteHauler: 1,
    reserver: remotePlanNeedsReserve(p) ? 1 : 0,
  };
}

/**
 * Home gates for spawning remotes (sim + live).
 * Expansion requires storage floor; restaff (survival refill) ignores floor.
 */
export function remoteSpawnGatesOk(opts: {
  rcl: number;
  storageEnergy: number;
  plan: RemotePlan | string | undefined;
  storageFloor?: number;
  /** True: refill survival seats even under the storage floor. */
  restaff?: boolean;
}): boolean {
  if (!remotePlanIsActive(opts.plan)) return false;
  if (opts.rcl < 6) return false;
  if (opts.restaff === true) return true;
  return opts.storageEnergy >= (opts.storageFloor ?? 20_000);
}

/** First cardinal exit room name (N/E/S/W), if any. */
export function pickFirstExitRoom(homeName: string): string | undefined {
  const exits = Game.map.describeExits(homeName);
  if (!exits) return undefined;
  return exits["1"] ?? exits["3"] ?? exits["5"] ?? exits["7"];
}
