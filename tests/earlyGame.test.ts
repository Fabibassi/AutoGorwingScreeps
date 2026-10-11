import { describe, expect, test } from "vitest";
import {
  bodyForRole,
  constructionPriority,
  desiredCreeps,
  EARLY_GAME_THRESHOLDS,
  effectiveMinerMinWork,
  estimateMiningPerTick,
  extensionQuota,
  extensionsNeededForMinerWork,
  haulerCountForMining,
  isSoftLocked,
  minerTargetWorkParts,
  shouldBankForBetterMiners,
  minerMinWorkForSpawn,
  sourceContainerEnergySurplus,
  stagedExtensionBuildCap,
  shouldBuildContainers,
  shouldBuildRoads,
  shouldBuildStorage,
  shouldBuildWalls,
  spawnPriorityOrder,
  isEconomyDepressed,
  profileForVariant,
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
    expect(
      useDedicatedMiners(2, 0, 2, profileForVariant("bootstrapStrategy", "b_drop")),
    ).toBe(true);
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

describe("miner quality banking", () => {
  test("target WORK scales with room energy capacity", () => {
    expect(minerTargetWorkParts(150)).toBe(1);
    expect(minerTargetWorkParts(300)).toBe(2);
    expect(minerTargetWorkParts(550)).toBe(5);
    expect(minerTargetWorkParts(800)).toBe(5);
  });

  test("extension build stages unlock 3W then 5W; RCL5 fills quota", () => {
    expect(extensionsNeededForMinerWork(3)).toBe(1);
    expect(extensionsNeededForMinerWork(5)).toBe(5);
    // Before 3W miners: only enough extensions for a 3W body.
    expect(
      stagedExtensionBuildCap({
        fullQuota: 10,
        minerWorkParts: 2,
        sourceCount: 2,
      }),
    ).toBe(1);
    // 3W seats filled → open the 5W capacity gate.
    expect(
      stagedExtensionBuildCap({
        fullQuota: 10,
        minerWorkParts: 6,
        sourceCount: 2,
      }),
    ).toBe(5);
    // 5W seats filled pre-RCL5 → stay at the 5W gate.
    expect(
      stagedExtensionBuildCap({
        fullQuota: 10,
        minerWorkParts: 10,
        sourceCount: 2,
        rcl: 4,
      }),
    ).toBe(5);
    // RCL5 unlocks full RCL quota for the hub wave.
    expect(
      stagedExtensionBuildCap({
        fullQuota: 30,
        minerWorkParts: 6,
        sourceCount: 2,
        rcl: 5,
      }),
    ).toBe(30);
  });

  test("banks when capacity allows fat miners but live WORK is thin", () => {
    expect(
      shouldBankForBetterMiners({
        energyCapacityAvailable: 800,
        minerWorkParts: 2,
        sourceCount: 2,
      }),
    ).toBe(true);
    expect(
      shouldBankForBetterMiners({
        energyCapacityAvailable: 800,
        minerWorkParts: 10,
        sourceCount: 2,
      }),
    ).toBe(false);
  });

  test("effective miner min WORK waits for capacity-sized bodies", () => {
    expect(effectiveMinerMinWork(1, 800)).toBe(5);
    expect(effectiveMinerMinWork(1, 300)).toBe(2);
    expect(effectiveMinerMinWork(3, 300)).toBe(3);
  });

  test("extension push stays lean while banking for better miners", () => {
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 6,
        minerWorkParts: 2,
        minerCount: 2,
        energyCapacityAvailable: 800,
      }),
    ).toMatchObject({ builder: 2, miner: 2, harvester: 0 });
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

  test("b_chain baseline drop-mines without containers", () => {
    expect(desiredCreeps(2, 2, 0, false)).toEqual({
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 3,
      builder: 0,
      filler: 0,
    });
  });

  test("control profile keeps mobile harvesters without containers", () => {
    const control = profileForVariant("bootstrapStrategy", "control");
    expect(desiredCreeps(2, 2, 0, false, undefined, control)).toEqual({
      harvester: 3,
      miner: 0,
      hauler: 0,
      upgrader: 2,
      builder: 0,
      filler: 0,
    });
  });

  test("control: rcl4 zero income wants hauler during infra push", () => {
    const control = profileForVariant("bootstrapStrategy", "control");
    expect(
      desiredCreeps(
        4,
        2,
        0,
        true,
        {
          energyIncomePerTick: 0,
          spawnFillPct: 0.27,
          energyAvailable: 152,
        },
        control,
      ),
    ).toEqual({
      // Infra push: sources only (no spare H) so builders can claim spawn.
      harvester: 2,
      miner: 0,
      hauler: 1,
      upgrader: 1,
      builder: 4,
      filler: 0,
    });
  });

  test("overnight baseline infra push uses drop miners + builderInfra=4", () => {
    expect(desiredCreeps(2, 2, 0, true)).toEqual({
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 3,
      builder: 4,
      filler: 0,
    });
  });

  test("control: partial containers unlock miner/hauler for finished sources", () => {
    const control = profileForVariant("bootstrapStrategy", "control");
    expect(desiredCreeps(2, 2, 1, false, undefined, control)).toEqual({
      harvester: 2,
      miner: 1,
      hauler: 1,
      upgrader: 2,
      builder: 0,
      filler: 0,
    });
  });

  test("partial containers still want full miner/hauler pairs", () => {
    expect(
      desiredCreeps(4, 2, 1, true, {
        energyIncomePerTick: 2,
        spawnFillPct: 0.12,
        energyAvailable: 37,
        minerCount: 0,
      }),
    ).toEqual({
      // Bridge harvester while miners are wiped; drop-mine seats stay at 2.
      harvester: 1,
      miner: 2,
      hauler: 2,
      upgrader: 1,
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
      // Cap builders while mining seats are empty so spawn prefers miners.
      builder: 2,
      filler: 0,
    });
  });

  test("partial miner staffing does not spawn a mobile harvester", () => {
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 6,
        minerCount: 1,
        minerWorkParts: 5,
      }),
    ).toMatchObject({ harvester: 0, miner: 2 });
  });

  test("dedicated mining keeps one emergency upgrader while boosting builders", () => {
    expect(desiredCreeps(4, 2, 2, true, { energyIncomePerTick: 6 })).toEqual({
      harvester: 0,
      miner: 2,
      hauler: 2,
      upgrader: 1,
      builder: 4,
      filler: 0,
    });
  });

  test("wants one filler once storage exists", () => {
    expect(
      desiredCreeps(4, 2, 2, false, { energyIncomePerTick: 6, hasStorage: true }),
    ).toMatchObject({ filler: 1 });
  });

  test("hub spend mode keeps upgrade pressure with storage surplus", () => {
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 6,
        hasStorage: true,
        storageEnergy: 1200,
        minerWorkParts: 10,
        energyCapacityAvailable: 1300,
        rcl5Mode: "hub_spend",
      }),
    ).toMatchObject({ filler: 1, upgrader: 2, builder: 2 });
  });

  test("hub spend mode also triggers from full spawn plus container surplus", () => {
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 6,
        hasStorage: true,
        storageEnergy: 200,
        sourceContainerEnergy: 3500,
        energyAvailable: 1300,
        energyCapacityAvailable: 1300,
        minerWorkParts: 10,
        rcl5Mode: "hub_spend",
      }),
    ).toMatchObject({ filler: 1, upgrader: 2 });
  });

  test("default rcl5 mode after storage is upgrade_rush", () => {
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 10,
        hasStorage: true,
        storageEnergy: 2000,
        minerWorkParts: 10,
        energyCapacityAvailable: 1300,
      }),
    ).toMatchObject({ filler: 1, upgrader: 4, builder: 1 });
  });

  test("rcl2 zero income keeps haulers to drain trapped container energy", () => {
    expect(
      desiredCreeps(2, 2, 2, true, {
        energyIncomePerTick: 0,
        baselineIncome: 4,
      }),
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
    expect(
      shouldFallbackToMobileHarvest(true, {
        energyIncomePerTick: 0,
        baselineIncome: 4,
      }),
    ).toBe(true);
    expect(
      shouldFallbackToMobileHarvest(true, {
        energyIncomePerTick: 5,
        baselineIncome: 4,
      }),
    ).toBe(false);
  });

  test("boot into containered room keeps miner pipeline without baseline", () => {
    expect(shouldFallbackToMobileHarvest(true, { energyIncomePerTick: 0 })).toBe(
      false,
    );
    expect(
      desiredCreeps(4, 2, 2, false, {
        energyIncomePerTick: 0,
        energyAvailable: 50,
        spawnFillPct: 0.1,
      }),
    ).toMatchObject({ miner: 2 });
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

  test("live miners plus full source containers do not spawn a bootstrap harvester", () => {
    expect(
      shouldFallbackToMobileHarvest(true, {
        energyIncomePerTick: 0,
        spawnFillPct: 0.1,
        energyAvailable: 80,
        minerCount: 2,
        minerWorkParts: 10,
      }),
    ).toBe(false);
    expect(
      desiredCreeps(4, 2, 2, true, {
        energyIncomePerTick: 0,
        spawnFillPct: 0.1,
        energyAvailable: 80,
        minerCount: 2,
        minerWorkParts: 10,
      }),
    ).toMatchObject({ miner: 2, harvester: 0 });
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
        { containersAtSources: 2 },
      ),
    ).toEqual(["miner", "filler", "hauler", "harvester", "upgrader", "builder"]);
  });

  test("miner before hauler when dedicated mining has zero miners", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 1, spawnFillPct: 0.6, energyAvailable: 300 },
        { harvester: 0, miner: 0 },
        300,
        { containersAtSources: 2 },
      )[0],
    ).toBe("miner");
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 5, spawnFillPct: 0.8 },
        { harvester: 1, miner: 0 },
        300,
        { containersAtSources: 2 },
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
    // Fallback demotes want.miner→0; spawn still sees dedicatedMiners + empty
    // miner seats and recruits miners first (hauler cannot unlock static mining).
    expect(
      spawnPriorityOrder(
        true,
        {
          energyIncomePerTick: 0,
          spawnFillPct: 0.05,
          baselineIncome: 4,
        },
        { harvester: 0, miner: 0 },
        undefined,
        { containersAtSources: 2 },
      ),
    ).toEqual([
      "miner",
      "filler",
      "hauler",
      "harvester",
      "upgrader",
      "builder",
    ]);
  });

  test("miner first when container seats exist but roster is empty", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 0, spawnFillPct: 0.1, energyAvailable: 200 },
        { harvester: 0, miner: 0 },
        200,
        { containersAtSources: 2 },
      )[0],
    ).toBe("miner");
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
    // Soft-lock / low energy: hauler consolidates before miner body fits.
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

  test("miner first when dedicated seats empty even if income positive", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 0.8, spawnFillPct: 0.01 },
        { harvester: 0, miner: 0 },
        200,
        { containersAtSources: 2 },
      ),
    ).toEqual(["miner", "filler", "hauler", "harvester", "upgrader", "builder"]);
  });

  test("drop-miner boot without containers still prefers harvester/hauler economy", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 0, spawnFillPct: 0.01 },
        { harvester: 0, miner: 0 },
        300,
        { containersAtSources: 0 },
      )[0],
    ).toBe("harvester");
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

  test("builder before hauler when extension builders missing and miners staffed", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 12, spawnFillPct: 0.4 },
        { harvester: 0, miner: 2 },
        200,
        {
          buildersBelowQuota: true,
          economyFloorMet: true,
        },
      ),
    ).toEqual(["miner", "filler", "builder", "hauler", "harvester", "upgrader"]);
  });

  test("empty upgrader seat beats builder priority during RCL2 climb", () => {
    expect(
      spawnPriorityOrder(
        true,
        { energyIncomePerTick: 12, spawnFillPct: 1 },
        { harvester: 0, miner: 2 },
        300,
        {
          buildersBelowQuota: true,
          economyFloorMet: true,
          upgraderSeatEmpty: true,
          spawnChain: "miner_hauler",
        },
      ),
    ).toEqual(["miner", "filler", "upgrader", "builder", "hauler", "harvester"]);
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
    // overnight immediate: both source containers at once.
    expect(queue.filter((s) => s === "container")).toHaveLength(2);
    expect(queue[0]).toBe("container");
    expect(queue.filter((s) => s === "extension")).toHaveLength(0);
    expect(queue.includes("storage")).toBe(false);
    expect(queue.includes("road")).toBe(false);
  });

  test("control queues both source containers at once", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 0,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
      experiment: profileForVariant("bootstrapStrategy", "control"),
    });
    expect(queue.filter((s) => s === "container")).toHaveLength(2);
  });

  test("controller container deferred until RCL4 by default", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: extensionQuota(2),
    });
    expect(queue.filter((s) => s === "container")).toHaveLength(0);
  });

  test("after_sources queues controller container once sources are done", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: extensionQuota(2),
      experiment: profileForVariant("controllerContainer", "after_sources"),
    });
    expect(queue.filter((s) => s === "container")).toHaveLength(1);
  });

  test("extensions start at the 3W gate before miners are upgraded", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
      minerWorkParts: 2,
    });
    // Stage 1: one extension unlocks 3W1M (350), not the full RCL2 quota.
    expect(queue.filter((s) => s === "extension")).toHaveLength(1);
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
      minerWorkParts: 10,
    });
    expect(queue[0]).toBe("tower");
    expect(queue.filter((s) => s === "tower")).toHaveLength(1);
    // Fat miners still only queue the 5W capacity gate (5), not full RCL3 quota.
    expect(queue.filter((s) => s === "extension")).toHaveLength(5);
  });

  test("RCL3 with thin miners only queues the 3W extension gate", () => {
    const queue = constructionPriority(3, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
      towerCount: 1,
      minerWorkParts: 2,
    });
    expect(queue.filter((s) => s === "extension")).toHaveLength(1);
  });

  test("does not re-queue extensions while banking into existing capacity", () => {
    // 10 finished extensions (capacity 800) + thin miners: upgrade bodies, don't place sites.
    const queue = constructionPriority(3, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 10,
      extensionBuilt: 10,
      towerCount: 1,
      minerWorkParts: 2,
      energyCapacityAvailable: 800,
    });
    expect(queue.filter((s) => s === "extension")).toHaveLength(0);
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

  test("sourceContainerEnergySurplus gates the 3k bank", () => {
    expect(sourceContainerEnergySurplus(2999)).toBe(false);
    expect(sourceContainerEnergySurplus(3000)).toBe(true);
  });

  test("surplus queues storage before extensions at RCL 4", () => {
    const queue = constructionPriority(4, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
      towerCount: 1,
      minerWorkParts: 10,
      sourceContainerEnergy: 3200,
    });
    expect(queue[0]).toBe("storage");
    expect(queue.indexOf("storage")).toBeLessThan(queue.indexOf("extension"));
  });

  test("open storage site also prioritizes storage before extensions", () => {
    const queue = constructionPriority(4, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
      towerCount: 1,
      minerWorkParts: 10,
      storageSiteOpen: true,
    });
    expect(queue[0]).toBe("storage");
    const storageIdx = queue.indexOf("storage");
    const controllerContainerIdx = queue.indexOf("container");
    expect(storageIdx).toBeLessThan(queue.indexOf("extension"));
    expect(storageIdx).toBeLessThan(controllerContainerIdx);
  });

  test("without surplus keeps extensions before storage", () => {
    const queue = constructionPriority(4, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
      towerCount: 1,
      minerWorkParts: 10,
      sourceContainerEnergy: 500,
    });
    expect(queue.indexOf("extension")).toBeLessThan(queue.indexOf("storage"));
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
      upgrader: 1,
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
      upgrader: 1,
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

  test("bridge miner stays 1W even when spawn energy could grow a mid body", () => {
    expect(
      bodyForRole("miner", 300, { minerMinWork: 1, minerMaxWork: 1 }),
    ).toEqual(["work", "move"]);
  });

  test("hauler uses carry/move pairs", () => {
    const body = bodyForRole("hauler", 300);
    expect(body.filter((p) => p === "carry").length).toBe(
      body.filter((p) => p === "move").length,
    );
  });

  test("filler defaults to thin hub hauler capped at 300", () => {
    expect(bodyForRole("filler", 800)).toEqual(bodyForRole("hauler", 300));
  });

  test("filler can grow when fillerMaxCost is raised", () => {
    expect(bodyForRole("filler", 800, { fillerMaxCost: 800 })).toEqual(
      bodyForRole("hauler", 800),
    );
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

describe("minerMinWorkForSpawn", () => {
  test("keeps fat min-work when the bank can fund it", () => {
    expect(
      minerMinWorkForSpawn({
        preferredMinWork: 5,
        energyAvailable: 550,
        seatsUncovered: true,
      }),
    ).toBe(5);
  });

  test("bridges with 1W when a seat is empty and energy is under the fat body", () => {
    expect(
      minerMinWorkForSpawn({
        preferredMinWork: 5,
        energyAvailable: 500,
        seatsUncovered: true,
      }),
    ).toBe(1);
  });

  test("does not bridge when every seat is already covered", () => {
    expect(
      minerMinWorkForSpawn({
        preferredMinWork: 5,
        energyAvailable: 500,
        seatsUncovered: false,
      }),
    ).toBe(5);
  });

  test("pre-spawn waits for fat body when storage reserve is fat but spawn pool is thin", () => {
    expect(
      minerMinWorkForSpawn({
        preferredMinWork: 5,
        energyAvailable: 400,
        seatsUncovered: true,
        isPrespawn: true,
        storageEnergy: 20_000,
        storageWaitReserve: 2000,
      }),
    ).toBe(5);
  });

  test("pre-spawn still bridges when storage is too lean to justify waiting", () => {
    expect(
      minerMinWorkForSpawn({
        preferredMinWork: 5,
        energyAvailable: 400,
        seatsUncovered: true,
        isPrespawn: true,
        storageEnergy: 1500,
        storageWaitReserve: 2000,
      }),
    ).toBe(1);
  });

  test("true uncovered seat bridges even with a fat storage bank", () => {
    expect(
      minerMinWorkForSpawn({
        preferredMinWork: 5,
        energyAvailable: 400,
        seatsUncovered: true,
        isPrespawn: false,
        storageEnergy: 100_000,
        storageWaitReserve: 2000,
      }),
    ).toBe(1);
  });
});

describe("threshold constants", () => {
  test("documents early-game policy values", () => {
    expect(EARLY_GAME_THRESHOLDS.minRclForContainers).toBe(2);
    expect(EARLY_GAME_THRESHOLDS.minRclForWalls).toBe(3);
    expect(EARLY_GAME_THRESHOLDS.minRclForStorage).toBe(4);
  });
});
