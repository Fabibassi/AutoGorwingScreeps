import { describe, expect, test } from "vitest";
import {
  WALL_EDGE_COORD,
  WALL_EDGE_HI,
  isHubStampTile,
  isRoomEdgeWallTile,
} from "../src/construction/placement";

describe("fixed room-edge wall line (2 / 47)", () => {
  test("uses border band at 2 / 47", () => {
    expect(WALL_EDGE_COORD).toBe(2);
    expect(WALL_EDGE_HI).toBe(47);
    expect(isRoomEdgeWallTile(15, 2)).toBe(true);
    expect(isRoomEdgeWallTile(2, 20)).toBe(true);
    expect(isRoomEdgeWallTile(47, 35)).toBe(true);
    expect(isRoomEdgeWallTile(25, 25)).toBe(false);
    expect(isRoomEdgeWallTile(3, 35)).toBe(false);
    expect(isRoomEdgeWallTile(25, 4)).toBe(false);
  });

  test("hub stamp helper still recognizes extension pockets", () => {
    const spawnPos = { x: 25, y: 25 } as RoomPosition;
    expect(isHubStampTile(spawnPos, 27, 26)).toBe(true);
    expect(isHubStampTile(spawnPos, 15, 2)).toBe(false);
  });
});
