import { describe, expect, test } from "vitest";
import {
  bodyForRole,
  constructionPriority,
  desiredCreeps,
  EARLY_GAME_THRESHOLDS,
  estimateMiningPerTick,
  extensionQuota,
  haulerCountForMining,
  isSoftLocked,
  shouldBuildContainers,
  shouldBuildRoads,
  shouldBuildStorage,
  shouldBuildWalls,
  spawnPriorityOrder,
  isEconomyDepressed,
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

describe("haulerCountForMining", () => {
  test("scales with miner WORK and caps at 2 per source", () => {
    expect(estimateMiningPerTick(10, 2)).toBe(20);
    expect(estimateMiningPerTick(1, 2)).toBe(2);
    expect(haulerCountForMining(2, 2, { haulRange: 20 })).toBe(2);
    expect(haulerCountForMining(2, 10, { haulRange: 20 })).toBe(4);
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
      filler: 0,
    });
  });

  test("fat miners raise hauler quota under dedicated mining", () => {
    expect(
      desiredCreeps(4, 2, 2, false, {
        energyIncomePerTick: 10,
        minerWorkParts: 10,
        haulRange: 20,
      }),
    ).toMatchObject({ miner: 2, hauler: 4 });
  });

  test("rcl2 without containers keeps mobile harvesters", () => {
    expect(desiredCreeps(2, 2, 0, false)).toEqual({
      harvester: 3,
      miner: 0,
      hauler: 0,
      upgrader: 2,
      builder: 0,
      filler: 0,
    });
  });

  test("rcl4 zero income wants hauler to break soft-lock even during infra push", () => {
    expect(
      desiredCreeps(4, 2, 0, true, {
        energyIncomePerTick: 0,
        spawnFillPct: 0.27,
        energyAvailable: 152,
      }),
    ).toEqual({
      // Infra push: sources only (no spare H) so builders can claim spawn.
      harvester: 2,
      miner: 0,
      hauler: 1,
      upgrader: 0,
      builder: 4,
      filler: 0,
    });
  });

  test("rcl2 infra push keeps one upgrader so RCL3 can advance during builds", () => {
    expect(desiredCreeps(2, 2, 0, true)).toEqual({
      harvester: 2,
      miner: 0,
      hauler: 0,
      upgrader: 1,
      builder: 4,
      filler: 0,
    });
  });

  test("rcl2 with partial containers unlocks miner/hauler for finished sources", () => {
    expect(desiredCreeps(2, 2, 1, false)).toEqual({
      harvester: 2,
      miner: 1,
      hauler: 1,
      upgrader: 2,
      builder: 0,
      filler: 0,
    });
  });

  test("rcl4 partial container keeps builders and funds miner/hauler while income is collapsed", () => {
    expect(
      desiredCreeps(4, 2, 1, true, {
        energyIncomePerTick: 2,
        spawnFillPct: 0.12,
        energyAvailable: 37,
      }),
    ).toEqual({
      harvester: 1,
      miner: 1,
      hauler: 1,
      upgrader: 0,
      builder: 4,
      filler: 0,
    });
  });

  test("rcl2 with all source containers switches to miner/hauler pairs", () => {
    expect(desiredCreeps(2, 2, 2, false)).toEqual({
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 3,
      builder: 0,
      filler: 0,
    });
  });

  test("rcl2 climb keeps upgraders even when construction sites exist", () => {
    expect(desiredCreeps(2, 2, 2, true, { energyIncomePerTick: 6 })).toEqual({
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 3,
      // Overnight winner: builderInfra=4 (was 2).
      builder: 4,
      filler: 0,
    });
  });

  test("rcl2 with containers but no live miners keeps a bridge harvester", () => {
    expect(
      desiredCreeps(2, 2, 2, true, {
        energyIncomePerTick: 6,
        minerCount: 0,
      }),
    ).toEqual({
      harvester: 2,
      miner: 2,
      hauler: 2,
      upgrader: 3,
      builder: 2,
      filler: 0,
    });
  });

  test("dedicated mining defers upgraders and boosts builders while extension sites exist", () => {
    expect(desiredCreeps(4, 2, 2, true, { energyIncomePerTick: 6 })).toEqual({
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 0,
      builder: 4,
      filler: 0,
    });
  });

  test("wants one filler once storage exists", () => {
    expect(
      desiredCreeps(4, 2, 2, false, { energyIncomePerTick: 6, hasStorage: true }),
    ).toMatchObject({ filler: 1 });
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
      filler: 0,
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

  test("does not demote miners when spawn is healthy despite stalled income metric", () => {
    // Spawn nearly full + energy in containers makes income look stalled;
    // converting miners to harvesters then starves the second source.
    expect(
      shouldFallbackToMobileHarvest(true, {
        energyIncomePerTick: 1,
        baselineIncome: 4,
        spawnFillPct: 0.86,
        energyAvailable: 310,
      }),
    ).toBe(false);
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 1,
        baselineIncome: 4,
        spawnFillPct: 0.86,
        energyAvailable: 310,
      }),
    ).toMatchObject({ miner: 2, harvester: 0, hauler: 2 });
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
  test("miner before hauler when economy is empty so fat haulers cannot starve miner spawn", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 0.8, spawnFillPct: 0.58, energyAvailable: 316 },
        { harvester: 0, miner: 0 },
        316,
      ),
    ).toEqual(["harvester", "miner", "filler", "hauler", "upgrader", "builder"]);
  });

  test("miner before hauler when dedicated mining has zero miners", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 1, spawnFillPct: 0.6, energyAvailable: 300 },
        { harvester: 0, miner: 0 },
        300,
      )[0],
    ).toBe("harvester");
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 5, spawnFillPct: 0.8 },
        { harvester: 1, miner: 0 },
        300,
      )[0],
    ).toBe("miner");
  });

  test("hauler first when dedicated mining is healthy", () => {
    expect(spawnPriorityOrder(true, { energyIncomePerTick: 5, spawnFillPct: 0.8 })).toEqual([
      "hauler",
      "miner",
      "filler",
      "harvester",
      "upgrader",
      "builder",
    ]);
  });

  test("keeps miner in order when spawn is healthy despite zero income metric", () => {
    expect(spawnPriorityOrder(true, { energyIncomePerTick: 0, spawnFillPct: 0.5 })).toEqual([
      "hauler",
      "miner",
      "filler",
      "harvester",
      "upgrader",
      "builder",
    ]);
  });

  test("hauler first when spawn is nearly empty during zero-income fallback", () => {
    expect(spawnPriorityOrder(true, { energyIncomePerTick: 0, spawnFillPct: 0.05 })).toEqual([
      "hauler",
      "filler",
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
      "filler",
      "upgrader",
      "builder",
    ]);
  });

  test("hauler first when economy creeps are zero and income is dead", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 0, spawnFillPct: 0.01 },
        { harvester: 0, miner: 0 },
        50,
      ),
    ).toEqual(["hauler", "harvester", "miner", "filler", "upgrader", "builder"]);
  });

  test("harvester first when empty crew but spawn can afford a worker", () => {
    expect(
      spawnPriorityOrder(
        false,
        { energyIncomePerTick: 0, spawnFillPct: 1, energyAvailable: 300 },
        { harvester: 0, miner: 0 },
        300,
      ),
    ).toEqual(["harvester", "miner", "filler", "hauler", "upgrader", "builder"]);
  });

  test("harvester first when economy creeps are zero but income positive", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 0.8, spawnFillPct: 0.01 },
        { harvester: 0, miner: 0 },
      ),
    ).toEqual(["harvester", "miner", "filler", "hauler", "upgrader", "builder"]);
  });

  test("hauler first when soft-locked below bootstrap energy (#36)", () => {
    expect(
      spawnPriorityOrder(
        false,
        { energyIncomePerTick: 0, spawnFillPct: 0.27 },
        { harvester: 0, miner: 0 },
        81,
      ),
    ).toEqual(["hauler", "harvester", "miner", "filler", "upgrader", "builder"]);
  });

  test("builder before upgrader when source-container infrastructure push", () => {
    expect(
      spawnPriorityOrder(false, { energyIncomePerTick: 2.7, spawnFillPct: 0.27 }, undefined, undefined, {
        infrastructurePush: true,
      }),
    ).toEqual(["hauler", "miner", "filler", "harvester", "builder", "upgrader"]);
  });

  test("builder before spare harvester when infra builders short and economy floor met", () => {
    expect(
      spawnPriorityOrder(
        false,
        { energyIncomePerTick: 1.7, spawnFillPct: 0.45 },
        { harvester: 2, miner: 0 },
        200,
        {
          infrastructurePush: true,
          buildersBelowQuota: true,
          economyFloorMet: true,
        },
      ),
    ).toEqual(["hauler", "miner", "filler", "builder", "harvester", "upgrader"]);
  });
});

describe("constructionPriority", () => {
  test("source containers before extensions when sources lack containers", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 0,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
    });
    // Only source containers — extensions wait until containers exist.
    expect(queue.filter((s) => s === "container")).toHaveLength(2);
    expect(queue[0]).toBe("container");
    expect(queue.filter((s) => s === "extension")).toHaveLength(0);
    expect(queue.includes("storage")).toBe(false);
    expect(queue.includes("road")).toBe(false);
  });

  test("controller container queued only after source containers exist", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: extensionQuota(2),
    });
    expect(queue.filter((s) => s === "container")).toHaveLength(1);
  });

  test("extensions deferred at RCL2 so climb can finish first", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
    });
    // Bootstrap capacity for fatter upgraders — not the full RCL2 quota.
    expect(queue.filter((s) => s === "extension")).toHaveLength(2);
  });

  test("tower leads at RCL3 once every source has a container", () => {
    const queue = constructionPriority(3, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
      towerCount: 0,
    });
    expect(queue[0]).toBe("tower");
    expect(queue.filter((s) => s === "tower")).toHaveLength(1);
    expect(queue.filter((s) => s === "extension")).toHaveLength(extensionQuota(3));
  });

  test("storage after tower and full extensions at RCL 4", () => {
    const queue = constructionPriority(4, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: extensionQuota(4),
      towerCount: 1,
    });
    expect(queue[0]).toBe("storage");
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

describe("isEconomyDepressed", () => {
  test("true at zero income; false when income is healthy even if spawn is low", () => {
    expect(isEconomyDepressed({ energyIncomePerTick: 0, spawnFillPct: 0.5 })).toBe(
      true,
    );
    expect(isEconomyDepressed({ energyIncomePerTick: 5, spawnFillPct: 0.2 })).toBe(
      false,
    );
    expect(isEconomyDepressed({ energyIncomePerTick: 5, spawnFillPct: 0.8 })).toBe(
      false,
    );
  });

  test("false when spawn is saturated even if measured income is zero", () => {
    expect(isEconomyDepressed({ energyIncomePerTick: 0, spawnFillPct: 1 })).toBe(
      false,
    );
    expect(isEconomyDepressed({ energyIncomePerTick: 0, spawnFillPct: 0.85 })).toBe(
      false,
    );
  });
});

describe("desiredCreeps extension push under saturated zero-income", () => {
  test("keeps 4 builders when income is healthy but spawn is nearly empty", () => {
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 12,
        spawnFillPct: 0.19,
        energyAvailable: 56,
      }),
    ).toEqual({
      harvester: 1,
      miner: 2,
      hauler: 2,
      upgrader: 0,
      builder: 4,
      filler: 0,
    });
  });

  test("keeps 4 builders when spawn full but income samples read zero", () => {
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 0,
        spawnFillPct: 1,
        energyAvailable: 300,
      }),
    ).toEqual({
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 0,
      builder: 4,
      filler: 0,
    });
  });
});

describe("isSoftLocked", () => {
  test("true when below hauler cost and nobody has CARRY", () => {
    expect(isSoftLocked(69, { harvester: 0, miner: 0 })).toBe(true);
    expect(isSoftLocked(5, { harvester: 1, miner: 0 })).toBe(true);
    expect(isSoftLocked(100, { harvester: 0, miner: 0 })).toBe(false);
    expect(isSoftLocked(5, { harvester: 1, miner: 0 }, true)).toBe(false);
  });
});

describe("bodyForRole", () => {
  test("miner is stationary: WORK parts + single MOVE", () => {
    const body = bodyForRole("miner", 300);
    expect(body.filter((p) => p === "work")).toHaveLength(2);
    expect(body.filter((p) => p === "move")).toHaveLength(1);
  });

  test("miner scales to 5 WORK + 1 MOVE at 550 energy", () => {
    const body = bodyForRole("miner", 550);
    expect(body.filter((p) => p === "work")).toHaveLength(5);
    expect(body.filter((p) => p === "move")).toHaveLength(1);
    expect(body).toEqual(["work", "work", "work", "work", "work", "move"]);
  });

  test("hauler uses carry/move pairs", () => {
    const body = bodyForRole("hauler", 300);
    expect(body.filter((p) => p === "carry").length).toBe(
      body.filter((p) => p === "move").length,
    );
  });

  test("filler is a small hub hauler capped at 300", () => {
    expect(bodyForRole("filler", 800)).toEqual(bodyForRole("hauler", 300));
  });

  test("worker refuses WORK+MOVE bootstrap (carry-less creeps cannot refill spawn)", () => {
    expect(bodyForRole("harvester", 150)).toEqual([]);
    expect(bodyForRole("harvester", 199)).toEqual([]);
  });

  test("worker returns empty body when energy cannot afford WORK+CARRY+MOVE", () => {
    expect(bodyForRole("harvester", 0)).toEqual([]);
    expect(bodyForRole("harvester", 100)).toEqual([]);
  });

  test("miner and hauler return empty when energy is insufficient", () => {
    expect(bodyForRole("miner", 100)).toEqual([]);
    expect(bodyForRole("hauler", 49)).toEqual([]);
  });

  test("hauler bootstrap body spawns at 100 energy when harvester needs 200", () => {
    expect(bodyForRole("hauler", 100)).toEqual(["carry", "move"]);
    expect(bodyForRole("harvester", 100)).toEqual([]);
    expect(bodyForRole("harvester", 200)).toEqual(["work", "carry", "move"]);
  });

  test("hauler caps body cost when mining is wiped so miner can still spawn", () => {
    expect(bodyForRole("hauler", 316, { haulerMaxCost: 100 })).toEqual([
      "carry",
      "move",
    ]);
    expect(bodyForRole("miner", 216)).toEqual(["work", "move"]);
  });

  test("hauler never spawns CARRY-only below MOVE+CARRY cost", () => {
    expect(bodyForRole("hauler", 50)).toEqual([]);
    expect(bodyForRole("hauler", 69)).toEqual([]);
    expect(bodyForRole("hauler", 99)).toEqual([]);
    expect(bodyForRole("hauler", 100)).toEqual(["carry", "move"]);
  });
});

describe("threshold constants", () => {
  test("documents early-game policy values", () => {
    expect(EARLY_GAME_THRESHOLDS.minRclForContainers).toBe(2);
    expect(EARLY_GAME_THRESHOLDS.minRclForWalls).toBe(3);
    expect(EARLY_GAME_THRESHOLDS.minRclForStorage).toBe(4);
  });
});
