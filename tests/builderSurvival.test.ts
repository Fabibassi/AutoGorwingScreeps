import { describe, expect, test } from "vitest";
import { canWithdrawFromSpawn } from "../src/roles/builder";
import { hasNoEconomyCreeps } from "../src/earlyGame";
import { reassignForEconomySurvival } from "../src/spawn";

describe("canWithdrawFromSpawn", () => {
  test("blocks spawn drain when economy creeps are gone", () => {
    expect(canWithdrawFromSpawn(300, 300, false)).toBe(false);
  });

  test("blocks spawn drain while spawn is below 85%", () => {
    expect(canWithdrawFromSpawn(100, 300, true)).toBe(false);
  });

  test("allows overflow only when economy exists and spawn is nearly full", () => {
    expect(canWithdrawFromSpawn(270, 300, true)).toBe(true);
  });

  test("infrastructure push allows spawn withdraw at ~40% to finish containers", () => {
    expect(canWithdrawFromSpawn(100, 300, true)).toBe(false);
    expect(
      canWithdrawFromSpawn(120, 300, true, { infrastructurePush: true }),
    ).toBe(true);
    expect(
      canWithdrawFromSpawn(100, 300, true, { infrastructurePush: true }),
    ).toBe(false);
  });
});

describe("hasNoEconomyCreeps", () => {
  test("true with only a builder left", () => {
    expect(hasNoEconomyCreeps({ harvester: 0, miner: 0 })).toBe(true);
  });

  test("false when a miner remains", () => {
    expect(hasNoEconomyCreeps({ harvester: 0, miner: 1 })).toBe(false);
  });
});

describe("reassignForEconomySurvival", () => {
  test("converts a lone builder into a harvester", () => {
    const builder = { room: { name: "W21N35" }, memory: { role: "builder" } };
    const creeps = { "builder-1": builder };
    (globalThis as { Game?: unknown }).Game = { creeps };
    reassignForEconomySurvival(
      { name: "W21N35" } as Room,
      {
        harvester: 0,
        miner: 0,
        hauler: 0,
        upgrader: 0,
        builder: 1,
      },
    );
    expect(builder.memory.role).toBe("harvester");
  });
});
