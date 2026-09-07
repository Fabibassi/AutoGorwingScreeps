import { describe, expect, test } from "vitest";
import {
  formatStatusLine,
  getPriority,
  shouldLogStatus,
  type BotSnapshot,
} from "../src/status";

describe("getPriority", () => {
  const want = { harvester: 3, upgrader: 1 };

  test("spawn when missing harvesters", () => {
    expect(
      getPriority({ harvester: 2, upgrader: 1 }, want, {
        spawning: false,
        spawnHasFreeCapacity: false,
      }),
    ).toBe("spawn");
  });

  test("spawn when missing upgraders", () => {
    expect(
      getPriority({ harvester: 3, upgrader: 0 }, want, {
        spawning: false,
        spawnHasFreeCapacity: false,
      }),
    ).toBe("spawn");
  });

  test("spawn when spawn is busy", () => {
    expect(
      getPriority({ harvester: 3, upgrader: 1 }, want, {
        spawning: true,
        spawnHasFreeCapacity: true,
      }),
    ).toBe("spawn");
  });

  test("harvest when spawn has free energy capacity", () => {
    expect(
      getPriority({ harvester: 3, upgrader: 1 }, want, {
        spawning: false,
        spawnHasFreeCapacity: true,
      }),
    ).toBe("harvest");
  });

  test("upgrade when roster full and spawn full", () => {
    expect(
      getPriority({ harvester: 3, upgrader: 1 }, want, {
        spawning: false,
        spawnHasFreeCapacity: false,
      }),
    ).toBe("upgrade");
  });
});

describe("formatStatusLine", () => {
  test("compact one-line summary", () => {
    const snapshot: BotSnapshot = {
      tick: 120,
      rcl: 2,
      spawnEnergy: 250,
      spawnCapacity: 300,
      creepEnergy: 180,
      harvesters: 3,
      upgraders: 1,
      wantHarvesters: 4,
      wantUpgraders: 2,
      priority: "spawn",
      spawning: "harvester-120",
    };
    expect(formatStatusLine(snapshot)).toBe(
      "[T120] RCL2 | E spawn:250/300 creeps:180 | H:3/4 U:1/2 | prio:spawn spawning:harvester-120",
    );
  });
});

describe("shouldLogStatus", () => {
  test("logs every 20 ticks, not every tick", () => {
    expect(shouldLogStatus(1, 20)).toBe(false);
    expect(shouldLogStatus(19, 20)).toBe(false);
    expect(shouldLogStatus(20, 20)).toBe(true);
    expect(shouldLogStatus(40, 20)).toBe(true);
  });

  test("skips tick 0", () => {
    expect(shouldLogStatus(0, 20)).toBe(false);
  });
});
