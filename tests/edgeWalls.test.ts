import { describe, expect, test } from "vitest";
import {
  pickChokeGate,
  projectInward,
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
