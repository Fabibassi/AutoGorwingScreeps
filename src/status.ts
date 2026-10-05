import {
  desiredCreeps,
  spawnPriorityOrder,
  useDedicatedMiners,
  type CreepQuotas,
} from "./earlyGame";
import { countCreepsByRole, countSourceContainers } from "./room/queries";
import { formatHealthCheck } from "./selfCheck";
import type { AgsMemory } from "./types";

export const STATUS_LOG_INTERVAL = 20;

export type SpawnPriority =
  | { kind: "spawning"; role: string }
  | { kind: "spawn"; role: string }
  | { kind: "maintain" };

export interface PlanSnapshot {
  tick: number;
  rcl: number;
  spawnEnergy: number;
  spawnCapacity: number;
  creepEnergy: number;
  counts: CreepQuotas;
  want: CreepQuotas;
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
  return "maintain";
}

export function inferSpawnPriority(
  spawn: StructureSpawn | undefined,
  counts: CreepQuotas,
  want: CreepQuotas,
  spawnOrder: Array<keyof CreepQuotas>,
): SpawnPriority {
  if (spawn?.spawning) {
    const role = spawn.spawning.name.split("-")[0] || "unknown";
    return { kind: "spawning", role };
  }
  for (const role of spawnOrder) {
    if (counts[role] < want[role]) return { kind: "spawn", role };
  }
  return { kind: "maintain" };
}

export function buildPlanSnapshot(
  room: Room,
  spawn: StructureSpawn | undefined,
  ags: AgsMemory | undefined,
): PlanSnapshot {
  const rcl = room.controller?.level ?? 1;
  const sourceCount = room.find(FIND_SOURCES).length;
  const containersAtSources = countSourceContainers(room);
  const hasConstructionSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;
  const spawnCapacity = spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 1;
  const spawnFillPct =
    (spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) / spawnCapacity;
  const economy = {
    energyIncomePerTick: ags?.metrics.energyIncomePerTick ?? 0,
    spawnFillPct,
    energyAvailable: room.energyAvailable,
  };
  const infrastructureDedicated = useDedicatedMiners(
    rcl,
    containersAtSources,
    sourceCount,
  );
  const want = desiredCreeps(
    rcl,
    sourceCount,
    containersAtSources,
    hasConstructionSites,
    economy,
  );
  const counts = countCreepsByRole();
  const spawnOrder = spawnPriorityOrder(
    infrastructureDedicated,
    economy,
    counts,
    room.energyAvailable,
  );
  const priority = inferSpawnPriority(spawn, counts, want, spawnOrder);

  return {
    tick: Game.time,
    rcl,
    spawnEnergy: spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    spawnCapacity: spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 0,
    creepEnergy: creepEnergyTotal(),
    counts,
    want,
    priority,
    energyIncomePerTick: ags?.metrics.energyIncomePerTick ?? 0,
  };
}

export function formatPlanStatus(
  snapshot: PlanSnapshot,
  healthSummary?: string,
): string {
  const { counts: c, want: w } = snapshot;
  const check =
    healthSummary && healthSummary !== "ok" ? ` | check=${healthSummary}` : "";
  return (
    `[T${snapshot.tick}] RCL${snapshot.rcl} | ` +
    `energy spawn=${snapshot.spawnEnergy}/${snapshot.spawnCapacity} creeps=${snapshot.creepEnergy} | ` +
    `H:${c.harvester}/${w.harvester} M:${c.miner}/${w.miner} Ha:${c.hauler}/${w.hauler} ` +
    `U:${c.upgrader}/${w.upgrader} B:${c.builder}/${w.builder} | ` +
    `priority=${formatPriority(snapshot.priority)} | ` +
    `income=${snapshot.energyIncomePerTick.toFixed(1)}/t${check}`
  );
}

export function logPlanStatusIfDue(
  room: Room | undefined,
  ags: AgsMemory | undefined,
  interval: number = STATUS_LOG_INTERVAL,
): void {
  if (!room || Game.time % interval !== 0) return;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const healthSummary = ags?.health ? formatHealthCheck(ags.health) : undefined;
  console.log(formatPlanStatus(buildPlanSnapshot(room, spawn, ags), healthSummary));
}
