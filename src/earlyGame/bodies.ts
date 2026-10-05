import type { CreepQuotas } from "./policy";

/** Body-part costs (mirrors Screeps BODYPART_COST for testable pure logic). */
const PART_COST: Record<BodyPartConstant, number> = {
  move: 50,
  work: 100,
  carry: 50,
  attack: 80,
  ranged_attack: 150,
  tough: 10,
  heal: 250,
  claim: 600,
};

export function buildMinerBody(energyAvailable: number): BodyPartConstant[] {
  const pairCost = PART_COST.work + PART_COST.move;
  const body: BodyPartConstant[] = [];
  let remaining = energyAvailable;
  while (
    remaining >= pairCost &&
    body.filter((p) => p === "work").length < 5
  ) {
    body.push("work", "move");
    remaining -= pairCost;
  }
  if (body.length === 0 && energyAvailable >= pairCost) {
    return ["work", "move"];
  }
  return body;
}

export function buildHaulerBody(
  energyAvailable: number,
  opts?: { maxCost?: number },
): BodyPartConstant[] {
  const pairCost = PART_COST.carry + PART_COST.move;
  const budget =
    opts?.maxCost != null
      ? Math.min(energyAvailable, opts.maxCost)
      : energyAvailable;
  const body: BodyPartConstant[] = [];
  let remaining = budget;
  while (remaining >= pairCost) {
    body.push("carry", "move");
    remaining -= pairCost;
  }
  if (body.length === 0 && budget >= pairCost) {
    return ["carry", "move"];
  }
  // Never spawn CARRY-only: without MOVE the hauler cannot reach storage/containers
  // unless it lucks onto the exact adjacent tile. Soft-lock waits for spawn regen
  // to 100 (1 energy/tick) then spawns a real CARRY+MOVE hauler.
  return body;
}

export function buildWorkerBody(energyAvailable: number): BodyPartConstant[] {
  const unit = PART_COST.work + PART_COST.carry + PART_COST.move;
  if (energyAvailable >= unit) {
    const repeats = Math.floor(energyAvailable / unit);
    const body: BodyPartConstant[] = [];
    for (let i = 0; i < repeats; i++) {
      body.push("work", "carry", "move");
    }
    return body;
  }
  // Do NOT spawn WORK+MOVE: zero CARRY means store capacity 0, so harvesters
  // never call harvest() and cannot refill spawn. Soft-lock recovery uses haulers
  // (CARRY+MOVE @ 100) until a full WORK+CARRY+MOVE worker is affordable.
  return [];
}

export function bodyForRole(
  role: keyof CreepQuotas,
  energyAvailable: number,
  opts?: { haulerMaxCost?: number },
): BodyPartConstant[] {
  switch (role) {
    case "miner":
      return buildMinerBody(energyAvailable);
    case "hauler":
      return buildHaulerBody(energyAvailable, {
        maxCost: opts?.haulerMaxCost,
      });
    case "builder":
    case "harvester":
    case "upgrader":
      return buildWorkerBody(energyAvailable);
    default:
      return ["work", "carry", "move"];
  }
}
