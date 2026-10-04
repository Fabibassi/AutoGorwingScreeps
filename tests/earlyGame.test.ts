import { describe, expect, test } from "vitest";
import {
  bodyForRole,
  constructionPriority,
  desiredCreeps,
  EARLY_GAME_THRESHOLDS,
  extensionQuota,
  finalizeSpawnQuotas,
  isSoftLocked,
  shouldBuildContainers,
  shouldBuildRoads,
  shouldBuildStorage,
  shouldBuildWalls,
  spawnPriorityOrder,
  shouldFallbackToMobileHarvest,
  useDedicatedMiners,
} from "../src/earlyGame";

describe("early game infrastructure thresholds", () => {
  test("containers from RCL 2, storage from RCL 4", () => {
    expect(shouldBuildContainers(1)).toBe(false);
    expect(shouldBuildContainers(2)).toBe(true);
    expect(shouldBuildStorage(3)).toBe(false);
    expect(shouldBuildStorage(4)).toBe(true);
  });

  test("walls deferred until RCL 3", () => {
    expect(shouldBuildWalls(1)).toBe(false);
    expect(shouldBuildWalls(2)).toBe(false);
    expect(shouldBuildWalls(3)).toBe(true);
  });

  test("roads only with spare spawn energy and no higher-priority sites", () => {
    expect(shouldBuildRoads(1, 500, false)).toBe(false);
    expect(shouldBuildRoads(2, 50, false)).toBe(false);
    expect(shouldBuildRoads(2, 500, true)).toBe(false);
    expect(shouldBuildRoads(2, 500, false)).toBe(true);
  });
});

describe("dedicated miners", () => {
  test("only after RCL 2 and every source has a container", () => {
    expect(useDedicatedMiners(1, 1, 2)).toBe(false);
    expect(useDedicatedMiners(2, 0, 2)).toBe(false);
    expect(useDedicatedMiners(2, 1, 2)).toBe(false);
    expect(useDedicatedMiners(2, 2, 2)).toBe(true);
  });
});

describe("desiredCreeps", () => {
  test("rcl1 bootstrap stays lean without builders", () => {
    expect(desiredCreeps(1, 2, 0, true)).toEqual({
      harvester: 2,
      miner: 0,
      hauler: 0,
      upgrader: 1,
      builder: 0,
    });
  });

  test("rcl2 without containers keeps mobile harvesters", () => {
    expect(desiredCreeps(2, 2, 0, false)).toEqual({
      harvester: 3,
      miner: 0,
      hauler: 0,
      upgrader: 2,
      builder: 0,
    });
  });

  test("rcl2 with partial containers keeps mobile harvesters", () => {
    expect(desiredCreeps(2, 2, 1, false)).toEqual({
      harvester: 3,
      miner: 0,
      hauler: 0,
      upgrader: 2,
      builder: 0,
    });
  });

  test("rcl2 with all source containers switches to miner/hauler pairs", () => {
    expect(desiredCreeps(2, 2, 2, true)).toEqual({
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 2,
      builder: 1,
    });
  });

  test("rcl2 zero income keeps haulers to drain trapped container energy", () => {
    expect(
      desiredCreeps(2, 2, 2, true, { energyIncomePerTick: 0 }),
    ).toEqual({
      harvester: 3,
      miner: 0,
      hauler: 2,
      upgrader: 1,
      builder: 0,
    });
  });

  test("rcl2 zero income falls back to mobile harvesters not bootstrap add-on", () => {
    expect(shouldFallbackToMobileHarvest(true, { energyIncomePerTick: 0 })).toBe(
      true,
    );
    expect(
      shouldFallbackToMobileHarvest(true, { energyIncomePerTick: 0.1 }),
    ).toBe(false);
  });

  test("falls back when income collapsed vs baseline (RCL4 rollback #34)", () => {
    expect(
      shouldFallbackToMobileHarvest(true, {
        energyIncomePerTick: 1.44,
        baselineIncome: 5,
      }),
    ).toBe(true);
  });

  test("rcl2 dedicated mining drops bootstrap harvester when income recovers", () => {
    expect(
      desiredCreeps(2, 2, 2, true, { energyIncomePerTick: 4 }),
    ).toMatchObject({
      harvester: 0,
    });
  });

  test("rcl2 dedicated mining keeps bootstrap harvester when spawn is nearly empty", () => {
    expect(
      desiredCreeps(2, 2, 2, false, { energyIncomePerTick: 3, spawnFillPct: 0.1 }),
    ).toMatchObject({
      harvester: 1,
    });
  });
});

describe("spawnPriorityOrder", () => {
  test("hauler first when dedicated mining is healthy", () => {
    expect(spawnPriorityOrder(true, { energyIncomePerTick: 5, spawnFillPct: 0.8 })).toEqual([
      "hauler",
      "miner",
      "harvester",
      "upgrader",
      "builder",
    ]);
  });

  test("hauler first when income stalled at zero (drain containers before harvesters)", () => {
    expect(spawnPriorityOrder(true, { energyIncomePerTick: 0, spawnFillPct: 0.5 })).toEqual([
      "hauler",
      "harvester",
      "upgrader",
      "builder",
    ]);
  });

  test("hauler first when spawn is nearly empty during zero-income fallback", () => {
    expect(spawnPriorityOrder(true, { energyIncomePerTick: 0, spawnFillPct: 0.05 })).toEqual([
      "hauler",
      "harvester",
      "upgrader",
      "builder",
    ]);
  });

  test("harvester first when spawn is nearly empty but income positive", () => {
    expect(spawnPriorityOrder(true, { energyIncomePerTick: 3, spawnFillPct: 0.1 })).toEqual([
      "harvester",
      "hauler",
      "miner",
      "upgrader",
      "builder",
    ]);
  });

  test("harvester first when economy creeps are zero even if hauler-first would apply", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 0, spawnFillPct: 0.01 },
        { harvester: 0, miner: 0 },
      ),
    ).toEqual(["harvester", "hauler", "miner", "upgrader", "builder"]);
  });
});

describe("constructionPriority", () => {
  test("extensions before source containers", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 0,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
    });
    expect(queue.filter((s) => s === "extension")).toHaveLength(extensionQuota(2));
    expect(queue[0]).toBe("extension");
    expect(queue.filter((s) => s === "container")).toHaveLength(3);
    expect(queue.includes("storage")).toBe(false);
    expect(queue.includes("road")).toBe(false);
  });

  test("storage after full extensions at RCL 4", () => {
    const queue = constructionPriority(4, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: extensionQuota(4),
    });
    expect(queue[0]).toBe("storage");
  });

  test("defers storage at RCL 4 until source and controller containers exist", () => {
    const queue = constructionPriority(4, {
      sourceContainerCount: 0,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: extensionQuota(4),
    });
    expect(queue.includes("storage")).toBe(false);
    expect(queue.filter((s) => s === "container").length).toBeGreaterThan(0);
  });

  test("roads last when allowed", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: true,
      extensionCount: extensionQuota(2),
    });
    expect(queue.at(-1)).toBe("road");
  });
});

describe("finalizeSpawnQuotas", () => {
  test("RCL4 mobile mode with zero income drops builder and adds emergency hauler", () => {
    const base = desiredCreeps(4, 2, 0, true, { energyIncomePerTick: 0 });
    expect(base.builder).toBe(1);
    const adjusted = finalizeSpawnQuotas(
      base,
      { harvester: 0, miner: 0, hauler: 0, upgrader: 0, builder: 0 },
      4,
      { energyIncomePerTick: 0 },
    );
    expect(adjusted.builder).toBe(0);
    expect(adjusted.upgrader).toBe(0);
    expect(adjusted.hauler).toBe(1);
    expect(adjusted.harvester).toBe(3);
  });

  test("healthy economy leaves dedicated-miner quotas unchanged", () => {
    const base = desiredCreeps(2, 2, 2, true, { energyIncomePerTick: 5 });
    const counts = {
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 2,
      builder: 0,
    };
    expect(finalizeSpawnQuotas(base, counts, 2, { energyIncomePerTick: 5 })).toEqual(
      base,
    );
  });
});

describe("isSoftLocked", () => {
  test("true when no economy creeps and energy below WORK+MOVE", () => {
    expect(isSoftLocked(69, { harvester: 0, miner: 0 })).toBe(true);
    expect(isSoftLocked(150, { harvester: 0, miner: 0 })).toBe(false);
    expect(isSoftLocked(0, { harvester: 1, miner: 0 })).toBe(false);
  });
});

describe("bodyForRole", () => {
  test("miner uses balanced work/move pairs", () => {
    const body = bodyForRole("miner", 300);
    expect(body.filter((p) => p === "work")).toHaveLength(2);
    expect(body.filter((p) => p === "move")).toHaveLength(2);
  });

  test("miner scales WORK up to 5 with enough energy", () => {
    const body = bodyForRole("miner", 550);
    expect(body.filter((p) => p === "work")).toHaveLength(3);
    expect(body.filter((p) => p === "move")).toHaveLength(3);
  });

  test("hauler uses carry/move pairs", () => {
    const body = bodyForRole("hauler", 300);
    expect(body.filter((p) => p === "carry").length).toBe(
      body.filter((p) => p === "move").length,
    );
  });

  test("worker scales down to work/move bootstrap when energy is below full unit", () => {
    expect(bodyForRole("harvester", 150)).toEqual(["work", "move"]);
    expect(bodyForRole("harvester", 199)).toEqual(["work", "move"]);
  });

  test("worker returns empty body when energy cannot afford bootstrap creep", () => {
    expect(bodyForRole("harvester", 0)).toEqual([]);
    expect(bodyForRole("harvester", 100)).toEqual([]);
  });

  test("miner and hauler return empty when energy is insufficient", () => {
    expect(bodyForRole("miner", 100)).toEqual([]);
    expect(bodyForRole("hauler", 50)).toEqual([]);
  });

  test("hauler bootstrap body spawns at 100 energy when harvester needs 150", () => {
    expect(bodyForRole("hauler", 100)).toEqual(["carry", "move"]);
    expect(bodyForRole("harvester", 100)).toEqual([]);
  });
});

describe("threshold constants", () => {
  test("documents early-game policy values", () => {
    expect(EARLY_GAME_THRESHOLDS.minRclForContainers).toBe(2);
    expect(EARLY_GAME_THRESHOLDS.minRclForWalls).toBe(3);
    expect(EARLY_GAME_THRESHOLDS.minRclForStorage).toBe(4);
  });
});
