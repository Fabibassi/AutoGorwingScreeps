import { describe, expect, test } from "vitest";
import { desiredCreeps } from "../src/spawn";

describe("desiredCreeps", () => {
  test("rcl1 wants 3 harvesters and 1 upgrader", () => {
    expect(desiredCreeps(1)).toEqual({ harvester: 3, upgrader: 1 });
  });
  test("rcl2+ wants 4 harvesters and 2 upgraders", () => {
    expect(desiredCreeps(2)).toEqual({ harvester: 4, upgrader: 2 });
    expect(desiredCreeps(3)).toEqual({ harvester: 4, upgrader: 2 });
  });
});
