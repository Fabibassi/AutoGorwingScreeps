import { describe, expect, test } from "vitest";
import { buildClaimerBody } from "../src/spawnExpand";
import { shouldPrepGclExpand } from "../src/earlyGame/nextLeaps";

describe("buildClaimerBody", () => {
  test("needs 650 for CLAIM+MOVE", () => {
    expect(buildClaimerBody(649)).toEqual([]);
    expect(buildClaimerBody(650)).toEqual(["claim", "move"]);
    expect(buildClaimerBody(700)).toEqual(["claim", "move", "move"]);
  });
});

describe("shouldPrepGclExpand gate for claimer", () => {
  test("blocks when GCL already saturated", () => {
    expect(
      shouldPrepGclExpand({
        gcl: 1,
        roomsOwned: 1,
        labs: 6,
        storageEnergy: 100_000,
        floor: 20_000,
      }),
    ).toBe(false);
  });
});
