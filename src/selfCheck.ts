import {
  desiredCreeps,
  effectiveDedicatedMiners,
  hasNoEconomyCreeps,
  isSoftLocked,
  type CreepQuotas,
} from "./earlyGame";
import {
  countCreepsByRole,
  countSourceContainers,
  hasControllerContainer,
} from "./room/queries";
import { isIncomeStalled } from "./telemetry";
import type { AgsHealthCheck, AgsMemory } from "./types";

export const SELF_CHECK_INTERVAL = 100;

/** Screeps CONTROLLER_DOWNGRADE ticks by RCL (mirror for tests / pure logic). */
export const CONTROLLER_DOWNGRADE_TICKS: Record<number, number> = {
  1: 20_000,
  2: 10_000,
  3: 20_000,
  4: 40_000,
  5: 80_000,
  6: 120_000,
  7: 150_000,
  8: 200_000,
};

/** Flag downgrade risk below this fraction of the RCL timer. */
export const DOWNGRADE_RISK_FRACTION = 0.25;

export type CriticalSignal =
  | "softLock"
  | "noEconomyCreeps"
  | "incomeCollapsed"
  | "downgradeRisk"
  | "noUpgraders";

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
  /** Room energyAvailable (spawn + extensions); used for soft-lock detection. */
  energyAvailable?: number;
  dedicatedMiners: boolean;
  energyIncomePerTick?: number;
  baselineIncome?: number;
  ticksToDowngrade?: number;
}

/** Pure: which critical colony failures are active. */
export function computeCriticalSignals(input: HealthCheckInput): CriticalSignal[] {
  const critical: CriticalSignal[] = [];
  const energyAvailable = input.energyAvailable ?? input.spawnEnergy;
  const noEconomy = hasNoEconomyCreeps(input.counts);

  if (isSoftLocked(energyAvailable, input.counts)) {
    critical.push("softLock");
  }
  if (noEconomy) critical.push("noEconomyCreeps");

  const income = input.energyIncomePerTick ?? 0;
  const incomeCollapsed =
    input.rcl >= 2 &&
    (income <= 0 || isIncomeStalled(income, input.baselineIncome));
  if (incomeCollapsed) critical.push("incomeCollapsed");

  const downgradeRisk = isDowngradeRisk(
    input.rcl,
    input.ticksToDowngrade,
    input.counts.upgrader,
  );
  if (downgradeRisk) critical.push("downgradeRisk");

  // Surface missing upgraders only when already in a failure mode (avoid spawn flicker).
  if (
    input.rcl >= 2 &&
    input.counts.upgrader === 0 &&
    (noEconomy || incomeCollapsed || downgradeRisk)
  ) {
    critical.push("noUpgraders");
  }

  return critical;
}

export function isDowngradeRisk(
  rcl: number,
  ticksToDowngrade: number | undefined,
  upgraderCount: number,
): boolean {
  if (rcl < 2) return false;
  if (ticksToDowngrade == null) return false;
  const max = CONTROLLER_DOWNGRADE_TICKS[rcl] ?? CONTROLLER_DOWNGRADE_TICKS[1];
  if (ticksToDowngrade <= max * DOWNGRADE_RISK_FRACTION) return true;
  // Half-timer with zero upgraders still trends to downgrade.
  return upgraderCount === 0 && ticksToDowngrade <= max * 0.5;
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
  const critical = computeCriticalSignals(input);

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
    noEconomyCreeps: critical.includes("noEconomyCreeps"),
    downgradeRisk: critical.includes("downgradeRisk"),
    ticksToDowngrade: input.ticksToDowngrade,
    critical,
  };
}

export function buildHealthCheck(
  room: Room,
  spawn: StructureSpawn | undefined,
  ags?: AgsMemory,
): AgsHealthCheck {
  const controller = room.controller;
  const rcl = controller?.level ?? 1;
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
      baselineIncome: ags?.baseline?.energyIncomePerTick,
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
    energyAvailable: room.energyAvailable,
    dedicatedMiners: effectiveDedicatedMiners(
      rcl,
      containersAtSources,
      sourceCount,
      {
        energyIncomePerTick: ags?.metrics.energyIncomePerTick ?? 0,
        baselineIncome: ags?.baseline?.energyIncomePerTick,
        spawnFillPct,
      },
    ),
    energyIncomePerTick: ags?.metrics.energyIncomePerTick ?? 0,
    baselineIncome: ags?.baseline?.energyIncomePerTick,
    ticksToDowngrade: controller?.ticksToDowngrade,
  });
}

/** One-line health summary for console / metrics debugging. */
export function formatHealthCheck(health: AgsHealthCheck): string {
  const critical = health.critical ?? [];
  if (
    critical.length === 0 &&
    health.creepDeficit === 0 &&
    health.containersAtSources >= health.sourceCount &&
    (health.hasControllerContainer || health.rcl < 2)
  ) {
    return "ok";
  }

  const parts: string[] = [];
  for (const signal of critical) {
    parts.push(`CRITICAL:${signal}`);
  }
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
  if (health.ticksToDowngrade != null && health.downgradeRisk) {
    parts.push(`ticksToDowngrade=${health.ticksToDowngrade}`);
  }
  return parts.join(" ") || "ok";
}

/** Persist health every interval, or every tick while critical signals are active. */
export function maybeUpdateHealthCheck(
  room: Room | undefined,
  ags: AgsMemory | undefined,
  interval: number = SELF_CHECK_INTERVAL,
): AgsMemory | undefined {
  if (!room || !ags) return ags;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const health = buildHealthCheck(room, spawn, ags);
  const hasCritical = (health.critical?.length ?? 0) > 0;
  if (!hasCritical && Game.time % interval !== 0) return ags;
  return { ...ags, health };
}
