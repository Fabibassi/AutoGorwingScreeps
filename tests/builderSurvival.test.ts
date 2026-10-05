import { describe, expect, test, vi } from "vitest";
import { canWithdrawFromSpawn } from "../src/roles/builder";
import { hasNoEconomyCreeps } from "../src/earlyGame";
import {
  reassignForEconomySurvival,
  reassignSpareHarvesterToInfraBuilder,
  recycleExcessHaulers,
} from "../src/spawn";

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

  test("infrastructure push allows spawn withdraw at ~35% to finish containers", () => {
    expect(canWithdrawFromSpawn(100, 300, true)).toBe(false);
    expect(
      canWithdrawFromSpawn(105, 300, true, { infrastructurePush: true }),
    ).toBe(true);
    expect(
      canWithdrawFromSpawn(104, 300, true, { infrastructurePush: true }),
    ).toBe(false);
  });

  test("builders below quota reserve a full worker body before spawn withdraw", () => {
    // 200 bank for 2nd builder — do not drain it back under the spawn cost.
    expect(
      canWithdrawFromSpawn(200, 300, true, {
        infrastructurePush: true,
        buildersBelowQuota: true,
      }),
    ).toBe(false);
    expect(
      canWithdrawFromSpawn(249, 300, true, {
        infrastructurePush: true,
        buildersBelowQuota: true,
      }),
    ).toBe(false);
    expect(
      canWithdrawFromSpawn(250, 300, true, {
        infrastructurePush: true,
        buildersBelowQuota: true,
      }),
    ).toBe(true);
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

describe("reassignSpareHarvesterToInfraBuilder", () => {
  test("converts a spare harvester into builder when infra builders collapse", () => {
    const harvester = {
      room: { name: "W21N35" },
      memory: { role: "harvester", sourceId: "s1" },
    };
    (globalThis as { Game?: unknown }).Game = {
      creeps: { "harvester-1": harvester },
    };
    const ok = reassignSpareHarvesterToInfraBuilder(
      { name: "W21N35" } as Room,
      {
        harvester: 3,
        miner: 0,
        hauler: 0,
        upgrader: 0,
        builder: 2,
      },
      {
        harvester: 3,
        miner: 0,
        hauler: 0,
        upgrader: 0,
        builder: 1,
      },
      true,
      2,
    );
    expect(ok).toBe(true);
    expect(harvester.memory.role).toBe("builder");
    expect(harvester.memory.sourceId).toBeUndefined();
  });

  test("keeps one harvester per source", () => {
    const harvester = {
      room: { name: "W21N35" },
      memory: { role: "harvester" },
    };
    (globalThis as { Game?: unknown }).Game = {
      creeps: { "harvester-1": harvester },
    };
    expect(
      reassignSpareHarvesterToInfraBuilder(
        { name: "W21N35" } as Room,
        {
          harvester: 3,
          miner: 0,
          hauler: 0,
          upgrader: 0,
          builder: 2,
        },
        {
          harvester: 2,
          miner: 0,
          hauler: 0,
          upgrader: 0,
          builder: 1,
        },
        true,
        2,
      ),
    ).toBe(false);
    expect(harvester.memory.role).toBe("harvester");
  });
});

describe("recycleExcessHaulers", () => {
  test("recycles a surplus hauler during infrastructure push when builders are short", () => {
    vi.stubGlobal("OK", 0);
    const spawnPos = { x: 10, y: 10 };
    const hauler = {
      room: { name: "W21N35" },
      memory: { role: "hauler" },
      pos: {
        isNearTo: (s: { pos: { x: number; y: number } }) =>
          s.pos.x === spawnPos.x && s.pos.y === spawnPos.y,
        x: 10,
        y: 10,
      },
      moveTo: () => OK,
    };
    let recycled = false;
    const spawn = {
      spawning: null,
      room: { name: "W21N35" },
      pos: spawnPos,
      recycleCreep: (c: unknown) => {
        recycled = c === hauler;
        return OK;
      },
    };
    (globalThis as { Game?: unknown }).Game = { creeps: { "hauler-1": hauler } };
    const ok = recycleExcessHaulers(
      spawn as unknown as StructureSpawn,
      {
        harvester: 3,
        miner: 0,
        hauler: 0,
        upgrader: 0,
        builder: 2,
      },
      {
        harvester: 3,
        miner: 0,
        hauler: 2,
        upgrader: 0,
        builder: 1,
      },
      true,
    );
    expect(ok).toBe(true);
    expect(recycled).toBe(true);
  });

  test("skips recycle when haulers are within quota", () => {
    const spawn = {
      spawning: null,
      room: { name: "W21N35" },
      pos: { x: 10, y: 10 },
      recycleCreep: () => OK,
    };
    (globalThis as { Game?: unknown }).Game = { creeps: {} };
    expect(
      recycleExcessHaulers(
        spawn as unknown as StructureSpawn,
        {
          harvester: 3,
          miner: 0,
          hauler: 2,
          upgrader: 0,
          builder: 2,
        },
        {
          harvester: 3,
          miner: 0,
          hauler: 2,
          upgrader: 0,
          builder: 1,
        },
        true,
      ),
    ).toBe(false);
  });
});
