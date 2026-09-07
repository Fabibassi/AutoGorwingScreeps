import { describe, expect, test } from "vitest";
import {
  formatPlanStatus,
  formatPriority,
  STATUS_LOG_INTERVAL,
  type PlanSnapshot,
} from "../src/status";

const baseSnapshot: PlanSnapshot = {
  tick: 120,
  rcl: 2,
  spawnEnergy: 250,
  spawnCapacity: 300,
  creepEnergy: 180,
  counts: {
    harvester: 1,
    miner: 1,
    hauler: 1,
    upgrader: 1,
    builder: 0,
  },
  want: {
    harvester: 0,
    miner: 2,
    hauler: 2,
    upgrader: 2,
    builder: 1,
  },
  priority: { kind: "spawn", role: "miner" },
  energyIncomePerTick: 8.5,
};

describe("formatPriority", () => {
  test("spawn role", () => {
    expect(formatPriority({ kind: "spawn", role: "miner" })).toBe("spawn:miner");
  });
  test("spawning busy", () => {
    expect(formatPriority({ kind: "spawning", role: "hauler" })).toBe(
      "spawn:hauler (busy)",
    );
  });
  test("maintain", () => {
    expect(formatPriority({ kind: "maintain" })).toBe("maintain");
  });
});

describe("formatPlanStatus", () => {
  test("includes key plan fields", () => {
    const line = formatPlanStatus(baseSnapshot);
    expect(line).toContain("[T120]");
    expect(line).toContain("RCL2");
    expect(line).toContain("spawn=250/300");
    expect(line).toContain("M:1/2");
    expect(line).toContain("priority=spawn:miner");
    expect(line).toContain("income=8.5/t");
  });

  test("appends health summary when not ok", () => {
    const line = formatPlanStatus(baseSnapshot, "deficit=2(miner,hauler)");
    expect(line).toContain("check=deficit=2(miner,hauler)");
  });
});

describe("STATUS_LOG_INTERVAL", () => {
  test("defaults to 20 ticks", () => {
    expect(STATUS_LOG_INTERVAL).toBe(20);
  });
});
