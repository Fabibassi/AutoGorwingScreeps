import { beforeEach, describe, expect, test, vi } from "vitest";
import { runMiner } from "../src/roles/miner";
import { registeredRoles, runCreep } from "../src/roles";

describe("runMiner", () => {
  beforeEach(() => {
    vi.stubGlobal("ERR_FULL", -6);
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
      harvest: vi.fn(() => -6),
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
