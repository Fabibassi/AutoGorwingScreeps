import { afterEach, describe, expect, test, vi } from "vitest";
import {
  homeReadyForRemotes,
  recycleExcessRemoteHaulers,
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
      room: { name: roomName },
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
      room: { name: roomName },
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
});
