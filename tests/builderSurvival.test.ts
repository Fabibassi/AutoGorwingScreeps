import { describe, expect, test, vi } from "vitest";
import {
  canWithdrawFromSpawn,
  pickBuildSite,
  pickClosestLogisticsEnergy,
  preferLogisticsRefill,
} from "../src/roles/builder";
import { hasNoEconomyCreeps } from "../src/earlyGame";
import {
  clearZombieSpawn,
  directionsToward,
  reclaimStrandedEmergencyHauler,
  reassignForEconomySurvival,
  reassignSpareHarvesterToInfraBuilder,
  reassignSpareHarvesterToMiner,
  reassignUpgraderToExtensionBuilder,
  recycleExcessHaulers,
} from "../src/spawn";

describe("pickBuildSite", () => {
  test("finishes nearly complete extensions instead of the closest unfinished tile", () => {
    // W21N35: haulers park on 2553/3000 next to spawn; path-closest skipped it for 1847.
    const nearDone = { id: "lead", progress: 2553, progressTotal: 3000, range: 1 };
    const mid = { id: "mid", progress: 1847, progressTotal: 3000, range: 1 };
    const low = { id: "low", progress: 625, progressTotal: 3000, range: 1 };
    expect(pickBuildSite([low, nearDone, mid])?.id).toBe("lead");
  });

  test("breaks remaining-progress ties by range", () => {
    const far = { id: "far", progress: 100, progressTotal: 3000, range: 8 };
    const close = { id: "close", progress: 100, progressTotal: 3000, range: 2 };
    expect(pickBuildSite([far, close])?.id).toBe("close");
  });
});

describe("preferLogisticsRefill", () => {
  test("uses logistics once every source has a container", () => {
    expect(preferLogisticsRefill(2, 2)).toBe(true);
    expect(preferLogisticsRefill(1, 2)).toBe(false);
    expect(preferLogisticsRefill(0, 2)).toBe(false);
  });
});

describe("pickClosestLogisticsEnergy", () => {
  test("prefers nearby spawn/storage over a distant source container", () => {
    // Extension sites sit on the spawn — walking to source containers starves builds.
    expect(
      pickClosestLogisticsEnergy([
        { id: "container-far", energy: 500, range: 20, kind: "container" },
        { id: "storage", energy: 1650, range: 12, kind: "storage" },
        { id: "spawn", energy: 300, range: 1, kind: "spawn" },
      ]),
    ).toBe("spawn");
    expect(
      pickClosestLogisticsEnergy([
        { id: "container-far", energy: 500, range: 20, kind: "container" },
        { id: "storage", energy: 1650, range: 3, kind: "storage" },
      ]),
    ).toBe("storage");
  });

  test("prefers hub spawn over a closer thin mining container", () => {
    expect(
      pickClosestLogisticsEnergy([
        { id: "thin-source", energy: 80, range: 2, kind: "container" },
        { id: "spawn", energy: 200, range: 5, kind: "spawn" },
      ]),
    ).toBe("spawn");
  });

  test("skips empty stores and returns null when nothing has energy", () => {
    expect(
      pickClosestLogisticsEnergy([
        { id: "spawn", energy: 0, range: 1, kind: "spawn" },
        { id: "storage", energy: 0, range: 2, kind: "storage" },
      ]),
    ).toBeNull();
  });
});

describe("canWithdrawFromSpawn logistics refill", () => {
  test("allows spawn at 50% when logistics refill is active", () => {
    expect(canWithdrawFromSpawn(150, 300, true)).toBe(false);
    expect(
      canWithdrawFromSpawn(150, 300, true, { logisticsRefill: true }),
    ).toBe(true);
  });
});

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

  test("converts every builder when mining capacity is zero", () => {
    const a = { room: { name: "W21N35" }, memory: { role: "builder" } };
    const b = { room: { name: "W21N35" }, memory: { role: "builder" } };
    (globalThis as { Game?: unknown }).Game = {
      creeps: { "builder-1": a, "builder-2": b },
    };
    reassignForEconomySurvival(
      { name: "W21N35" } as Room,
      {
        harvester: 0,
        miner: 0,
        hauler: 1,
        upgrader: 0,
        builder: 2,
      },
    );
    expect(a.memory.role).toBe("harvester");
    expect(b.memory.role).toBe("harvester");
  });
});

describe("reassignUpgraderToExtensionBuilder", () => {
  test("converts surplus upgraders into builders during extension push", () => {
    const upgrader = {
      room: { name: "W21N35" },
      memory: { role: "upgrader" },
    };
    (globalThis as { Game?: unknown }).Game = {
      creeps: { "upgrader-1": upgrader },
    };
    const ok = reassignUpgraderToExtensionBuilder(
      { name: "W21N35" } as Room,
      {
        harvester: 0,
        miner: 2,
        hauler: 2,
        upgrader: 0,
        builder: 4,
      },
      {
        harvester: 0,
        miner: 2,
        hauler: 2,
        upgrader: 2,
        builder: 2,
      },
    );
    expect(ok).toBe(true);
    expect(upgrader.memory.role).toBe("builder");
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

  test("converts spare harvester when a miner already covers a container source", () => {
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
        harvester: 1,
        miner: 1,
        hauler: 1,
        upgrader: 0,
        builder: 2,
      },
      {
        harvester: 2,
        miner: 1,
        hauler: 1,
        upgrader: 0,
        builder: 1,
      },
      true,
      2,
      1,
    );
    expect(ok).toBe(true);
    expect(harvester.memory.role).toBe("builder");
  });
});

describe("reassignSpareHarvesterToMiner", () => {
  test("converts surplus harvester into miner for an uncovered container source", () => {
    vi.stubGlobal("FIND_SOURCES", 105);
    vi.stubGlobal("FIND_STRUCTURES", 107);
    vi.stubGlobal("STRUCTURE_CONTAINER", "container");
    const freeSource = {
      id: "source-2",
      pos: {
        findInRange: () => [{ structureType: STRUCTURE_CONTAINER }],
      },
    };
    const coveredSource = {
      id: "source-1",
      pos: {
        findInRange: () => [{ structureType: STRUCTURE_CONTAINER }],
      },
    };
    const harvester = {
      room: { name: "W21N35" },
      memory: { role: "harvester" as string, sourceId: undefined as string | undefined },
    };
    const miner = {
      room: { name: "W21N35" },
      memory: { role: "miner", sourceId: "source-1" },
    };
    (globalThis as { Game?: unknown }).Game = {
      creeps: { "miner-1": miner, "harvester-1": harvester },
    };
    const room = {
      name: "W21N35",
      find: (constType: number) =>
        constType === FIND_SOURCES ? [coveredSource, freeSource] : [],
    } as unknown as Room;

    const ok = reassignSpareHarvesterToMiner(
      room,
      { harvester: 0, miner: 2, hauler: 2, upgrader: 0, builder: 1 },
      { harvester: 1, miner: 1, hauler: 2, upgrader: 0, builder: 1 },
    );
    expect(ok).toBe(true);
    expect(harvester.memory.role).toBe("miner");
    expect(harvester.memory.sourceId).toBe("source-2");
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

describe("directionsToward", () => {
  test("points right when storage is east of spawn", () => {
    expect(directionsToward({ x: 31, y: 8 }, { x: 32, y: 8 })).toEqual([
      3, 2, 4,
    ]);
  });

  test("empty when same tile", () => {
    expect(directionsToward({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual([]);
  });
});

describe("reclaimStrandedEmergencyHauler", () => {
  test("recycles immobile empty hauler beside spawn not near storage", () => {
    vi.stubGlobal("MOVE", "move");
    vi.stubGlobal("CARRY", "carry");
    vi.stubGlobal("RESOURCE_ENERGY", "energy");
    vi.stubGlobal("OK", 0);
    const recycleCreep = vi.fn(() => OK);
    const haulerPos = {
      x: 30,
      y: 8,
      isNearTo: (t: { pos?: { x: number; y: number }; x?: number }) => {
        const p = "pos" in t && t.pos ? t.pos : (t as { x: number; y: number });
        return Math.max(Math.abs(30 - p.x), Math.abs(8 - p.y)) <= 1;
      },
      isEqualTo: () => false,
      findInRange: () => [],
    };
    (globalThis as { Game?: unknown }).Game = {
      creeps: {
        h1: {
          name: "h1",
          room: {
            name: "W21N35",
            storage: { store: { energy: 2000 }, pos: { x: 32, y: 8 } },
          },
          memory: { role: "hauler" },
          store: { energy: 0 },
          pos: haulerPos,
          getActiveBodyparts: (p: string) =>
            p === "move" ? 0 : p === "carry" ? 1 : 0,
        },
      },
    };
    const spawn = {
      room: { name: "W21N35" },
      pos: { x: 31, y: 8 },
      recycleCreep,
    };
    expect(
      reclaimStrandedEmergencyHauler(spawn as unknown as StructureSpawn),
    ).toBe(true);
    expect(recycleCreep).toHaveBeenCalled();
  });
});

describe("clearZombieSpawn", () => {
  test("hands off when a living creep matches spawning.name", () => {
    const cancel = vi.fn(() => OK);
    const suicide = vi.fn();
    (globalThis as { Game?: unknown; Memory?: unknown }).Game = {
      time: 100,
      creeps: {
        "hauler-1": { suicide, ticksToLive: 1495, memory: { role: "hauler" } },
      },
    };
    (globalThis as { Memory?: unknown }).Memory = { ags: {} };
    const spawn = {
      spawning: { name: "hauler-1", remainingTime: 0, cancel },
      room: { name: "W21N35", energyAvailable: 300 },
    };
    expect(clearZombieSpawn(spawn as unknown as StructureSpawn)).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(suicide).not.toHaveBeenCalled();
    expect(
      (Memory as { ags?: { zombieDebug?: { action?: string } } }).ags
        ?.zombieDebug?.action,
    ).toBe("hands-off-living");
  });

  test("cancels empty stuck spawn (remainingTime 0, no creep)", () => {
    const cancel = vi.fn(() => OK);
    (globalThis as { Game?: unknown; Memory?: unknown }).Game = {
      time: 50,
      creeps: {},
    };
    (globalThis as { Memory?: unknown }).Memory = { ags: {} };
    const spawn = {
      spawning: { name: "ghost-1", remainingTime: 0, cancel },
      room: { name: "W21N35", energyAvailable: 300 },
    };
    expect(clearZombieSpawn(spawn as unknown as StructureSpawn)).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });

  test("ignores active spawns with remainingTime left", () => {
    const cancel = vi.fn(() => OK);
    (globalThis as { Game?: unknown; Memory?: unknown }).Game = {
      time: 50,
      creeps: {},
    };
    (globalThis as { Memory?: unknown }).Memory = { ags: {} };
    const spawn = {
      spawning: { name: "miner-1", remainingTime: 5, cancel },
      room: { name: "W21N35", energyAvailable: 300 },
    };
    expect(clearZombieSpawn(spawn as unknown as StructureSpawn)).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });
});
