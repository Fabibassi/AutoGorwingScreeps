import { describe, expect, test } from "vitest";
import {
  computeHealthCheck,
  formatHealthCheck,
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
    });
    expect(health.creepDeficit).toBe(0);
    expect(health.understaffed).toEqual([]);
    expect(health.spawnFillPct).toBeCloseTo(250 / 300);
    expect(formatHealthCheck(health)).toBe("ok");
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
      dedicatedMiners: false,
    });
    expect(health.creepDeficit).toBe(3);
    expect(health.understaffed).toEqual(["harvester", "upgrader"]);
    const summary = formatHealthCheck(health);
    expect(summary).toContain("deficit=3");
    expect(summary).toContain("harvester,upgrader");
    expect(summary).toContain("srcContainers=0/2");
    expect(summary).toContain("noCtrlContainer");
  });
});

describe("SELF_CHECK_INTERVAL", () => {
  test("aligns with income window cadence", () => {
    expect(SELF_CHECK_INTERVAL).toBe(100);
  });
});
