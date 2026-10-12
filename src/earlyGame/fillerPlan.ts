/** Hub filler sizing / count (orthogonal to rcl5Mode / rcl5Plan). */

export const FILLER_PLANS = ["thin", "fat", "duo_fat"] as const;

export type FillerPlan = (typeof FILLER_PLANS)[number];

export function isFillerPlan(raw: unknown): raw is FillerPlan {
  return typeof raw === "string" && (FILLER_PLANS as readonly string[]).includes(raw);
}

/**
 * Production default = fat.
 * Sim hub-bench preferred thin on floorOk, but live home softlocks with
 * thin (hub energyAvailable≈160 while storage≫100k) — fat refill needed.
 */
export function parseFillerPlan(raw?: string): FillerPlan {
  return isFillerPlan(raw) ? raw : "fat";
}

/**
 * After hub-ready, sticky-arm fat (live softlock override). Skip explicit
 * thin/duo_fat so sims can still A/B those plans.
 */
export function maybeArmFillerPlanPostHub(
  rcl: number,
  currentPlan: string | undefined,
  opts: { extensions: number; towers: number },
): FillerPlan | undefined {
  if (rcl < 5) return undefined;
  if (opts.extensions < 30 || opts.towers < 2) return undefined;
  if (currentPlan === "thin" || currentPlan === "duo_fat") return undefined;
  if (currentPlan === "fat") return undefined;
  return "fat";
}

export function fillerQuotaForPlan(plan: FillerPlan | string | undefined): number {
  switch (parseFillerPlan(typeof plan === "string" ? plan : undefined)) {
    case "duo_fat":
      return 2;
    case "fat":
    case "thin":
    default:
      return 1;
  }
}

/**
 * Body cost cap for filler CARRY+MOVE pairs.
 * thin = early softlock-safe 300; fat/duo = 800 (8C8M) for RCL5 hub refill.
 */
export function fillerMaxCostForPlan(
  plan: FillerPlan | string | undefined,
): number {
  switch (parseFillerPlan(typeof plan === "string" ? plan : undefined)) {
    case "fat":
    case "duo_fat":
      return 800;
    case "thin":
    default:
      return 300;
  }
}

/**
 * Fat-filler upgrade deferral. NEVER defer when the hub has zero fillers —
 * that softlocks (need filler to refill spawn to afford a fat body).
 */
export function shouldDeferFatFillerSpawn(opts: {
  fillerMaxCost: number;
  energyAvailable: number;
  liveFillerCount: number;
  midFillerCount: number;
  roleWant: number;
}): boolean {
  if (opts.fillerMaxCost <= 300) return false;
  if (opts.liveFillerCount <= 0) return false;
  if (opts.energyAvailable < 400) return true;
  if (
    opts.midFillerCount >= opts.roleWant &&
    opts.energyAvailable < opts.fillerMaxCost
  ) {
    return true;
  }
  return false;
}
