import { describe, expect, test } from "vitest";
import {
  EDGE_MOUTH_FULL_OPEN_MAX,
  canReachAnyExit,
  edgeTilesOnPathsToExits,
  projectInward,
} from "../src/construction/edgeWalls";

describe("edge helpers", () => {
  test("projects exits inward by depth 2", () => {
    expect(projectInward({ x: 0, y: 35 }, "left", 2)).toEqual({
      x: 2,
      y: 35,
    });
  });

  test("narrow mouth max is 3", () => {
    expect(EDGE_MOUTH_FULL_OPEN_MAX).toBe(3);
  });
});

describe("edgeTilesOnPathsToExits", () => {
  const open = new Set<string>();
  for (let x = 3; x <= 25; x++) open.add(`${x},25`);
  for (let y = 3; y <= 25; y++) open.add(`12,${y}`);
  open.add("12,2");
  open.add("13,2");
  open.add("12,1");
  open.add("13,1");
  open.add("12,0");
  open.add("13,0");
  // Dead edge pocket — walkable on y=2 but not on any exit path.
  open.add("40,2");
  open.add("40,3");

  const walk = (x: number, y: number) => open.has(`${x},${y}`);
  const spawn = { x: 25, y: 25 };
  const exits = [
    { x: 12, y: 0 },
    { x: 13, y: 0 },
  ];

  test("mouth is the path corridor, not the dead pocket", () => {
    const mouth = edgeTilesOnPathsToExits(
      walk,
      spawn,
      exits,
      (_x, y) => y === 2,
    );
    expect(mouth.has("12,2") || mouth.has("13,2")).toBe(true);
    expect(mouth.has("40,2")).toBe(false);
  });

  test("path still reaches exits", () => {
    expect(canReachAnyExit(walk, new Set(), spawn, exits)).toBe(true);
  });
});
