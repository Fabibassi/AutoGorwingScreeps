import { describe, expect, test } from "vitest";
import { desiredCreeps } from "../src/spawn";

describe("desiredCreeps (spawn re-export)", () => {
  test("rcl1 wants lean bootstrap", () => {
    expect(desiredCreeps(1, 2, 0, false)).toEqual({
      harvester: 2,
      miner: 0,
      hauler: 0,
      upgrader: 1,
      builder: 0,
      filler: 0,
    });
  });

  test("rcl2 with static mining wants miner/hauler per source", () => {
    expect(desiredCreeps(2, 2, 2, false)).toMatchObject({
      miner: 2,
      hauler: 2,
      harvester: 0,
    });
  });
});
