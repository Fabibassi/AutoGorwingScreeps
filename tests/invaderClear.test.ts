import { describe, expect, test } from "vitest";
import {
  buildInvaderClearerBody,
  invaderClearStorageMin,
  parseDefenseMode,
  shouldSpawnInvaderClearer,
} from "../src/defense/invaderClear";
import { STORAGE_FLOOR_ENERGY } from "../src/earlyGame/storageFloor";

describe("parseDefenseMode", () => {
  test("defaults to clear", () => {
    expect(parseDefenseMode(undefined)).toBe("clear");
    expect(parseDefenseMode("flee")).toBe("flee");
  });
});

describe("shouldSpawnInvaderClearer", () => {
  const base = {
    defenseMode: "clear" as const,
    rcl: 6,
    storageEnergy: STORAGE_FLOOR_ENERGY + 2_000,
    threatActive: true,
    livingClearers: 0,
    energyAvailable: 260,
  };

  test("allows clear above floor+buffer", () => {
    expect(shouldSpawnInvaderClearer(base)).toBe(true);
  });

  test("blocks flee / refill / safemode arms", () => {
    expect(shouldSpawnInvaderClearer({ ...base, defenseMode: "flee" })).toBe(
      false,
    );
    expect(shouldSpawnInvaderClearer({ ...base, defenseMode: "refill" })).toBe(
      false,
    );
  });

  test("blocks under storage buffer", () => {
    expect(
      shouldSpawnInvaderClearer({
        ...base,
        storageEnergy: STORAGE_FLOOR_ENERGY + 1_999,
      }),
    ).toBe(false);
  });

  test("blocks without threat or when squad full", () => {
    expect(shouldSpawnInvaderClearer({ ...base, threatActive: false })).toBe(
      false,
    );
    expect(shouldSpawnInvaderClearer({ ...base, livingClearers: 1 })).toBe(
      false,
    );
  });
});

describe("buildInvaderClearerBody", () => {
  test("needs at least attack+move", () => {
    expect(buildInvaderClearerBody(129)).toEqual([]);
    expect(buildInvaderClearerBody(130)).toEqual(["attack", "move"]);
  });

  test("scales pairs up to 4", () => {
    expect(buildInvaderClearerBody(520)).toEqual([
      "attack",
      "attack",
      "attack",
      "attack",
      "move",
      "move",
      "move",
      "move",
    ]);
  });
});

describe("invaderClearStorageMin", () => {
  test("is floor + 2k", () => {
    expect(invaderClearStorageMin()).toBe(STORAGE_FLOOR_ENERGY + 2_000);
  });
});
