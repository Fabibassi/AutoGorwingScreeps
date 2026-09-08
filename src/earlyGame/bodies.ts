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
  const body: BodyPartConstant[] = [];
  let remaining = energyAvailable;
  while (
    remaining >= PART_COST.work + PART_COST.move &&
    body.filter((p) => p === "work").length < 5
  ) {
    body.push("work", "move");
    remaining -= PART_COST.work + PART_COST.move;
  }
  if (body.length === 0) {
    return ["work", "move"];
  }
  return body;
}

export function buildHaulerBody(energyAvailable: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  let remaining = energyAvailable;
  while (remaining >= PART_COST.carry + PART_COST.move) {
    body.push("carry", "move");
    remaining -= PART_COST.carry + PART_COST.move;
  }
  if (body.length === 0) {
    return ["carry", "move"];
  }
  return body;
}

export function buildWorkerBody(energyAvailable: number): BodyPartConstant[] {
  const unit = PART_COST.work + PART_COST.carry + PART_COST.move;
  const repeats = Math.max(1, Math.floor(energyAvailable / unit));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < repeats; i++) {
    body.push("work", "carry", "move");
  }
  return body;
}

export function bodyForRole(
  role: keyof CreepQuotas,
  energyAvailable: number,
): BodyPartConstant[] {
  switch (role) {
    case "miner":
      return buildMinerBody(energyAvailable);
    case "hauler":
      return buildHaulerBody(energyAvailable);
    case "builder":
    case "harvester":
    case "upgrader":
      return buildWorkerBody(energyAvailable);
    default:
      return ["work", "carry", "move"];
  }
}
