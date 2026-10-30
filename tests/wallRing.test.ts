import { describe, expect, test } from "vitest";
import {
  shouldPlaceWallRing,
  WALL_RING_STORAGE_BUFFER,
} from "../src/earlyGame/wallArm";

describe("shouldPlaceWallRing", () => {
  test("requires hub ramparts ready and RCL≥6; sites are free (no storage buffer)", () => {
    expect(WALL_RING_STORAGE_BUFFER).toBe(0);
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
        storageEnergy: 0,
        rcl: 5,
      }),
    ).toBe(false);
    expect(
      shouldPlaceWallRing({
        hubRampartsReady: true,
        storageEnergy: 0,
        rcl: 6,
      }),
    ).toBe(true);
  });
});
