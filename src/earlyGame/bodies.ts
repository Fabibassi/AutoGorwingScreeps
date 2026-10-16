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

/**
 * Stationary source miner: max WORK + a single MOVE to walk spawn→container.
 * Extra MOVE parts are wasted once the creep sits on the mining seat.
 */
export function buildMinerBody(
  energyAvailable: number,
  opts?: { minWork?: number; maxWork?: number },
): BodyPartConstant[] {
  const workCost = PART_COST.work;
  const moveCost = PART_COST.move;
  const minWork = Math.max(1, opts?.minWork ?? 1);
  const maxWork = Math.min(5, opts?.maxWork ?? 5);
  const minCost = minWork * workCost + moveCost;
  if (energyAvailable < minCost) return [];

  let workParts = minWork;
  let remaining = energyAvailable - minCost;
  while (workParts < maxWork && remaining >= workCost) {
    workParts++;
    remaining -= workCost;
  }

  const body: BodyPartConstant[] = [];
  for (let i = 0; i < workParts; i++) body.push("work");
  body.push("move");
  return body;
}

/**
 * Home hauler body cap (spend bench 2026-10-16): 6×CARRY+MOVE.
 * Full RCL5 bodies (~1800) were the largest spawn bill and did not raise
 * upgrade rate. Seat count stays on the mining formula.
 */
export const HAULER_BODY_BUDGET = 600;

/** Emergency recovery stays at 100. Experiments may set a tighter cap. */
export function homeHaulerBodyBudget(opts: {
  emergency: boolean;
  experimentMax?: number;
  override?: number;
}): number {
  if (opts.emergency) return 100;
  const budget = opts.override ?? HAULER_BODY_BUDGET;
  if (opts.experimentMax != null) return Math.min(opts.experimentMax, budget);
  return budget;
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
  opts?: {
    haulerMaxCost?: number;
    /** Cap filler CARRY+MOVE budget (default 300 thin). */
    fillerMaxCost?: number;
    minerMinWork?: number;
    /** Cap WORK when bridging (e.g. 1W only — do not grow into 2–4W mid bodies). */
    minerMaxWork?: number;
  },
): BodyPartConstant[] {
  switch (role) {
    case "miner":
      return buildMinerBody(energyAvailable, {
        minWork: opts?.minerMinWork,
        maxWork: opts?.minerMaxWork,
      });
    case "hauler":
      return buildHaulerBody(energyAvailable, {
        maxCost: opts?.haulerMaxCost,
      });
    case "filler":
      return buildHaulerBody(energyAvailable, {
        maxCost: opts?.fillerMaxCost ?? 300,
      });
    case "builder":
    case "harvester":
    case "upgrader":
      return buildWorkerBody(energyAvailable);
    default:
      return ["work", "carry", "move"];
  }
}
