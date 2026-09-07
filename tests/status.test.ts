import { describe, expect, test } from "vitest";
import {
  formatStatusLine,
  resolvePriority,
  shouldLogStatus,
  type ColonySnapshot,
} from "../src/status";

describe("resolvePriority", () => {
  test("spawn when actively spawning", () => {
    expect(
      resolvePriority({
        spawning: true,
        spawningRole: "harvester",
        harvesters: 2,
        upgraders: 1,
        wantHarvesters: 3,
        wantUpgraders: 1,
        spawnEnergy: 100,
        spawnEnergyCap: 300,
      }),
    ).toEqual({ priority: "spawn", detail: "harvester" });
  });

  test("spawn harvester when below target", () => {
    expect(
      resolvePriority({
        spawning: false,
        harvesters: 1,
        upgraders: 1,
        wantHarvesters: 3,
        wantUpgraders: 1,
        spawnEnergy: 200,
        spawnEnergyCap: 300,
      }),
    ).toEqual({ priority: "spawn", detail: "harvester" });
  });

  test("spawn upgrader when harvesters satisfied", () => {
    expect(
      resolvePriority({
        spawning: false,
        harvesters: 3,
        upgraders: 0,
        wantHarvesters: 3,
        wantUpgraders: 1,
        spawnEnergy: 200,
        spawnEnergyCap: 300,
      }),
    ).toEqual({ priority: "spawn", detail: "upgrader" });
  });

  test("harvest when spawn energy low", () => {
    expect(
      resolvePriority({
        spawning: false,
        harvesters: 3,
        upgraders: 1,
        wantHarvesters: 3,
        wantUpgraders: 1,
        spawnEnergy: 50,
        spawnEnergyCap: 300,
      }),
    ).toEqual({ priority: "harvest" });
  });

  test("upgrade when creeps full and spawn stocked", () => {
    expect(
      resolvePriority({
        spawning: false,
        harvesters: 3,
        upgraders: 1,
        wantHarvesters: 3,
        wantUpgraders: 1,
        spawnEnergy: 250,
        spawnEnergyCap: 300,
      }),
    ).toEqual({ priority: "upgrade" });
  });
});

describe("formatStatusLine", () => {
  test("includes key metrics and priority", () => {
    const snapshot: ColonySnapshot = {
      tick: 120,
      rcl: 1,
      spawnEnergy: 180,
      spawnEnergyCap: 300,
      creepEnergy: 90,
      harvesters: 2,
      upgraders: 1,
      wantHarvesters: 3,
      wantUpgraders: 1,
      priority: "spawn",
      priorityDetail: "harvester",
    };
    const line = formatStatusLine(snapshot);
    expect(line).toContain("[t120]");
    expect(line).toContain("RCL1");
    expect(line).toContain("spawn 180/300E");
    expect(line).toContain("creeps 90E");
    expect(line).toContain("H 2/3");
    expect(line).toContain("U 1/1");
    expect(line).toContain("→ spawn:harvester");
  });
});

describe("shouldLogStatus", () => {
  test("logs every 20 ticks", () => {
    expect(shouldLogStatus(20)).toBe(true);
    expect(shouldLogStatus(40)).toBe(true);
    expect(shouldLogStatus(19)).toBe(false);
    expect(shouldLogStatus(0)).toBe(false);
  });
});
