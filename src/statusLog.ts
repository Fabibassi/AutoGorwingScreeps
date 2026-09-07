import { desiredCreeps } from "./spawn";

export const STATUS_LOG_INTERVAL = 20;

export interface CreepCounts {
  harvester: number;
  upgrader: number;
}

export interface EnergySnapshot {
  spawn: number;
  creeps: number;
}

/** What the colony is focused on this tick. */
export type PlanPriority =
  | "spawn:harvester"
  | "spawn:upgrader"
  | "spawn:busy"
  | "harvest+upgrade";

export function countCreepsByRole(): CreepCounts {
  const counts = { harvester: 0, upgrader: 0 };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role;
    if (role === "harvester") counts.harvester++;
    else if (role === "upgrader") counts.upgrader++;
  }
  return counts;
}

export function getEnergySnapshot(): EnergySnapshot {
  let spawn = 0;
  let creeps = 0;
  for (const name in Game.spawns) {
    spawn += Game.spawns[name].store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  }
  for (const name in Game.creeps) {
    creeps += Game.creeps[name].store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  }
  return { spawn, creeps };
}

export function getPlanPriority(
  rcl: number,
  counts: CreepCounts,
  spawnBusy: boolean,
): PlanPriority {
  if (spawnBusy) return "spawn:busy";
  const want = desiredCreeps(rcl);
  if (counts.harvester < want.harvester) return "spawn:harvester";
  if (counts.upgrader < want.upgrader) return "spawn:upgrader";
  return "harvest+upgrade";
}

export function formatStatusLine(opts: {
  tick: number;
  rcl: number;
  energy: EnergySnapshot;
  counts: CreepCounts;
  priority: PlanPriority;
}): string {
  const { tick, rcl, energy, counts, priority } = opts;
  return (
    `[t${tick}] RCL${rcl} | energy spawn=${energy.spawn} creeps=${energy.creeps} | ` +
    `H=${counts.harvester} U=${counts.upgrader} | plan=${priority}`
  );
}

export function isSpawnBusy(): boolean {
  for (const name in Game.spawns) {
    if (Game.spawns[name].spawning) return true;
  }
  return false;
}

export function maybeLogStatus(tick: number, rcl: number): void {
  if (tick % STATUS_LOG_INTERVAL !== 0) return;
  const counts = countCreepsByRole();
  const energy = getEnergySnapshot();
  const priority = getPlanPriority(rcl, counts, isSpawnBusy());
  console.log(formatStatusLine({ tick, rcl, energy, counts, priority }));
}
