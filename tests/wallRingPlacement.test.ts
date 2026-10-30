import { describe, expect, test } from "vitest";
import {
  HUB_EXTENSION_STAMP,
  WALL_RING_MIN_RANGE,
  WALL_RING_MAX_RANGE,
  isHubStampTile,
} from "../src/construction/placement";

describe("wall ring vs hub stamp", () => {
  test("ring sits outside extension stamp radius", () => {
    let maxStamp = 0;
    for (const [dx, dy] of HUB_EXTENSION_STAMP) {
      maxStamp = Math.max(maxStamp, Math.max(Math.abs(dx), Math.abs(dy)));
    }
    expect(WALL_RING_MIN_RANGE).toBeGreaterThan(maxStamp);
    expect(WALL_RING_MAX_RANGE).toBeGreaterThanOrEqual(WALL_RING_MIN_RANGE);
  });

  test("stamp helper recognizes extension pockets", () => {
    const spawnPos = { x: 25, y: 25 } as RoomPosition;
    expect(isHubStampTile(spawnPos, 27, 26)).toBe(true); // [2,1]
    expect(isHubStampTile(spawnPos, 25, 25)).toBe(false);
    expect(isHubStampTile(spawnPos, 25 + WALL_RING_MIN_RANGE, 25)).toBe(false);
  });
});
