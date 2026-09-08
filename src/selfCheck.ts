import {
  desiredCreeps,
  useDedicatedMiners,
  type CreepQuotas,
} from "./earlyGame";
import {
  countCreepsByRole,
  countSourceContainers,
  hasControllerContainer,
} from "./room/queries";
import type { AgsHealthCheck, AgsMemory } from "./types";

export const SELF_CHECK_INTERVAL = 100;

export interface HealthCheckInput {
  tick: number;
  rcl: number;
  sourceCount: number;
  containersAtSources: number;
  hasControllerContainer: boolean;
  constructionSites: number;
  counts: CreepQuotas;
  want: CreepQuotas;
  spawnEnergy: number;
  spawnCapacity: number;
  dedicatedMiners: boolean;
}

/** Pure health snapshot from colony inputs (testable without Screeps globals). */
export function computeHealthCheck(input: HealthCheckInput): AgsHealthCheck {
  const understaffed: string[] = [];
  let creepDeficit = 0;
  for (const role of Object.keys(input.want) as Array<keyof CreepQuotas>) {
    const gap = input.want[role] - input.counts[role];
    if (gap > 0) {
      understaffed.push(role);
      creepDeficit += gap;
    }
  }

  const spawnCapacity = input.spawnCapacity > 0 ? input.spawnCapacity : 1;

  return {
    tick: input.tick,
    rcl: input.rcl,
    creepDeficit,
    understaffed,
    containersAtSources: input.containersAtSources,
    sourceCount: input.sourceCount,
    dedicatedMiners: input.dedicatedMiners,
    spawnFillPct: input.spawnEnergy / spawnCapacity,
    hasControllerContainer: input.hasControllerContainer,
    constructionSites: input.constructionSites,
  };
}

export function buildHealthCheck(
  room: Room,
  spawn: StructureSpawn | undefined,
  ags?: AgsMemory,
): AgsHealthCheck {
  const rcl = room.controller?.level ?? 1;
  const sourceCount = room.find(FIND_SOURCES).length;
  const containersAtSources = countSourceContainers(room);
  const constructionSites = room.find(FIND_CONSTRUCTION_SITES).length;
  const hasConstructionSites = constructionSites > 0;
  const spawnCapacity = spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 1;
  const spawnFillPct =
    (spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) / spawnCapacity;
  const want = desiredCreeps(
    rcl,
    sourceCount,
    containersAtSources,
    hasConstructionSites,
    {
      energyIncomePerTick: ags?.metrics.energyIncomePerTick ?? 0,
      spawnFillPct,
    },
  );

  return computeHealthCheck({
    tick: Game.time,
    rcl,
    sourceCount,
    containersAtSources,
    hasControllerContainer: hasControllerContainer(room),
    constructionSites,
    counts: countCreepsByRole(),
    want,
    spawnEnergy: spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    spawnCapacity: spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 0,
    dedicatedMiners: useDedicatedMiners(rcl, containersAtSources, sourceCount),
  });
}

/** One-line health summary for console / metrics debugging. */
export function formatHealthCheck(health: AgsHealthCheck): string {
  if (
    health.creepDeficit === 0 &&
    health.containersAtSources >= health.sourceCount &&
    (health.hasControllerContainer || health.rcl < 2)
  ) {
    return "ok";
  }

  const parts: string[] = [];
  if (health.creepDeficit > 0) {
    parts.push(`deficit=${health.creepDeficit}(${health.understaffed.join(",")})`);
  }
  if (health.containersAtSources < health.sourceCount) {
    parts.push(
      `srcContainers=${health.containersAtSources}/${health.sourceCount}`,
    );
  }
  if (!health.hasControllerContainer && health.rcl >= 2) {
    parts.push("noCtrlContainer");
  }
  return parts.join(" ") || "ok";
}

/** Persist health snapshot on the same cadence as income windows. */
export function maybeUpdateHealthCheck(
  room: Room | undefined,
  ags: AgsMemory | undefined,
  interval: number = SELF_CHECK_INTERVAL,
): AgsMemory | undefined {
  if (!room || !ags || Game.time % interval !== 0) return ags;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  return { ...ags, health: buildHealthCheck(room, spawn, ags) };
}
