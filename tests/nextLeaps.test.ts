import { describe, expect, test } from "vitest";
import {
  shouldArmSecondRemote,
  shouldPlaceLabs,
  shouldPrepGclExpand,
} from "../src/earlyGame/nextLeaps";

describe("shouldPlaceLabs", () => {
  test("waits for RCL7 hit + mineral in terminal", () => {
    expect(
      shouldPlaceLabs({
        rcl: 7,
        extensions: 50,
        extensionQuota: 50,
        towers: 3,
        towerQuota: 3,
        spawns: 2,
        spawnQuota: 2,
        terminalMineral: 100,
        labs: 0,
      }),
    ).toBe(true);
    expect(
      shouldPlaceLabs({
        rcl: 7,
        extensions: 49,
        extensionQuota: 50,
        towers: 3,
        towerQuota: 3,
        spawns: 2,
        spawnQuota: 2,
        terminalMineral: 100,
        labs: 0,
      }),
    ).toBe(false);
    expect(
      shouldPlaceLabs({
        rcl: 6,
        extensions: 40,
        extensionQuota: 40,
        towers: 2,
        towerQuota: 2,
        spawns: 1,
        spawnQuota: 1,
        terminalMineral: 100,
        labs: 0,
      }),
    ).toBe(false);
  });
});

describe("shouldArmSecondRemote", () => {
  test("needs first remote + RCL7 + buffer", () => {
    expect(
      shouldArmSecondRemote({
        rcl: 7,
        firstRemoteActive: true,
        storageEnergy: 30_001,
        floor: 20_000,
        extensions: 50,
        extensionQuota: 50,
      }),
    ).toBe(true);
    expect(
      shouldArmSecondRemote({
        rcl: 7,
        firstRemoteActive: false,
        storageEnergy: 100_000,
        floor: 20_000,
        extensions: 50,
        extensionQuota: 50,
      }),
    ).toBe(false);
  });
});

describe("shouldPrepGclExpand", () => {
  test("needs labs started and fat storage", () => {
    expect(
      shouldPrepGclExpand({
        gcl: 2,
        roomsOwned: 1,
        labs: 3,
        storageEnergy: 70_000,
        floor: 20_000,
      }),
    ).toBe(true);
    expect(
      shouldPrepGclExpand({
        gcl: 1,
        roomsOwned: 1,
        labs: 6,
        storageEnergy: 100_000,
        floor: 20_000,
      }),
    ).toBe(false);
  });
});
