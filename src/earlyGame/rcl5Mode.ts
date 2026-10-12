import {
  storageBelowFloor,
  type CreepQuotas,
} from "./policy";

/** Home-room RCL4→5 spend experiments (no remotes). */
export const RCL5_MODES = [
  "hub_spend",
  "upgrade_rush",
  "fat_first",
  "build_heavy",
] as const;

export type Rcl5Mode = (typeof RCL5_MODES)[number];

/**
 * Post-hub RCL5→RCL6 plans (sticky; orthogonal to rcl5Mode quotas).
 * none/off = control (no links); link_boost = Storage↔Controller pipeline.
 * fat_first kept as alias of none for older sim CLI.
 */
export const RCL5_PLANS = ["none", "off", "fat_first", "link_boost"] as const;

export type Rcl5Plan = (typeof RCL5_PLANS)[number];

export function isRcl5Mode(raw: unknown): raw is Rcl5Mode {
  return typeof raw === "string" && (RCL5_MODES as readonly string[]).includes(raw);
}

export function isRcl5Plan(raw: unknown): raw is Rcl5Plan {
  return typeof raw === "string" && (RCL5_PLANS as readonly string[]).includes(raw);
}

/** Bench winner (rcl5-bench): upgrade_rush reaches RCL5 fastest home-only. */
export function parseRcl5Mode(raw?: string): Rcl5Mode {
  return isRcl5Mode(raw) ? raw : "upgrade_rush";
}

/** Default post-hub plan until link_boost wins a sim. */
export function parseRcl5Plan(raw?: string): Rcl5Plan {
  return isRcl5Plan(raw) ? raw : "none";
}

/** Place up to 2 links after hub-ready when plan is link_boost (not none/off). */
export function shouldPlaceRcl5Links(opts: {
  plan: Rcl5Plan | string | undefined;
  rcl: number;
  extensions: number;
  towers: number;
  /** Built links + open link construction sites. */
  linkCount: number;
}): boolean {
  // Do not use parseRcl5Plan here — "none" would otherwise fall through to fat_first.
  if (opts.plan !== "link_boost") return false;
  if (opts.rcl < 5) return false;
  if (opts.extensions < 30 || opts.towers < 2) return false;
  return opts.linkCount < 2;
}

/**
 * During link CAPEX, keep a builder wave; after both links built, leave quotas alone
 * (caller should already apply fat_first / mode quotas).
 */
export function applyRcl5PlanQuotas(
  quotas: CreepQuotas,
  plan: Rcl5Plan | string | undefined,
  opts: { linksBuilt: number; hasConstructionSites: boolean },
): CreepQuotas {
  if (plan !== "link_boost") return quotas;
  if (opts.linksBuilt >= 2) return quotas;
  return {
    ...quotas,
    upgrader: 1,
    builder: Math.max(3, opts.hasConstructionSites ? 3 : 2),
  };
}

/**
 * Sticky one-shot aftercare arm at RCL≥5.
 * Aftercare bench winner (2026-10-10): build_heavy finishes hub (tower#2 + ext→30)
 * fastest; climb default upgrade_rush stays for RCL4→5 only.
 * Returns the mode to write, or undefined when no change (already an explicit choice).
 */
export function maybeArmRcl5AftercareMode(
  rcl: number,
  currentMode: string | undefined,
): Rcl5Mode | undefined {
  if (rcl < 5) return undefined;
  if (currentMode === undefined || currentMode === "" || currentMode === "upgrade_rush") {
    return "build_heavy";
  }
  return undefined;
}

/**
 * After hub-ready (ext≥30 ∧ towers≥2), switch aftercare build_heavy → fat_first.
 * Wave-2 bench (2026-10-10): fat_first hit RCL6 @~155k with storage floor;
 * upgrade_rush drained storage to 0 and never finished in 160k.
 */
export function maybeArmRcl5PostHubMode(
  rcl: number,
  currentMode: string | undefined,
  opts: { extensions: number; towers: number },
): Rcl5Mode | undefined {
  if (rcl < 5) return undefined;
  if (opts.extensions < 30 || opts.towers < 2) return undefined;
  if (currentMode === "build_heavy") return "fat_first";
  return undefined;
}

/**
 * Post-RCL6 spend (rcl6-spend bench 2026-10-11, 5k ticks):
 * with remotes on, upgrade_rush beats fat_first on netStorage and progress
 * while floorOk. Never arm when remotePlan is explicitly off (home-only
 * upgrade_rush blackout risk from Wave-2). Never arm under storage floor.
 */
export function maybeArmRcl6SpendMode(
  rcl: number,
  currentMode: string | undefined,
  opts: { remotePlan?: string; storageEnergy?: number },
): Rcl5Mode | undefined {
  if (rcl < 6) return undefined;
  const remote = opts.remotePlan;
  if (remote === "off" || remote === "home_only") return undefined;
  if (
    storageBelowFloor({
      rcl,
      hasStorage: true,
      storageEnergy: opts.storageEnergy ?? 0,
    })
  ) {
    return undefined;
  }
  if (currentMode === "upgrade_rush") return undefined;
  if (currentMode === "fat_first") return "upgrade_rush";
  return undefined;
}

/**
 * Drop upgrade_rush → fat_first when storage hits the blackout floor so
 * remotes-on spend cannot re-drain into a T1 spiral (live / Wave-2).
 */
export function maybeDisarmRcl6SpendMode(
  rcl: number,
  currentMode: string | undefined,
  opts: { remotePlan?: string; storageEnergy?: number },
): Rcl5Mode | undefined {
  if (rcl < 6) return undefined;
  if (currentMode !== "upgrade_rush") return undefined;
  const remote = opts.remotePlan;
  if (remote === "off" || remote === "home_only") return undefined;
  if (
    !storageBelowFloor({
      rcl,
      hasStorage: true,
      storageEnergy: opts.storageEnergy ?? 0,
    })
  ) {
    return undefined;
  }
  return "fat_first";
}

/**
 * After hub-ready, arm link_boost plan (gameplan confirm 2026-10-11:
 * RCL6 @132k vs no-links ETA ~173k). Skip explicit none/off control arms.
 */
export function maybeArmRcl5PostHubPlan(
  rcl: number,
  currentPlan: string | undefined,
  opts: { extensions: number; towers: number },
): Rcl5Plan | undefined {
  if (rcl < 5) return undefined;
  if (opts.extensions < 30 || opts.towers < 2) return undefined;
  if (currentPlan === "none" || currentPlan === "off") return undefined;
  if (currentPlan === "link_boost") return undefined;
  return "link_boost";
}

/**
 * After storage exists at RCL4+, reshape quotas for the RCL5 climb experiment.
 * Remotes are intentionally out of scope — home controller is the sink.
 */
export function applyRcl5ModeQuotas(
  quotas: CreepQuotas,
  mode: Rcl5Mode,
  opts: {
    rcl: number;
    hasStorage: boolean;
    hasConstructionSites: boolean;
    minerWorkParts: number;
    sources: number;
    /** Finished + site extensions — gates early-RCL5 hub wave. */
    extensionCount?: number;
    /** Built + site towers. */
    towerCount?: number;
    /** Built + site links — gates link CAPEX wave. */
    linkCount?: number;
    /** Post-hub plan: link_boost briefly prioritizes builders until 2 links. */
    rcl5Plan?: string;
    /** Storage energy — below floor throttles upgrade/builder spend. */
    storageEnergy?: number;
  },
): CreepQuotas {
  if (opts.rcl < 4 || !opts.hasStorage) return quotas;
  const q: CreepQuotas = { ...quotas, filler: Math.max(1, quotas.filler) };

  // Just hit RCL5: finish tower#2 + ext→30 before full upgrade pressure.
  // Aftercare bench winner (2026-10-10): build_heavy hub@~6.6k vs upgrade_rush ~10k.
  // Do NOT require open sites — a 0-site gap between finishes must not drop builders
  // or skip the hub wave (live stall at ~23 ext / 0 sites).
  const hubIncomplete =
    opts.rcl >= 5 &&
    ((opts.extensionCount ?? 0) < 30 || (opts.towerCount ?? 0) < 2);

  // Blackout floor: keep one upgrader + at most one hub builder; never 4× upgrade.
  // Only when storageEnergy is known (spawn always passes it).
  if (
    opts.storageEnergy !== undefined &&
    storageBelowFloor({
      rcl: opts.rcl,
      hasStorage: opts.hasStorage,
      storageEnergy: opts.storageEnergy,
    })
  ) {
    q.upgrader = 1;
    q.builder = hubIncomplete ? 1 : 0;
    return q;
  }

  if (hubIncomplete) {
    q.upgrader = 1;
    q.builder = 4;
    return q;
  }

  // Link CAPEX quotas live in applyRcl5PlanQuotas (spawn) — mode quotas stay here.

  switch (mode) {
    case "upgrade_rush":
      q.upgrader = 4;
      q.builder = opts.hasConstructionSites ? 1 : 0;
      return q;
    case "fat_first": {
      const fatEnough =
        opts.minerWorkParts >= Math.max(1, opts.sources) * 5;
      q.upgrader = fatEnough ? 3 : 1;
      q.builder = opts.hasConstructionSites ? 1 : 0;
      return q;
    }
    case "build_heavy":
      q.upgrader = 1;
      q.builder = opts.hasConstructionSites ? 4 : 0;
      return q;
    case "hub_spend":
    default:
      q.upgrader = Math.max(2, q.upgrader);
      if (opts.hasConstructionSites) {
        q.builder = Math.min(2, Math.max(1, q.builder));
      }
      return q;
  }
}

/** upgrade_rush / fat_first: do not spam new extension/road sites. */
export function rcl5ModePausesExtensionSpam(mode: Rcl5Mode): boolean {
  return mode === "upgrade_rush" || mode === "fat_first";
}
