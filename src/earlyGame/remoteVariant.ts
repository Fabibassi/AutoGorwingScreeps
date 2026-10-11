/**
 * Tunings on top of remotePlan=reserved_drop (post-bakeoff variations).
 */

export const REMOTE_VARIANTS = [
  "baseline",
  "fat_hauler",
  "thin_hauler",
  "lean_haul",
  "fat_haul",
  "fat_miner",
  "dual_claim",
] as const;

export type RemoteVariant = (typeof REMOTE_VARIANTS)[number];

/** Best variant after reserved_drop tune campaign (updated after sims). */
export const REMOTE_VARIANT_WINNER: RemoteVariant = "baseline";

export function isRemoteVariant(raw: unknown): raw is RemoteVariant {
  return (
    typeof raw === "string" &&
    (REMOTE_VARIANTS as readonly string[]).includes(raw)
  );
}

export function parseRemoteVariant(raw?: string): RemoteVariant {
  return isRemoteVariant(raw) ? raw : "baseline";
}

export interface RemoteVariantTuning {
  haulerMaxCost: number;
  /** Multiply analytical hauler quota (then ceil, min 1). */
  haulerQuotaScale: number;
  minerMinWork: number;
  minerMaxCost: number;
  /** CLAIM parts on reserver (1 or 2). */
  claimParts: number;
}

export function tuningForRemoteVariant(
  variant: RemoteVariant | string | undefined,
): RemoteVariantTuning {
  switch (parseRemoteVariant(
    typeof variant === "string" ? variant : undefined,
  )) {
    case "fat_hauler":
      return {
        haulerMaxCost: 900,
        haulerQuotaScale: 1,
        minerMinWork: 5,
        minerMaxCost: 800,
        claimParts: 1,
      };
    case "thin_hauler":
      return {
        haulerMaxCost: 300,
        haulerQuotaScale: 1,
        minerMinWork: 5,
        minerMaxCost: 800,
        claimParts: 1,
      };
    case "lean_haul":
      return {
        haulerMaxCost: 600,
        haulerQuotaScale: 0.7,
        minerMinWork: 5,
        minerMaxCost: 800,
        claimParts: 1,
      };
    case "fat_haul":
      return {
        haulerMaxCost: 600,
        haulerQuotaScale: 1.3,
        minerMinWork: 5,
        minerMaxCost: 800,
        claimParts: 1,
      };
    case "fat_miner":
      return {
        haulerMaxCost: 600,
        haulerQuotaScale: 1,
        minerMinWork: 6,
        minerMaxCost: 950,
        claimParts: 1,
      };
    case "dual_claim":
      return {
        haulerMaxCost: 600,
        haulerQuotaScale: 1,
        minerMinWork: 5,
        minerMaxCost: 800,
        claimParts: 2,
      };
    case "baseline":
    default:
      return {
        haulerMaxCost: 600,
        haulerQuotaScale: 1,
        minerMinWork: 5,
        minerMaxCost: 800,
        claimParts: 1,
      };
  }
}
