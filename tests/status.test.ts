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
  harvesters: 3,
  upgraders: 1,
  wantHarvesters: 4,
  wantUpgraders: 2,
  priority: { kind: "spawn", role: "harvester" },
  energyIncomePerTick: 8.5,
};

describe("formatPriority", () => {
  test("spawn role", () => {
    expect(formatPriority({ kind: "spawn", role: "harvester" })).toBe(
      "spawn:harvester",
    );
  });
  test("spawning busy", () => {
    expect(formatPriority({ kind: "spawning", role: "upgrader" })).toBe(
      "spawn:upgrader (busy)",
    );
  });
  test("maintain", () => {
    expect(formatPriority({ kind: "maintain" })).toBe(
      "maintain (harvest/upgrade)",
    );
  });
});

describe("formatPlanStatus", () => {
  test("includes key plan fields", () => {
    const line = formatPlanStatus(baseSnapshot);
    expect(line).toContain("[T120]");
    expect(line).toContain("RCL2");
    expect(line).toContain("spawn=250/300");
    expect(line).toContain("creeps=180");
    expect(line).toContain("H:3/4 U:1/2");
    expect(line).toContain("priority=spawn:harvester");
    expect(line).toContain("income=8.5/t");
  });
});

describe("STATUS_LOG_INTERVAL", () => {
  test("defaults to 20 ticks", () => {
    expect(STATUS_LOG_INTERVAL).toBe(20);
  });
});
