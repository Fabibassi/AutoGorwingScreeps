import { describe, expect, test } from "vitest";
import {
  WALL_EDGE_COORD,
  WALL_EDGE_HI,
  isEdgeWallGate,
  isHubStampTile,
  isRoomEdgeWallTile,
} from "../src/construction/placement";

describe("room-edge wall line", () => {
  test("uses border band at 2 / 47 (e.g. north y=2)", () => {
    expect(WALL_EDGE_COORD).toBe(2);
    expect(WALL_EDGE_HI).toBe(47);
    expect(isRoomEdgeWallTile(15, 2)).toBe(true);
    expect(isRoomEdgeWallTile(2, 20)).toBe(true);
    expect(isRoomEdgeWallTile(25, 25)).toBe(false);
    expect(isRoomEdgeWallTile(25, 7)).toBe(false);
  });

  test("leaves mid-edge gates open", () => {
    expect(isEdgeWallGate(25, WALL_EDGE_COORD)).toBe(true);
    expect(isEdgeWallGate(24, WALL_EDGE_COORD)).toBe(false);
    expect(isEdgeWallGate(WALL_EDGE_COORD, 25)).toBe(true);
  });

  test("hub stamp helper still recognizes extension pockets", () => {
    const spawnPos = { x: 25, y: 25 } as RoomPosition;
    expect(isHubStampTile(spawnPos, 27, 26)).toBe(true);
    expect(isHubStampTile(spawnPos, 15, 2)).toBe(false);
  });
});
