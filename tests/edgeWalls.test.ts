import { describe, expect, test } from "vitest";
import {
  expandChokeAlongEdge,
  pickBestEdgeDepth,
  planChokeWallTiles,
  projectInward,
  scoreEdgeDepth,
  type EdgeTileInfo,
} from "../src/construction/edgeWalls";
import { isHubStampTile } from "../src/construction/placement";

describe("exit-choke walls", () => {
  test("projects west exit inward by depth", () => {
    expect(projectInward({ x: 0, y: 35 }, "left", 2)).toEqual({
      x: 2,
      y: 35,
    });
    expect(projectInward({ x: 0, y: 35 }, "left", 3)).toEqual({
      x: 3,
      y: 35,
    });
  });

  test("prefers plains choke at depth 3 over swamp strip at depth 2", () => {
    // West case: swamp on x=2, ~3-tile plains gap on x=3 around y=35.
    const depth2: EdgeTileInfo[] = [
      { x: 2, y: 34, walkable: true, swamp: true },
      { x: 2, y: 35, walkable: true, swamp: true },
      { x: 2, y: 36, walkable: true, swamp: true },
    ];
    const depth3: EdgeTileInfo[] = [
      { x: 3, y: 34, walkable: true, swamp: false },
      { x: 3, y: 35, walkable: true, swamp: false },
      { x: 3, y: 36, walkable: true, swamp: false },
    ];
    expect(scoreEdgeDepth(depth3)).toBeGreaterThan(scoreEdgeDepth(depth2));
    expect(pickBestEdgeDepth({ 2: depth2, 3: depth3, 4: [] })).toBe(3);
  });

  test("prefers shallow tight plains over a wider deeper plains line", () => {
    // North case: no swamp — depth 2 is a 3-tile mouth; depth 4 opens wider.
    const depth2: EdgeTileInfo[] = [
      { x: 24, y: 2, walkable: true, swamp: false },
      { x: 25, y: 2, walkable: true, swamp: false },
      { x: 26, y: 2, walkable: true, swamp: false },
    ];
    const depth4: EdgeTileInfo[] = [
      { x: 23, y: 4, walkable: true, swamp: false },
      { x: 24, y: 4, walkable: true, swamp: false },
      { x: 25, y: 4, walkable: true, swamp: false },
      { x: 26, y: 4, walkable: true, swamp: false },
      { x: 27, y: 4, walkable: true, swamp: false },
    ];
    expect(scoreEdgeDepth(depth2)).toBeGreaterThan(scoreEdgeDepth(depth4));
    expect(pickBestEdgeDepth({ 2: depth2, 3: depth2, 4: depth4 })).toBe(2);
  });

  test("expands seeds only through contiguous walkable choke", () => {
    const walkable = new Set(["3,34", "3,35", "3,36"]);
    const expanded = expandChokeAlongEdge([{ x: 3, y: 35 }], "left", walkable);
    expect(expanded).toHaveLength(3);
    expect(expanded.map((p) => p.y).sort()).toEqual([34, 35, 36]);
  });

  test("gate sits on choke tile closest to spawn, not room mid-edge", () => {
    const choke = [
      { x: 3, y: 34 },
      { x: 3, y: 35 },
      { x: 3, y: 36 },
    ];
    const spawn = { x: 25, y: 28 };
    const plan = planChokeWallTiles(choke, spawn);
    expect(plan.gate).toEqual({ x: 3, y: 34 });
    expect(plan.walls).toEqual([
      { x: 3, y: 35 },
      { x: 3, y: 36 },
    ]);
    // Mid-side (y=25) is nowhere near this choke — would never be a gate.
    expect(plan.gate?.y).not.toBe(25);
  });

  test("hub stamp helper still recognizes extension pockets", () => {
    const spawnPos = { x: 25, y: 25 } as RoomPosition;
    expect(isHubStampTile(spawnPos, 27, 26)).toBe(true);
    expect(isHubStampTile(spawnPos, 3, 35)).toBe(false);
  });
});
