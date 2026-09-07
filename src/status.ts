import { desiredCreeps, countCreepsByRole, getSpawnPriority, type SpawnPriority } from "./spawn";
import type { AgsMemory } from "./types";

export const STATUS_LOG_INTERVAL = 20;

export type { SpawnPriority };

export interface PlanSnapshot {
  tick: number;
  rcl: number;
  spawnEnergy: number;
  spawnCapacity: number;
  creepEnergy: number;
  harvesters: number;
  upgraders: number;
  wantHarvesters: number;
  wantUpgraders: number;
  priority: SpawnPriority;
  energyIncomePerTick: number;
}

export function creepEnergyTotal(): number {
  let total = 0;
  for (const name in Game.creeps) {
    total += Game.creeps[name].store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  }
  return total;
}

export function formatPriority(priority: SpawnPriority): string {
  if (priority.kind === "spawning") return `spawn:${priority.role} (busy)`;
  if (priority.kind === "spawn") return `spawn:${priority.role}`;
  return "maintain (harvest/upgrade)";
}

export function buildPlanSnapshot(
  room: Room,
  spawn: StructureSpawn | undefined,
  ags: AgsMemory | undefined,
): PlanSnapshot {
  const rcl = room.controller?.level ?? 1;
  const want = desiredCreeps(rcl);
  const counts = countCreepsByRole();
  const priority = spawn ? getSpawnPriority(spawn) : { kind: "maintain" as const };

  return {
    tick: Game.time,
    rcl,
    spawnEnergy: spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    spawnCapacity: spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 0,
    creepEnergy: creepEnergyTotal(),
    harvesters: counts.harvester,
    upgraders: counts.upgrader,
    wantHarvesters: want.harvester,
    wantUpgraders: want.upgrader,
    priority,
    energyIncomePerTick: ags?.metrics.energyIncomePerTick ?? 0,
  };
}

export function formatPlanStatus(snapshot: PlanSnapshot): string {
  const priority = formatPriority(snapshot.priority);
  return (
    `[T${snapshot.tick}] RCL${snapshot.rcl} | ` +
    `energy spawn=${snapshot.spawnEnergy}/${snapshot.spawnCapacity} creeps=${snapshot.creepEnergy} | ` +
    `H:${snapshot.harvesters}/${snapshot.wantHarvesters} U:${snapshot.upgraders}/${snapshot.wantUpgraders} | ` +
    `priority=${priority} | income=${snapshot.energyIncomePerTick.toFixed(1)}/t`
  );
}

export function logPlanStatusIfDue(
  room: Room | undefined,
  ags: AgsMemory | undefined,
  interval: number = STATUS_LOG_INTERVAL,
): void {
  if (!room || Game.time % interval !== 0) return;

  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const snapshot = buildPlanSnapshot(room, spawn, ags);
  console.log(formatPlanStatus(snapshot));
}
