import { describe, expect, test } from "vitest";
import {
  canReachAnyExit,
  pickChokeGate,
  projectInward,
  wallWouldSealExitPath,
} from "../src/construction/edgeWalls";

describe("edge helpers (fixed depth-2 frame)", () => {
  test("projects exits inward by depth 2 onto the wall line", () => {
    expect(projectInward({ x: 0, y: 35 }, "left", 2)).toEqual({
      x: 2,
      y: 35,
    });
    expect(projectInward({ x: 25, y: 0 }, "top", 2)).toEqual({
      x: 25,
      y: 2,
    });
  });

  test("gate picks exit projection closest to spawn", () => {
    const gate = pickChokeGate(
      [
        { x: 2, y: 34 },
        { x: 2, y: 35 },
        { x: 2, y: 36 },
      ],
      { x: 25, y: 28 },
    );
    expect(gate).toEqual({ x: 2, y: 34 });
  });
});

describe("wallWouldSealExitPath", () => {
  // Narrow west choke: only (2,35) connects the room to the exit column.
  const open = new Set([
    "25,25",
    "24,25",
    "23,25",
    "22,25",
    "21,25",
    "20,25",
    "19,25",
    "18,25",
    "17,25",
    "16,25",
    "15,25",
    "14,25",
    "13,25",
    "12,25",
    "11,25",
    "10,25",
    "9,25",
    "8,25",
    "7,25",
    "6,25",
    "5,25",
    "4,25",
    "3,25",
    "3,35",
    "2,35",
    "1,35",
    "0,35",
    // vertical corridor from (3,25) down to (3,35)
    "3,26",
    "3,27",
    "3,28",
    "3,29",
    "3,30",
    "3,31",
    "3,32",
    "3,33",
    "3,34",
  ]);
  const walk = (x: number, y: number) => open.has(`${x},${y}`);
  const spawn = { x: 25, y: 25 };
  const exits = [{ x: 0, y: 35 }];

  test("path reaches exit when choke is open", () => {
    expect(canReachAnyExit(walk, new Set(), spawn, exits)).toBe(true);
  });

  test("wall on the only choke tile seals the exit", () => {
    expect(
      wallWouldSealExitPath(walk, new Set(), { x: 2, y: 35 }, spawn, exits),
    ).toBe(true);
  });

  test("wall on a non-path edge tile does not seal", () => {
    open.add("2,20");
    open.add("3,20");
    open.add("4,20");
    // Still only exit path is via y=35 — walling dead-end spur is fine.
    expect(
      wallWouldSealExitPath(walk, new Set(), { x: 2, y: 20 }, spawn, exits),
    ).toBe(false);
  });
});
