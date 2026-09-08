import { describe, expect, test } from "vitest";
import {
  bodyForRole,
  constructionPriority,
  desiredCreeps,
  EARLY_GAME_THRESHOLDS,
  shouldBuildContainers,
  shouldBuildRoads,
  shouldBuildStorage,
  shouldBuildWalls,
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

  test("rcl2 dedicated mining keeps bootstrap harvester when income is zero", () => {
    expect(
      desiredCreeps(2, 2, 2, true, { energyIncomePerTick: 0 }),
    ).toMatchObject({
      harvester: 1,
      miner: 2,
      hauler: 2,
    });
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

describe("constructionPriority", () => {
  test("source containers before controller container before storage", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 0,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
    });
    expect(queue.filter((s) => s === "container")).toHaveLength(3);
    expect(queue.includes("storage")).toBe(false);
    expect(queue.includes("road")).toBe(false);
  });

  test("storage queued at RCL 4 when missing", () => {
    const queue = constructionPriority(4, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
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
    });
    expect(queue.at(-1)).toBe("road");
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
});

describe("threshold constants", () => {
  test("documents early-game policy values", () => {
    expect(EARLY_GAME_THRESHOLDS.minRclForContainers).toBe(2);
    expect(EARLY_GAME_THRESHOLDS.minRclForWalls).toBe(3);
    expect(EARLY_GAME_THRESHOLDS.minRclForStorage).toBe(4);
  });
});
