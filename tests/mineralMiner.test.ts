import { describe, expect, test } from "vitest";
import { shouldRunMineralMiner } from "../src/roles/mineralMiner";
import { buildMineralMinerBody } from "../src/spawnMineral";

describe("shouldRunMineralMiner", () => {
  test("needs extractor, terminal, mineral, and storage above floor", () => {
    expect(
      shouldRunMineralMiner({
        hasExtractor: true,
        mineralAmount: 1000,
        hasTerminal: true,
        storageEnergy: 20_001,
        floor: 20_000,
      }),
    ).toBe(true);
    expect(
      shouldRunMineralMiner({
        hasExtractor: true,
        mineralAmount: 0,
        hasTerminal: true,
        storageEnergy: 50_000,
        floor: 20_000,
      }),
    ).toBe(false);
    expect(
      shouldRunMineralMiner({
        hasExtractor: true,
        mineralAmount: 1000,
        hasTerminal: false,
        storageEnergy: 50_000,
        floor: 20_000,
      }),
    ).toBe(false);
  });
});

describe("buildMineralMinerBody", () => {
  test("builds WORK+CARRY+MOVE", () => {
    expect(buildMineralMinerBody(249)).toEqual([]);
    expect(buildMineralMinerBody(250)).toEqual(["work", "carry", "move"]);
    expect(buildMineralMinerBody(650)).toEqual([
      "work",
      "work",
      "work",
      "work",
      "work",
      "carry",
      "move",
    ]);
  });
});
