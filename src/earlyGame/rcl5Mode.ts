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
  },
): CreepQuotas {
  if (opts.rcl < 4 || !opts.hasStorage) return quotas;
  const q: CreepQuotas = { ...quotas, filler: Math.max(1, quotas.filler) };

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
