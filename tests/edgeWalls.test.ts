import { describe, expect, test } from "vitest";
import {
  canReachAnyExit,
  projectInward,
  wallWouldSealExitPath,
} from "../src/construction/edgeWalls";

describe("edge helpers (fixed depth-2 frame)", () => {
  test("projects exits inward by depth 2 onto the wall line", () => {
    expect(projectInward({ x: 0, y: 35 }, "left", 2)).toEqual({
      x: 2,
      y: 35,
    });
  });
});

describe("wallWouldSealExitPath / canReachAnyExit", () => {
  // Narrow west choke: only (2,35) connects the room to the exit.
  const open = new Set([
    "25,25",
    "3,25",
    "3,26",
    "3,27",
    "3,28",
    "3,29",
    "3,30",
    "3,31",
    "3,32",
    "3,33",
    "3,34",
    "3,35",
    "2,35",
    "1,35",
    "0,35",
  ]);
  for (let x = 4; x <= 24; x++) open.add(`${x},25`);
  const walk = (x: number, y: number) => open.has(`${x},${y}`);
  const spawn = { x: 25, y: 25 };
  const exits = [{ x: 0, y: 35 }];

  test("path reaches exit when choke is open", () => {
    expect(canReachAnyExit(walk, new Set(), spawn, exits)).toBe(true);
  });

  test("wall on the only choke tile seals that side", () => {
    expect(
      wallWouldSealExitPath(walk, new Set(), { x: 2, y: 35 }, spawn, exits),
    ).toBe(true);
  });

  test("full-side wall with gate open still reaches exit", () => {
    const blocked = new Set(["2,34", "2,36", "2,20"]);
    expect(canReachAnyExit(walk, blocked, spawn, exits)).toBe(true);
  });

  test("full-side wall including choke seals exit", () => {
    const blocked = new Set(["2,34", "2,35", "2,36"]);
    expect(canReachAnyExit(walk, blocked, spawn, exits)).toBe(false);
  });
});
