/**
 * Bodies for remote roles (kept separate from CreepQuotas home roles).
 */
import type { RemoteVariantTuning } from "./remoteVariant";

const PART_COST: Record<string, number> = {
  move: 50,
  work: 100,
  carry: 50,
  claim: 600,
};

export function buildRemoteMinerBody(
  energyAvailable: number,
  tuning: Pick<RemoteVariantTuning, "minerMinWork" | "minerMaxCost">,
): BodyPartConstant[] {
  const workCost = PART_COST.work;
  const moveCost = PART_COST.move;
  const minWork = Math.max(1, tuning.minerMinWork);
  // Remote miners need MOVE to travel — keep 1 MOVE + optional extra MOVE pairs budget.
  const budget = Math.min(energyAvailable, tuning.minerMaxCost);
  const minCost = minWork * workCost + moveCost;
  if (budget < minCost) return [];

  let workParts = minWork;
  let remaining = budget - minCost;
  const maxWork = 6;
  while (workParts < maxWork && remaining >= workCost) {
    workParts++;
    remaining -= workCost;
  }
  // Spend leftover on MOVE for travel (not stationary home miner).
  let moveParts = 1;
  while (remaining >= moveCost && moveParts < workParts) {
    moveParts++;
    remaining -= moveCost;
  }

  const body: BodyPartConstant[] = [];
  for (let i = 0; i < workParts; i++) body.push("work");
  for (let i = 0; i < moveParts; i++) body.push("move");
  return body;
}

export function buildRemoteHaulerBody(
  energyAvailable: number,
  tuning: Pick<RemoteVariantTuning, "haulerMaxCost">,
): BodyPartConstant[] {
  const pairCost = PART_COST.carry + PART_COST.move;
  const budget = Math.min(energyAvailable, tuning.haulerMaxCost);
  const body: BodyPartConstant[] = [];
  let remaining = budget;
  while (remaining >= pairCost) {
    body.push("carry", "move");
    remaining -= pairCost;
  }
  return body;
}

export function buildReserverBody(
  energyAvailable: number,
  tuning: Pick<RemoteVariantTuning, "claimParts">,
): BodyPartConstant[] {
  const claims = Math.max(1, Math.min(2, tuning.claimParts));
  const cost = claims * PART_COST.claim + PART_COST.move;
  if (energyAvailable < cost) return [];
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < claims; i++) body.push("claim");
  body.push("move");
  return body;
}
