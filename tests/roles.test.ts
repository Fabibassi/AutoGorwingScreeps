import { beforeEach, describe, expect, test, vi } from "vitest";
import { runMiner } from "../src/roles/miner";
import {
  findHarvesterDeliveryTarget,
  needsSpawnBankForInfraBuilder,
  runHarvester,
  shouldBuildSourceContainers,
} from "../src/roles/harvester";
import { registeredRoles, runCreep } from "../src/roles";

describe("shouldBuildSourceContainers", () => {
  test("remote build only when spawn healthy and source containers missing", () => {
    expect(shouldBuildSourceContainers(0.2, 0, 2)).toBe(true);
    expect(shouldBuildSourceContainers(0.19, 0, 2)).toBe(false);
    expect(shouldBuildSourceContainers(0.9, 2, 2)).toBe(false);
  });

  test("builders short: bank ~200/300 before remote container trips", () => {
    expect(
      shouldBuildSourceContainers(0.2, 0, 2, { buildersShort: true }),
    ).toBe(false);
    expect(
      shouldBuildSourceContainers(200 / 300, 0, 2, { buildersShort: true }),
    ).toBe(true);
  });
});

describe("needsSpawnBankForInfraBuilder", () => {
  test("banks spawn below 200 while builders are short", () => {
    expect(needsSpawnBankForInfraBuilder(63, 1)).toBe(true);
    expect(needsSpawnBankForInfraBuilder(199, 1)).toBe(true);
    expect(needsSpawnBankForInfraBuilder(200, 1)).toBe(false);
    expect(needsSpawnBankForInfraBuilder(0, 2)).toBe(false);
  });
});

describe("findHarvesterDeliveryTarget", () => {
  beforeEach(() => {
    vi.stubGlobal("FIND_MY_STRUCTURES", 108);
    vi.stubGlobal("STRUCTURE_EXTENSION", "extension");
    vi.stubGlobal("RESOURCE_ENERGY", "energy");
  });

  test("prefers spawn while it still has free capacity", () => {
    const spawn = {
      store: { getFreeCapacity: () => 50 },
    } as unknown as StructureSpawn;
    const ext = {
      structureType: "extension",
      store: { getFreeCapacity: () => 50 },
    };
    const creep = {
      pos: {
        findClosestByPath: (t: unknown) => (Array.isArray(t) ? t[0] : t),
        findClosestByRange: (t: unknown) => (Array.isArray(t) ? t[0] : t),
      },
      room: {
        find: () => [ext],
      },
    } as unknown as Creep;
    expect(findHarvesterDeliveryTarget(creep, spawn)).toBe(spawn);
  });

  test("fills hungry extensions when spawn is full (wipe recovery)", () => {
    const spawn = {
      store: { getFreeCapacity: () => 0 },
    } as unknown as StructureSpawn;
    const ext = {
      structureType: "extension",
      store: { getFreeCapacity: () => 50 },
    };
    const creep = {
      pos: {
        findClosestByPath: (t: unknown) => (Array.isArray(t) ? t[0] : t),
        findClosestByRange: (t: unknown) => (Array.isArray(t) ? t[0] : t),
      },
      room: {
        find: (type: number) => (type === FIND_MY_STRUCTURES ? [ext] : []),
      },
    } as unknown as Creep;
    expect(findHarvesterDeliveryTarget(creep, spawn)).toBe(ext);
  });
});

describe("runHarvester source-container push", () => {
  beforeEach(() => {
    vi.stubGlobal("OK", 0);
    vi.stubGlobal("ERR_NOT_IN_RANGE", -9);
    vi.stubGlobal("FIND_SOURCES", 105);
    vi.stubGlobal("FIND_SOURCES_ACTIVE", 104);
    vi.stubGlobal("FIND_MY_SPAWNS", 106);
    vi.stubGlobal("FIND_MY_STRUCTURES", 108);
    vi.stubGlobal("FIND_STRUCTURES", 107);
    vi.stubGlobal("FIND_CONSTRUCTION_SITES", 111);
    vi.stubGlobal("STRUCTURE_CONTAINER", "container");
    vi.stubGlobal("STRUCTURE_EXTENSION", "extension");
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
    const spawn = {
      store: {
        getUsedCapacity: () => 250,
        getCapacity: () => 300,
        getFreeCapacity: () => 50,
      },
    };
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
        name: "W1N1",
        find: (constType: number) => {
          if (constType === FIND_SOURCES || constType === FIND_SOURCES_ACTIVE) {
            return [source];
          }
          if (constType === FIND_MY_SPAWNS) return [spawn];
          return [];
        },
      },
    } as unknown as Creep;
    vi.stubGlobal("Game", {
      creeps: {
        "builder-1": {
          room: { name: "W1N1" },
          memory: { role: "builder" },
        },
        "builder-2": {
          room: { name: "W1N1" },
          memory: { role: "builder" },
        },
      },
    });

    expect(runHarvester(creep)).toBe(0);
    expect(build).toHaveBeenCalledWith(site);
    expect(harvest).not.toHaveBeenCalled();
  });

  test("banks spawn instead of local build while second infra builder is missing", () => {
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
    const transfer = vi.fn(() => 0);
    const spawn = {
      store: {
        getUsedCapacity: () => 63,
        getCapacity: () => 300,
        getFreeCapacity: () => 237,
      },
    };
    const creep = {
      store: {
        energy: 50,
        getCapacity: () => 50,
        getFreeCapacity: () => 0,
      },
      pos: {
        getRangeTo: () => 1,
        findClosestByPath: (target: unknown) =>
          Array.isArray(target) ? target[0] : target,
        findClosestByRange: (target: unknown) =>
          Array.isArray(target) ? target[0] : target,
      },
      build,
      harvest,
      transfer,
      moveTo: vi.fn(),
      getActiveBodyparts: () => 1,
      room: {
        name: "W1N1",
        find: (constType: number) => {
          if (constType === FIND_SOURCES || constType === FIND_SOURCES_ACTIVE) {
            return [source];
          }
          if (constType === FIND_MY_SPAWNS) return [spawn];
          return [];
        },
      },
    } as unknown as Creep;
    vi.stubGlobal("Game", {
      creeps: {
        "builder-1": {
          room: { name: "W1N1" },
          memory: { role: "builder" },
        },
      },
    });

    expect(runHarvester(creep)).toBe(0);
    expect(build).not.toHaveBeenCalled();
    expect(transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  test("fills empty extensions when spawn is full before remote container work", () => {
    const site = {
      id: "site1",
      structureType: "container",
      pos: { x: 20, y: 20, roomName: "W1N1" },
    };
    const source = {
      id: "s1",
      pos: {
        x: 10,
        y: 10,
        roomName: "W1N1",
        findInRange: () => [],
      },
    };
    const ext = {
      structureType: "extension",
      store: {
        getFreeCapacity: () => 50,
        getUsedCapacity: () => 0,
      },
    };
    const build = vi.fn(() => 0);
    const transfer = vi.fn(() => 0);
    const spawn = {
      store: {
        getUsedCapacity: () => 300,
        getCapacity: () => 300,
        getFreeCapacity: () => 0,
      },
    };
    const creep = {
      store: {
        energy: 50,
        getCapacity: () => 50,
        getFreeCapacity: () => 0,
      },
      pos: {
        getRangeTo: () => 10,
        findClosestByPath: (target: unknown) =>
          Array.isArray(target) ? target[0] : target,
        findClosestByRange: (target: unknown) =>
          Array.isArray(target) ? target[0] : target,
      },
      build,
      harvest: vi.fn(),
      transfer,
      moveTo: vi.fn(),
      getActiveBodyparts: () => 1,
      room: {
        name: "W1N1",
        find: (constType: number) => {
          if (constType === FIND_SOURCES || constType === FIND_SOURCES_ACTIVE) {
            return [source];
          }
          if (constType === FIND_MY_SPAWNS) return [spawn];
          if (constType === FIND_MY_STRUCTURES) return [ext];
          if (constType === FIND_CONSTRUCTION_SITES) return [site];
          return [];
        },
      },
    } as unknown as Creep;
    vi.stubGlobal("Game", {
      creeps: {
        "builder-1": {
          room: { name: "W1N1" },
          memory: { role: "builder" },
        },
        "builder-2": {
          room: { name: "W1N1" },
          memory: { role: "builder" },
        },
      },
    });

    expect(runHarvester(creep)).toBe(0);
    expect(transfer).toHaveBeenCalledWith(ext, "energy");
    expect(build).not.toHaveBeenCalled();
  });
});

describe("runMiner", () => {
  beforeEach(() => {
    vi.stubGlobal("ERR_FULL", -8);
    vi.stubGlobal("OK", 0);
    vi.stubGlobal("WORK", "work");
    vi.stubGlobal("FIND_MY_SPAWNS", 105);
  });

  test("harvests when adjacent to source (cannot stand on source tile)", () => {
    const harvest = vi.fn(() => 0);
    const moveTo = vi.fn(() => 0);
    const source = {
      id: "s1" as Id<Source>,
      pos: { x: 10, y: 10, roomName: "W1N1" },
    };
    const creep = {
      memory: { sourceId: "s1" as Id<Source> },
      pos: {
        isEqualTo: () => false,
        isNearTo: (target: { pos?: { x: number; y: number } } | { x: number; y: number }) => {
          const pos = "pos" in target && target.pos ? target.pos : (target as { x: number; y: number });
          return pos.x === 10 && pos.y === 10;
        },
      },
      harvest,
      getActiveBodyparts: () => 3,
      moveTo,
      room: { find: () => [] },
    } as unknown as Creep;

    vi.stubGlobal("Game", {
      getObjectById: () => source,
    });

    expect(runMiner(creep)).toBe(6);
    expect(harvest).toHaveBeenCalledWith(source);
    expect(moveTo).not.toHaveBeenCalled();
  });

  test("stays put when harvest returns ERR_FULL (no walk oscillation)", () => {
    const moveTo = vi.fn(() => 0);
    const move = vi.fn(() => 0);
    const source = {
      id: "s1" as Id<Source>,
      pos: { x: 10, y: 10, roomName: "W1N1" },
    };
    const creep = {
      memory: { sourceId: "s1" as Id<Source> },
      pos: {
        x: 10,
        y: 11,
        isEqualTo: () => false,
        isNearTo: () => true,
      },
      harvest: vi.fn(() => -8),
      getActiveBodyparts: () => 2,
      moveTo,
      move,
      room: {
        find: () => [{ pos: { x: 25, y: 25 } }],
        controller: { pos: { x: 30, y: 30 } },
      },
    } as unknown as Creep;

    vi.stubGlobal("Game", {
      getObjectById: () => source,
    });

    expect(runMiner(creep)).toBe(0);
    expect(moveTo).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
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
        isNearTo: () => true,
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

  test("unassigned miner claims the empty far source when the near one is taken", () => {
    vi.stubGlobal("FIND_SOURCES", 105);
    const near = {
      id: "near" as Id<Source>,
      pos: { x: 10, y: 10, roomName: "W1N1" },
    };
    const far = {
      id: "far" as Id<Source>,
      pos: { x: 40, y: 40, roomName: "W1N1" },
    };
    const moveTo = vi.fn(() => 0);
    const creep = {
      name: "miner-b",
      memory: { role: "miner" },
      pos: {
        x: 25,
        y: 25,
        getRangeTo: (t: { pos?: { x: number; y: number }; x?: number }) => {
          const p = "pos" in t && t.pos ? t.pos : (t as { x: number; y: number });
          return Math.max(Math.abs(25 - p.x), Math.abs(25 - p.y));
        },
        isNearTo: () => false,
      },
      harvest: vi.fn(),
      getActiveBodyparts: () => 5,
      moveTo,
      room: {
        name: "W1N1",
        find: (t: number) => (t === FIND_SOURCES ? [near, far] : []),
      },
    } as unknown as Creep;

    vi.stubGlobal("Game", {
      getObjectById: (id: string) => (id === "near" ? near : id === "far" ? far : null),
      creeps: {
        "miner-a": {
          name: "miner-a",
          room: { name: "W1N1" },
          memory: { role: "miner", sourceId: "near" },
        },
        "miner-b": creep,
      },
    });

    expect(runMiner(creep)).toBe(0);
    expect(creep.memory.sourceId).toBe("far");
    expect(moveTo).toHaveBeenCalledWith(far, expect.anything());
  });

  test("incoming replacement waits instead of harvesting while incumbent is on the source", () => {
    const harvest = vi.fn(() => 0);
    const source = {
      id: "s1" as Id<Source>,
      pos: { x: 10, y: 10, roomName: "W1N1" },
    };
    const creep = {
      name: "miner-new",
      ticksToLive: 1490,
      memory: { sourceId: "s1" as Id<Source>, role: "miner" },
      pos: { isNearTo: () => true },
      harvest,
      getActiveBodyparts: () => 5,
      moveTo: vi.fn(),
      room: { find: () => [] },
    } as unknown as Creep;

    vi.stubGlobal("Game", {
      getObjectById: () => source,
      creeps: {
        "miner-new": creep,
        "miner-old": {
          name: "miner-old",
          ticksToLive: 40,
          memory: { sourceId: "s1", role: "miner" },
          pos: { isNearTo: () => true },
        },
      },
    });

    expect(runMiner(creep)).toBe(0);
    expect(harvest).not.toHaveBeenCalled();
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
        "filler",
        "builder",
        "upgrader",
      ]),
    );
  });
});
