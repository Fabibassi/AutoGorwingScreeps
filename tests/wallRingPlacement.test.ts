import { describe, expect, test } from "vitest";
import { isHubStampTile } from "../src/construction/placement";
import {
  EDGE_DEPTHS,
  pickBestEdgeDepth,
  planChokeWallTiles,
  type EdgeTileInfo,
} from "../src/construction/edgeWalls";

describe("exit-choke wall placement (replaces mid-edge frame)", () => {
  test("considers depths 2–4, not a fixed y=2 / mid-gate frame", () => {
    expect([...EDGE_DEPTHS]).toEqual([2, 3, 4]);
  });

  test("does not invent a mid-side gate when choke is off-center", () => {
    const byDepth: Record<number, EdgeTileInfo[]> = {
      2: [
        { x: 2, y: 34, walkable: true, swamp: true },
        { x: 2, y: 35, walkable: true, swamp: true },
        { x: 2, y: 36, walkable: true, swamp: true },
      ],
      3: [
        { x: 3, y: 34, walkable: true, swamp: false },
        { x: 3, y: 35, walkable: true, swamp: false },
        { x: 3, y: 36, walkable: true, swamp: false },
      ],
      4: [],
    };
    const depth = pickBestEdgeDepth(byDepth);
    expect(depth).toBe(3);
    const plan = planChokeWallTiles(byDepth[3]!, { x: 25, y: 28 });
    expect(plan.gate?.y).toBe(34);
    expect(plan.walls).toHaveLength(2);
    expect(plan.gate?.y).not.toBe(25);
  });

  test("hub stamp helper still recognizes extension pockets", () => {
    const spawnPos = { x: 25, y: 25 } as RoomPosition;
    expect(isHubStampTile(spawnPos, 27, 26)).toBe(true);
    expect(isHubStampTile(spawnPos, 15, 2)).toBe(false);
  });
});
