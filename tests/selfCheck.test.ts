import { describe, expect, test } from "vitest";
import {
  computeCriticalSignals,
  computeHealthCheck,
  formatHealthCheck,
  isDowngradeRisk,
  SELF_CHECK_INTERVAL,
} from "../src/selfCheck";

describe("computeHealthCheck", () => {
  test("reports ok when quotas met and infrastructure ready", () => {
    const health = computeHealthCheck({
      tick: 100,
      rcl: 2,
      sourceCount: 2,
      containersAtSources: 2,
      hasControllerContainer: true,
      constructionSites: 0,
      counts: {
        harvester: 0,
        miner: 2,
        hauler: 2,
        upgrader: 2,
        builder: 0,
      },
      want: {
        harvester: 0,
        miner: 2,
        hauler: 2,
        upgrader: 2,
        builder: 0,
      },
      spawnEnergy: 250,
      spawnCapacity: 300,
      dedicatedMiners: true,
      energyIncomePerTick: 5,
      baselineIncome: 4,
      ticksToDowngrade: 9_000,
    });
    expect(health.creepDeficit).toBe(0);
    expect(health.understaffed).toEqual([]);
    expect(health.noEconomyCreeps).toBe(false);
    expect(health.downgradeRisk).toBe(false);
    expect(health.critical).toEqual([]);
    expect(health.spawnFillPct).toBeCloseTo(250 / 300);
    expect(formatHealthCheck(health)).toBe("ok");
  });

  test("flags CRITICAL when only a builder remains", () => {
    const health = computeHealthCheck({
      tick: 83433278,
      rcl: 4,
      sourceCount: 2,
      containersAtSources: 2,
      hasControllerContainer: true,
      constructionSites: 3,
      counts: {
        harvester: 0,
        miner: 0,
        hauler: 0,
        upgrader: 0,
        builder: 1,
      },
      want: {
        harvester: 3,
        miner: 0,
        hauler: 2,
        upgrader: 1,
        builder: 0,
      },
      spawnEnergy: 4,
      spawnCapacity: 300,
      dedicatedMiners: false,
      energyIncomePerTick: 0,
      baselineIncome: 4,
      ticksToDowngrade: 8_000,
    });
    expect(health.noEconomyCreeps).toBe(true);
    expect(health.critical).toEqual(
      expect.arrayContaining([
        "noEconomyCreeps",
        "incomeCollapsed",
        "downgradeRisk",
        "noUpgraders",
      ]),
    );
    expect(formatHealthCheck(health)).toContain("CRITICAL:noEconomyCreeps");
    expect(formatHealthCheck(health)).toContain("CRITICAL:downgradeRisk");
  });

  test("flags understaffed roles and container gaps at RCL2", () => {
    const health = computeHealthCheck({
      tick: 82823379,
      rcl: 2,
      sourceCount: 2,
      containersAtSources: 0,
      hasControllerContainer: false,
      constructionSites: 2,
      counts: {
        harvester: 1,
        miner: 0,
        hauler: 0,
        upgrader: 1,
        builder: 0,
      },
      want: {
        harvester: 3,
        miner: 0,
        hauler: 0,
        upgrader: 2,
        builder: 0,
      },
      spawnEnergy: 50,
      spawnCapacity: 300,
      energyAvailable: 300,
      hasCarryCreep: true,
      dedicatedMiners: false,
      energyIncomePerTick: 3,
      baselineIncome: 3,
      ticksToDowngrade: 9_000,
    });
    expect(health.creepDeficit).toBe(3);
    expect(health.understaffed).toEqual(["harvester", "upgrader"]);
    expect(health.critical).toEqual([]);
    const summary = formatHealthCheck(health);
    expect(summary).toContain("deficit=3");
    expect(summary).toContain("harvester,upgrader");
    expect(summary).toContain("srcContainers=0/2");
    expect(summary).toContain("noCtrlContainer");
  });
});

describe("downgrade / critical helpers", () => {
  test("isDowngradeRisk at low timer fraction", () => {
    expect(isDowngradeRisk(4, 5_000, 2)).toBe(true);
    expect(isDowngradeRisk(4, 35_000, 2)).toBe(false);
  });

  test("isDowngradeRisk when half timer and no upgraders", () => {
    expect(isDowngradeRisk(4, 15_000, 0)).toBe(true);
    expect(isDowngradeRisk(4, 15_000, 1)).toBe(false);
  });

  test("computeCriticalSignals keeps incomeCollapsed visible without forcing alone", () => {
    const signals = computeCriticalSignals({
      tick: 1,
      rcl: 4,
      sourceCount: 2,
      containersAtSources: 2,
      hasControllerContainer: true,
      constructionSites: 0,
      counts: {
        harvester: 0,
        miner: 2,
        hauler: 2,
        upgrader: 2,
        builder: 0,
      },
      want: {
        harvester: 0,
        miner: 2,
        hauler: 2,
        upgrader: 2,
        builder: 0,
      },
      spawnEnergy: 300,
      spawnCapacity: 300,
      dedicatedMiners: true,
      energyIncomePerTick: 0,
      baselineIncome: 5,
      ticksToDowngrade: 35_000,
    });
    expect(signals).toEqual(["incomeCollapsed"]);
  });

  test("computeCriticalSignals flags softLock when stuck below bootstrap energy", () => {
    const signals = computeCriticalSignals({
      tick: 1,
      rcl: 4,
      sourceCount: 2,
      containersAtSources: 0,
      hasControllerContainer: false,
      constructionSites: 0,
      counts: {
        harvester: 0,
        miner: 0,
        hauler: 0,
        upgrader: 0,
        builder: 0,
      },
      want: {
        harvester: 3,
        miner: 0,
        hauler: 0,
        upgrader: 2,
        builder: 0,
      },
      spawnEnergy: 69,
      spawnCapacity: 300,
      energyAvailable: 69,
      dedicatedMiners: false,
      energyIncomePerTick: 0,
      baselineIncome: 4,
      ticksToDowngrade: 39_000,
    });
    expect(signals[0]).toBe("softLock");
    expect(signals).toEqual(
      expect.arrayContaining(["softLock", "noEconomyCreeps", "incomeCollapsed", "noUpgraders"]),
    );
  });
});

describe("SELF_CHECK_INTERVAL", () => {
  test("aligns with income window cadence", () => {
    expect(SELF_CHECK_INTERVAL).toBe(100);
  });
});
