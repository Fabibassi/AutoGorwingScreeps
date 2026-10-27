import { afterEach, describe, expect, test, vi } from "vitest";
import {
  homeReadyForRemotes,
  recycleExcessRemoteHaulers,
  trySpawnRemote,
} from "../src/spawnRemote";

describe("homeReadyForRemotes", () => {
  test("needs miners and a filler", () => {
    expect(
      homeReadyForRemotes({
        homeMiners: 2,
        homeMinerWant: 2,
        homeFillers: 1,
      }),
    ).toBe(true);
    expect(
      homeReadyForRemotes({
        homeMiners: 1,
        homeMinerWant: 2,
        homeFillers: 0,
      }),
    ).toBe(false);
    expect(
      homeReadyForRemotes({
        homeMiners: 0,
        homeMinerWant: 2,
        homeFillers: 1,
      }),
    ).toBe(false);
  });
});

describe("recycleExcessRemoteHaulers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("recycles surplus empty remoteHauler near spawn", () => {
    vi.stubGlobal("OK", 0);
    vi.stubGlobal("RESOURCE_ENERGY", "energy");
    const roomName = "W0N0";
    const spawnPos = { x: 10, y: 10, roomName };
    const creep = {
      name: "rh-1",
      room: { name: roomName },
      pos: {
        x: 10,
        y: 11,
        roomName,
        isNearTo: () => true,
      },
      memory: { role: "remoteHauler", homeRoom: roomName } as CreepMemory,
      store: { getUsedCapacity: () => 0, energy: 0 },
      moveTo: vi.fn(),
    };
    const spawn = {
      spawning: null,
      room: {
        name: roomName,
        controller: { level: 6 },
        storage: undefined,
      },
      pos: spawnPos,
      recycleCreep: vi.fn(() => 0),
    };
    // Plan off → want 0 → any live remoteHauler is surplus.
    vi.stubGlobal("Memory", {
      ags: {
        remotePlan: "off",
        remotePathLength: 10,
        remoteRoom: "W0N1",
      },
    });
    vi.stubGlobal("Game", {
      creeps: { "rh-1": creep },
      rooms: {},
      map: { describeExits: () => ({}) },
    });
    const ok = recycleExcessRemoteHaulers(spawn as unknown as StructureSpawn);
    expect(ok).toBe(true);
    expect(spawn.recycleCreep).toHaveBeenCalledWith(creep);
    expect(creep.memory.recycling).toBe(true);
  });

  test("noop when at or under quota", () => {
    const roomName = "W0N0";
    const spawn = {
      spawning: null,
      room: {
        name: roomName,
        controller: { level: 6 },
        storage: undefined,
      },
      recycleCreep: vi.fn(),
    };
    vi.stubGlobal("Game", { creeps: {}, rooms: {} });
    vi.stubGlobal("Memory", {
      ags: {
        remotePlan: "reserved_drop",
        remotePathLength: 10,
        remoteRoom: "W0N1",
      },
    });
    expect(
      recycleExcessRemoteHaulers(spawn as unknown as StructureSpawn),
    ).toBe(false);
    expect(spawn.recycleCreep).not.toHaveBeenCalled();
  });

  test("never recycles under storage floor even when over quota", () => {
    vi.stubGlobal("OK", 0);
    vi.stubGlobal("RESOURCE_ENERGY", "energy");
    const roomName = "W0N0";
    const creep = {
      name: "rh-1",
      room: { name: roomName },
      pos: { isNearTo: () => true },
      memory: { role: "remoteHauler", homeRoom: roomName } as CreepMemory,
      store: { getUsedCapacity: () => 0, energy: 0 },
      moveTo: vi.fn(),
    };
    const spawn = {
      spawning: null,
      room: {
        name: roomName,
        controller: { level: 6 },
        storage: { store: { energy: 5_000 } },
      },
      recycleCreep: vi.fn(() => 0),
    };
    vi.stubGlobal("Memory", {
      ags: { remotePlan: "off", remotePathLength: 10, remoteRoom: "W0N1" },
    });
    vi.stubGlobal("Game", {
      creeps: { "rh-1": creep },
      rooms: {},
      map: { describeExits: () => ({}) },
    });
    expect(
      recycleExcessRemoteHaulers(spawn as unknown as StructureSpawn),
    ).toBe(false);
    expect(spawn.recycleCreep).not.toHaveBeenCalled();
  });
});

describe("trySpawnRemote restaff under floor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubRemoteWorld(opts: {
    storageEnergy: number;
    creeps?: Record<string, { memory: CreepMemory }>;
    energyAvailable?: number;
  }) {
    vi.stubGlobal("OK", 0);
    vi.stubGlobal("RESOURCE_ENERGY", "energy");
    vi.stubGlobal("FIND_SOURCES", 105);
    vi.stubGlobal("FIND_MY_SPAWNS", 112);
    vi.stubGlobal("FIND_EXIT_TOP", 1);
    vi.stubGlobal("FIND_EXIT_RIGHT", 3);
    vi.stubGlobal("FIND_EXIT_BOTTOM", 5);
    vi.stubGlobal("FIND_EXIT_LEFT", 7);
    vi.stubGlobal("Memory", {
      ags: {
        remotePlan: "reserved_drop",
        remotePathLength: 10,
        remoteRoom: "W0N1",
      },
    });
    // No remote vision → measureRemotePathLength skips; Memory pathLength sticks.
    // Survival quotas still use default 2 sources when vision missing.
    vi.stubGlobal("Game", {
      time: 1,
      creeps: opts.creeps ?? {},
      rooms: {},
      map: {
        describeExits: () => ({ "1": "W0N1" }),
        getRoomTerrain: () => ({ get: () => 0 }),
        findRoute: () => [{ room: "W0N1" }],
        getRoomLinearDistance: () => 1,
      },
    });
  }

  test("under floor with empty remote spawns remoteMiner first", () => {
    stubRemoteWorld({ storageEnergy: 0, energyAvailable: 800 });
    let spawnedRole: string | undefined;
    const spawnCreep = (
      _body: BodyPartConstant[],
      _name: string,
      opts?: { memory?: CreepMemory },
    ) => {
      spawnedRole = opts?.memory?.role;
      return 0;
    };
    const spawn = {
      spawning: null,
      spawnCreep,
      room: {
        name: "W0N0",
        controller: { level: 6 },
        storage: {
          store: { energy: 0 },
          pos: { x: 25, y: 25, roomName: "W0N0" },
        },
        energyAvailable: 800,
        find: () => [],
      },
    };
    const ok = trySpawnRemote(spawn as unknown as StructureSpawn, {
      homeMiners: 2,
      homeMinerWant: 2,
      homeFillers: 1,
    });
    expect(ok).toBe(true);
    expect(spawnedRole).toBe("remoteMiner");
  });

  test("under floor at survival seats does not expand haulers", () => {
    stubRemoteWorld({
      storageEnergy: 5_000,
      creeps: {
        m1: { memory: { role: "remoteMiner" } },
        m2: { memory: { role: "remoteMiner" } },
        h1: { memory: { role: "remoteHauler" } },
        r1: { memory: { role: "reserver" } },
      },
      energyAvailable: 800,
    });
    const spawnCreep = vi.fn(() => 0);
    const spawn = {
      spawning: null,
      spawnCreep,
      room: {
        name: "W0N0",
        controller: { level: 6 },
        storage: {
          store: { energy: 5_000 },
          pos: { x: 25, y: 25, roomName: "W0N0" },
        },
        energyAvailable: 800,
        find: () => [],
      },
    };
    expect(
      trySpawnRemote(spawn as unknown as StructureSpawn, {
        homeMiners: 2,
        homeMinerWant: 2,
        homeFillers: 1,
      }),
    ).toBe(false);
    expect(spawnCreep).not.toHaveBeenCalled();
  });
});
