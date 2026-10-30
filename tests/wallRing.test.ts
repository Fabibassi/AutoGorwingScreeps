import { describe, expect, test } from "vitest";
import {
  shouldPlaceWallRing,
  WALL_RING_STORAGE_BUFFER,
} from "../src/earlyGame/wallArm";
import { STORAGE_FLOOR_ENERGY } from "../src/earlyGame/storageFloor";

describe("shouldPlaceWallRing", () => {
  test("requires hub ramparts, RCL≥6, and floor+buffer", () => {
    expect(
      shouldPlaceWallRing({
        hubRampartsReady: false,
        storageEnergy: 100_000,
        rcl: 6,
      }),
    ).toBe(false);
    expect(
      shouldPlaceWallRing({
        hubRampartsReady: true,
        storageEnergy: STORAGE_FLOOR_ENERGY + WALL_RING_STORAGE_BUFFER,
        rcl: 5,
      }),
    ).toBe(false);
    expect(
      shouldPlaceWallRing({
        hubRampartsReady: true,
        storageEnergy: STORAGE_FLOOR_ENERGY + WALL_RING_STORAGE_BUFFER - 1,
        rcl: 6,
      }),
    ).toBe(false);
    expect(
      shouldPlaceWallRing({
        hubRampartsReady: true,
        storageEnergy: STORAGE_FLOOR_ENERGY + WALL_RING_STORAGE_BUFFER,
        rcl: 6,
      }),
    ).toBe(true);
  });
});
