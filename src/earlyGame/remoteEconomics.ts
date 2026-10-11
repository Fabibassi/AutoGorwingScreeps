/**
 * Analytical remote net-income model (Harabi / screepspl.us style).
 * Pure math — used to rank plans before / beside mockup sims.
 */

export type RemoteEconPlan =
  | "home_only"
  | "drop_unreserved"
  | "reserved_drop"
  | "reserved_container";

export interface RemoteEconInput {
  sources: number;
  /** One-way path length home storage ↔ remote source (tiles). */
  pathLength: number;
  plan: RemoteEconPlan;
  /** Miner body energy cost (default reserved 800 / unreserved 550). */
  minerCost?: number;
  /** Hauler body energy cost (default 300 = 3C3M). */
  haulerCost?: number;
  /** Reserver body energy cost (default 650 = 1CLAIM+1MOVE). */
  reserverCost?: number;
  /** Extra e/t for container repair when using containers (default 0.3). */
  containerRepairPerTick?: number;
  creepLife?: number;
  claimLife?: number;
}

export interface RemoteEconResult {
  plan: RemoteEconPlan;
  grossEnergyPerTick: number;
  minerCostPerTick: number;
  haulerCostPerTick: number;
  reserverCostPerTick: number;
  containerCostPerTick: number;
  netEnergyPerTick: number;
  spawnPartsPerTick: number;
  haulerCount: number;
}

const DEFAULT_CREEP_LIFE = 1500;
const DEFAULT_CLAIM_LIFE = 600;

export function isReservedPlan(plan: RemoteEconPlan): boolean {
  return plan === "reserved_drop" || plan === "reserved_container";
}

export function sourceEnergyPerTick(reserved: boolean): number {
  return reserved ? 10 : 5;
}

/** Round-trip haul time (move there + move back); intents ignored. */
export function haulRoundTripTicks(pathLength: number): number {
  return Math.max(2, 2 * Math.max(1, pathLength));
}

/**
 * Haulers needed so carry throughput ≥ source income (50 e per CARRY).
 * Assumes 3 CARRY hauler (150 capacity).
 */
export function haulersForIncome(
  grossPerTick: number,
  pathLength: number,
  carryPerHauler = 150,
): number {
  if (grossPerTick <= 0) return 0;
  const cycle = haulRoundTripTicks(pathLength);
  const throughput = carryPerHauler / cycle;
  return Math.max(1, Math.ceil(grossPerTick / throughput));
}

function effectiveLife(life: number, pathLength: number): number {
  // Travel to seat burns life; clamp so costs stay finite.
  return Math.max(50, life - pathLength);
}

export function evaluateRemoteEconomics(
  input: RemoteEconInput,
): RemoteEconResult {
  const plan = input.plan;
  if (plan === "home_only") {
    return {
      plan,
      grossEnergyPerTick: 0,
      minerCostPerTick: 0,
      haulerCostPerTick: 0,
      reserverCostPerTick: 0,
      containerCostPerTick: 0,
      netEnergyPerTick: 0,
      spawnPartsPerTick: 0,
      haulerCount: 0,
    };
  }

  const reserved = isReservedPlan(plan);
  const sources = Math.max(1, input.sources);
  const path = Math.max(1, input.pathLength);
  const creepLife = input.creepLife ?? DEFAULT_CREEP_LIFE;
  const claimLife = input.claimLife ?? DEFAULT_CLAIM_LIFE;
  const minerCost = input.minerCost ?? (reserved ? 800 : 550);
  const haulerCost = input.haulerCost ?? 300;
  const reserverCost = input.reserverCost ?? 650;
  const containerRepair =
    plan === "reserved_container"
      ? (input.containerRepairPerTick ?? 0.3)
      : 0;

  const gross = sources * sourceEnergyPerTick(reserved);
  const haulerCount = haulersForIncome(gross, path);
  const minerLife = effectiveLife(creepLife, path);
  const haulerLife = effectiveLife(creepLife, path);
  const resLife = effectiveLife(claimLife, path);

  const minerCostPerTick = (sources * minerCost) / minerLife;
  const haulerCostPerTick = (haulerCount * haulerCost) / haulerLife;
  const reserverCostPerTick = reserved ? reserverCost / resLife : 0;
  const containerCostPerTick = containerRepair * sources;

  const net =
    gross -
    minerCostPerTick -
    haulerCostPerTick -
    reserverCostPerTick -
    containerCostPerTick;

  // Rough spawn load: body parts amortized (miner ~7–9, hauler 6, reserver 2).
  const minerParts = reserved ? 8 : 6;
  const haulerParts = 6;
  const reserverParts = reserved ? 2 : 0;
  const spawnPartsPerTick =
    (sources * minerParts) / minerLife +
    (haulerCount * haulerParts) / haulerLife +
    reserverParts / (reserved ? resLife : 1);

  return {
    plan,
    grossEnergyPerTick: gross,
    minerCostPerTick,
    haulerCostPerTick,
    reserverCostPerTick,
    containerCostPerTick,
    netEnergyPerTick: net,
    spawnPartsPerTick,
    haulerCount,
  };
}

/** First distance where `plan` net drops below `home_only` (0), or null. */
export function breakEvenDistance(
  plan: RemoteEconPlan,
  opts?: Omit<RemoteEconInput, "pathLength" | "plan">,
): number | null {
  if (plan === "home_only") return null;
  const base = { sources: 2, ...opts, plan };
  for (let d = 1; d <= 400; d++) {
    const r = evaluateRemoteEconomics({ ...base, pathLength: d });
    if (r.netEnergyPerTick < 0) return d;
  }
  return null;
}

/** Rank plans at a fixed distance (best net first). */
export function rankRemotePlansAtDistance(
  pathLength: number,
  opts?: Omit<RemoteEconInput, "pathLength" | "plan">,
): RemoteEconResult[] {
  const plans: RemoteEconPlan[] = [
    "drop_unreserved",
    "reserved_drop",
    "reserved_container",
    "home_only",
  ];
  return plans
    .map((plan) =>
      evaluateRemoteEconomics({ sources: 2, ...opts, pathLength, plan }),
    )
    .sort((a, b) => b.netEnergyPerTick - a.netEnergyPerTick);
}
