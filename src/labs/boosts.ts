/**
 * Basic lab boosts: park creep next to a lab holding the right compound.
 * Reactions deferred — we only apply minerals already in labs/terminal.
 */

/** Upgrade boost chain (best → ok). */
export const UPGRADE_BOOSTS = ["XGH2O", "GH2O", "GH"] as const;
/** Build boost chain. */
export const BUILD_BOOSTS = ["XLH2O", "LH2O", "LH"] as const;
/** Attack boost chain. */
export const ATTACK_BOOSTS = ["XUH2O", "UH2O", "UH"] as const;

export type BoostKind = "upgrade" | "build" | "attack";

export function boostsForKind(kind: BoostKind): readonly string[] {
  if (kind === "upgrade") return UPGRADE_BOOSTS;
  if (kind === "build") return BUILD_BOOSTS;
  return ATTACK_BOOSTS;
}

export function bodyPartForBoost(kind: BoostKind): BodyPartConstant {
  if (kind === "upgrade" || kind === "build") return "work";
  return "attack";
}

/** True when creep still has unboosted parts of the relevant type. */
export function creepNeedsBoost(creep: Creep, kind: BoostKind): boolean {
  const part = bodyPartForBoost(kind);
  for (const p of creep.body) {
    if (p.type === part && !p.boost) return true;
  }
  return false;
}

/**
 * Pick best available boost mineral from lab stores (and optionally terminal).
 */
export function pickAvailableBoost(
  kind: BoostKind,
  stores: Array<{ [key: string]: number | undefined }>,
): string | null {
  for (const mineral of boostsForKind(kind)) {
    for (const store of stores) {
      if ((store[mineral] ?? 0) >= 30) return mineral;
    }
  }
  return null;
}

export function shouldOfferBoosts(opts: {
  labCount: number;
  storageEnergy: number;
  floor: number;
}): boolean {
  if (opts.labCount < 1) return false;
  return opts.storageEnergy > opts.floor;
}
