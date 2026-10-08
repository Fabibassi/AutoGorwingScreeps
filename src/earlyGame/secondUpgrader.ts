/**
 * Pure gate for when a colony should want a 2nd upgrader (RCL2–4 home climb).
 * Inspired by Overmind/International surplus gates — not wired into desiredCreeps yet;
 * overnight `upgraderQuota` 1/2/3 decides the static baseline first.
 */

export type SecondUpgraderInput = {
  rcl: number;
  sourceCount: number;
  containersAtSources: number;
  /** Open non-road construction pressure (true → prefer builders). */
  hasConstructionSites: boolean;
  economyDepressed: boolean;
  /** Energy in finished source containers (optional surplus signal). */
  sourceContainerEnergy?: number;
  /** Min energy in source containers before allowing a 2nd upgrader. */
  surplusEnergyThreshold?: number;
};

/**
 * Floor is always 1 at RCL≥2 (handled elsewhere). This answers only: want 2?
 *
 * Rules (International/Overmind-shaped):
 * - Need both source containers finished
 * - No open construction sites (builders win) unless surplus is huge
 * - Not economy-depressed
 * - Optional: source-container energy ≥ threshold (default 1000)
 */
export function wantSecondUpgrader(input: SecondUpgraderInput): boolean {
  if (input.rcl < 2 || input.rcl >= 8) return false;
  if (input.economyDepressed) return false;
  const sources = Math.max(1, input.sourceCount);
  if (input.containersAtSources < sources) return false;

  const threshold = input.surplusEnergyThreshold ?? 1000;
  const energy = input.sourceContainerEnergy ?? 0;
  const fatSurplus = energy >= threshold * 2;

  if (input.hasConstructionSites && !fatSurplus) return false;
  if (input.sourceContainerEnergy != null && energy < threshold) return false;
  return true;
}
