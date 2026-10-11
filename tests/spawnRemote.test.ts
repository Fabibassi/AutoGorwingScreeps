import { describe, expect, test } from "vitest";
import { homeReadyForRemotes } from "../src/spawnRemote";

describe("homeReadyForRemotes", () => {
  test("needs miners and a filler", () => {
    expect(
      homeReadyForRemotes({
        homeMiners: 2,
        homeMinerWant: 2,
        homeFillers: 1,
      }),
    ).toBe(true);
    expect(
      homeReadyForRemotes({
        homeMiners: 1,
        homeMinerWant: 2,
        homeFillers: 0,
      }),
    ).toBe(false);
    expect(
      homeReadyForRemotes({
        homeMiners: 0,
        homeMinerWant: 2,
        homeFillers: 1,
      }),
    ).toBe(false);
  });
});
