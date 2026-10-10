import type { CreepQuotas } from "./policy";

/** Home-room RCL4→5 spend experiments (no remotes). */
export const RCL5_MODES = [
  "hub_spend",
  "upgrade_rush",
  "fat_first",
  "build_heavy",
] as const;

export type Rcl5Mode = (typeof RCL5_MODES)[number];

export function isRcl5Mode(raw: unknown): raw is Rcl5Mode {
  return typeof raw === "string" && (RCL5_MODES as readonly string[]).includes(raw);
}

/** Bench winner (rcl5-bench): upgrade_rush reaches RCL5 fastest home-only. */
export function parseRcl5Mode(raw?: string): Rcl5Mode {
  return isRcl5Mode(raw) ? raw : "upgrade_rush";
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
  },
): CreepQuotas {
  if (opts.rcl < 4 || !opts.hasStorage) return quotas;
  const q: CreepQuotas = { ...quotas, filler: Math.max(1, quotas.filler) };

  // Just hit RCL5: finish tower#2 + ext→30 before full upgrade pressure.
  // Aftercare bench winner (2026-10-10): build_heavy hub@~6.6k vs upgrade_rush ~10k.
  const hubIncomplete =
    opts.rcl >= 5 &&
    opts.hasConstructionSites &&
    ((opts.extensionCount ?? 0) < 30 || (opts.towerCount ?? 0) < 2);

  if (hubIncomplete) {
    q.upgrader = 1;
    q.builder = 4;
    return q;
  }

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
