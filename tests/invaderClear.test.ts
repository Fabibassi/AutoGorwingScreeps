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
    storageEnergy: STORAGE_FLOOR_ENERGY,
    threatActive: true,
    livingClearers: 0,
    energyAvailable: 260,
  };

  test("allows clear near storage floor (camping hauler case)", () => {
    expect(shouldSpawnInvaderClearer(base)).toBe(true);
    expect(
      shouldSpawnInvaderClearer({ ...base, storageEnergy: 19_979 }),
    ).toBe(true);
  });

  test("blocks flee / refill / safemode arms", () => {
    expect(shouldSpawnInvaderClearer({ ...base, defenseMode: "flee" })).toBe(
      false,
    );
    expect(shouldSpawnInvaderClearer({ ...base, defenseMode: "refill" })).toBe(
      false,
    );
  });

  test("blocks only in deep blackout", () => {
    expect(
      shouldSpawnInvaderClearer({
        ...base,
        storageEnergy: 4_999,
      }),
    ).toBe(false);
    expect(
      shouldSpawnInvaderClearer({
        ...base,
        storageEnergy: 5_000,
      }),
    ).toBe(true);
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
  test("is deep-blackout floor (5k), not economy floor+buffer", () => {
    expect(invaderClearStorageMin()).toBe(5_000);
  });
});

describe("pickInvaderTarget", () => {
  test("prefers soft hostiles over combat creeps", async () => {
    const { pickInvaderTarget } = await import("../src/defense/invaderClear");
    const soft = {
      owner: { username: "Scout" },
      getActiveBodyparts: (p: string) => (p === "attack" ? 0 : 0),
    } as unknown as Creep;
    const combat = {
      owner: { username: "Scout" },
      getActiveBodyparts: (p: string) => (p === "attack" ? 2 : 0),
    } as unknown as Creep;
    expect(pickInvaderTarget([combat, soft])).toBe(soft);
  });
});
