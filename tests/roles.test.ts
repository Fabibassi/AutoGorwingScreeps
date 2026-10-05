import { beforeEach, describe, expect, test, vi } from "vitest";
import { runMiner } from "../src/roles/miner";
import { runHarvester, shouldBuildSourceContainers } from "../src/roles/harvester";
import { registeredRoles, runCreep } from "../src/roles";

describe("shouldBuildSourceContainers", () => {
  test("remote build only when spawn healthy and source containers missing", () => {
    expect(shouldBuildSourceContainers(0.2, 0, 2)).toBe(true);
    expect(shouldBuildSourceContainers(0.19, 0, 2)).toBe(false);
    expect(shouldBuildSourceContainers(0.9, 2, 2)).toBe(false);
  });
});

describe("runHarvester source-container push", () => {
  beforeEach(() => {
    vi.stubGlobal("OK", 0);
    vi.stubGlobal("ERR_NOT_IN_RANGE", -9);
    vi.stubGlobal("FIND_SOURCES", 105);
    vi.stubGlobal("FIND_SOURCES_ACTIVE", 104);
    vi.stubGlobal("FIND_MY_SPAWNS", 106);
    vi.stubGlobal("FIND_STRUCTURES", 107);
    vi.stubGlobal("FIND_CONSTRUCTION_SITES", 111);
    vi.stubGlobal("STRUCTURE_CONTAINER", "container");
    vi.stubGlobal("RESOURCE_ENERGY", "energy");
    vi.stubGlobal("WORK", "work");
  });

  test("builds local source-container site with partial energy before harvesting more", () => {
    const site = {
      id: "site1",
      structureType: "container",
      pos: { x: 10, y: 11, roomName: "W1N1" },
    };
    const source = {
      id: "s1",
      pos: {
        x: 10,
        y: 10,
        roomName: "W1N1",
        findInRange: (type: number) =>
          type === FIND_CONSTRUCTION_SITES ? [site] : [],
      },
    };
    const build = vi.fn(() => 0);
    const harvest = vi.fn(() => 0);
    const creep = {
      store: {
        energy: 45,
        getCapacity: () => 50,
        getFreeCapacity: () => 5,
      },
      pos: {
        getRangeTo: (t: { pos?: { x: number; y: number } } | { x: number; y: number }) => {
          const p = "pos" in t && t.pos ? t.pos : (t as { x: number; y: number });
          return Math.max(Math.abs(10 - p.x), Math.abs(10 - p.y));
        },
        findClosestByPath: (target: unknown) =>
          Array.isArray(target) ? target[0] : target,
        findClosestByRange: (target: unknown) =>
          Array.isArray(target) ? target[0] : target,
      },
      build,
      harvest,
      moveTo: vi.fn(),
      getActiveBodyparts: () => 1,
      room: {
        find: (constType: number) => {
          if (constType === FIND_SOURCES || constType === FIND_SOURCES_ACTIVE) {
            return [source];
          }
          if (constType === FIND_MY_SPAWNS) return [];
          return [];
        },
      },
    } as unknown as Creep;

    expect(runHarvester(creep)).toBe(0);
    expect(build).toHaveBeenCalledWith(site);
    expect(harvest).not.toHaveBeenCalled();
  });
});

describe("runMiner", () => {
  beforeEach(() => {
    vi.stubGlobal("ERR_FULL", -8);
    vi.stubGlobal("OK", 0);
    vi.stubGlobal("WORK", "work");
    vi.stubGlobal("FIND_MY_SPAWNS", 105);
  });

  test("retreats from source when harvest returns ERR_FULL", () => {
    const moveTo = vi.fn(() => 0);
    const source = {
      id: "s1" as Id<Source>,
      pos: { x: 10, y: 10, roomName: "W1N1" },
    };
    const creep = {
      memory: { sourceId: "s1" as Id<Source> },
      pos: {
        isEqualTo: (pos: { x: number; y: number }) =>
          pos.x === 10 && pos.y === 10,
      },
      harvest: vi.fn(() => -8),
      getActiveBodyparts: () => 2,
      moveTo,
      room: {
        find: () => [{ pos: { x: 25, y: 25 } }],
        controller: { pos: { x: 30, y: 30 } },
      },
    } as unknown as Creep;

    vi.stubGlobal("Game", {
      getObjectById: () => source,
    });

    expect(runMiner(creep)).toBe(0);
    expect(moveTo).toHaveBeenCalled();
  });

  test("counts harvest power when mining succeeds", () => {
    const source = {
      id: "s1" as Id<Source>,
      pos: { x: 10, y: 10, roomName: "W1N1" },
    };
    const creep = {
      memory: { sourceId: "s1" as Id<Source> },
      pos: {
        isEqualTo: () => true,
      },
      harvest: vi.fn(() => 0),
      getActiveBodyparts: () => 3,
      moveTo: vi.fn(),
      room: { find: () => [] },
    } as unknown as Creep;

    vi.stubGlobal("Game", {
      getObjectById: () => source,
    });

    expect(runMiner(creep)).toBe(6);
  });
});

describe("runCreep", () => {
  test("returns 0 for unknown role", () => {
    const creep = { memory: { role: "scout" } } as Creep;
    expect(runCreep(creep)).toBe(0);
  });

  test("returns 0 when role is missing", () => {
    const creep = { memory: {} } as Creep;
    expect(runCreep(creep)).toBe(0);
  });

  test("registeredRoles includes core and early-game roles", () => {
    expect(registeredRoles()).toEqual(
      expect.arrayContaining([
        "harvester",
        "miner",
        "hauler",
        "builder",
        "upgrader",
      ]),
    );
  });
});
