import { describe, expect, test } from "vitest";
import {
  SPAWN_EXIT_MIN_RANGE,
  clearSpawnExitRing,
  countFreeSpawnExits,
  findBuildSpotNear,
  isSpawnExitTile,
} from "../src/construction/placement";

type FakeStruct = {
  structureType: string;
  store?: Record<string, number>;
  destroy: () => number;
};
type FakeSite = { structureType: string; remove: () => number };

function makeRoom(opts: {
  walls?: Array<[number, number]>;
  structures?: Array<{
    x: number;
    y: number;
    structureType: string;
    energy?: number;
  }>;
  sites?: Array<{ x: number; y: number; structureType: string }>;
}): Room {
  const wallSet = new Set((opts.walls ?? []).map(([x, y]) => `${x},${y}`));
  const byPos = new Map<string, { structs: FakeStruct[]; sites: FakeSite[] }>();
  const ensure = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (!byPos.has(k)) byPos.set(k, { structs: [], sites: [] });
    return byPos.get(k)!;
  };
  for (const s of opts.structures ?? []) {
    const cell = ensure(s.x, s.y);
    const struct: FakeStruct = {
      structureType: s.structureType,
      store:
        s.energy != null
          ? { energy: s.energy }
          : s.structureType === "storage"
            ? { energy: 0 }
            : undefined,
      destroy() {
        const i = cell.structs.indexOf(struct);
        if (i >= 0) cell.structs.splice(i, 1);
        return 0;
      },
    };
    cell.structs.push(struct);
  }
  for (const s of opts.sites ?? []) {
    const cell = ensure(s.x, s.y);
    const site: FakeSite = {
      structureType: s.structureType,
      remove() {
        const i = cell.sites.indexOf(site);
        if (i >= 0) cell.sites.splice(i, 1);
        return 0;
      },
    };
    cell.sites.push(site);
  }

  (globalThis as { TERRAIN_MASK_WALL?: number }).TERRAIN_MASK_WALL = 1;
  (globalThis as { STRUCTURE_ROAD?: string }).STRUCTURE_ROAD = "road";
  (globalThis as { STRUCTURE_CONTAINER?: string }).STRUCTURE_CONTAINER =
    "container";
  (globalThis as { STRUCTURE_SPAWN?: string }).STRUCTURE_SPAWN = "spawn";
  (globalThis as { STRUCTURE_STORAGE?: string }).STRUCTURE_STORAGE = "storage";
  (globalThis as { STRUCTURE_EXTENSION?: string }).STRUCTURE_EXTENSION =
    "extension";
  (globalThis as { RESOURCE_ENERGY?: string }).RESOURCE_ENERGY = "energy";
  (globalThis as { LOOK_STRUCTURES?: string }).LOOK_STRUCTURES = "structures";
  (globalThis as { LOOK_CONSTRUCTION_SITES?: string }).LOOK_CONSTRUCTION_SITES =
    "sites";
  (globalThis as { OK?: number }).OK = 0;

  const room = {
    name: "W0N0",
  } as Room;

  (globalThis as { Game?: unknown }).Game = {
    map: {
      getRoomTerrain: () => ({
        get: (x: number, y: number) => (wallSet.has(`${x},${y}`) ? 1 : 0),
      }),
    },
  };

  (globalThis as { RoomPosition?: unknown }).RoomPosition = class {
    x: number;
    y: number;
    roomName: string;
    constructor(x: number, y: number, roomName: string) {
      this.x = x;
      this.y = y;
      this.roomName = roomName;
    }
    lookFor(look: string) {
      const cell = byPos.get(`${this.x},${this.y}`);
      if (!cell) return [];
      if (look === "structures") return cell.structs;
      if (look === "sites") return cell.sites;
      return [];
    }
  };

  return room;
}

describe("spawn exit ring stays open", () => {
  test("counts 8 free exits on empty plain", () => {
    const room = makeRoom({});
    const spawnPos = new RoomPosition(25, 25, room.name);
    expect(countFreeSpawnExits(room, spawnPos)).toBe(8);
  });

  test("build spots start at range 2 — never on spawn exit ring", () => {
    const room = makeRoom({});
    const spawnPos = new RoomPosition(25, 25, room.name);
    expect(SPAWN_EXIT_MIN_RANGE).toBe(2);
    const spot = findBuildSpotNear(room, spawnPos, 4, SPAWN_EXIT_MIN_RANGE);
    expect(spot).not.toBeNull();
    expect(isSpawnExitTile(spawnPos, spot!.x, spot!.y)).toBe(false);
    expect(
      Math.max(Math.abs(spot!.x - 25), Math.abs(spot!.y - 25)),
    ).toBeGreaterThanOrEqual(2);
  });

  test("minRange 1 would hit exit ring — default must not", () => {
    const room = makeRoom({});
    const spawnPos = new RoomPosition(25, 25, room.name);
    const adjacent = findBuildSpotNear(room, spawnPos, 4, 1);
    expect(adjacent).not.toBeNull();
    expect(isSpawnExitTile(spawnPos, adjacent!.x, adjacent!.y)).toBe(true);
  });

  test("clearSpawnExitRing destroys ring extensions and removes sites", () => {
    const room = makeRoom({
      structures: [
        { x: 26, y: 25, structureType: "extension" },
        { x: 24, y: 25, structureType: "extension" },
      ],
      sites: [{ x: 25, y: 26, structureType: "extension" }],
    });
    const spawnPos = new RoomPosition(25, 25, room.name);
    expect(countFreeSpawnExits(room, spawnPos)).toBe(5);
    const cleared = clearSpawnExitRing(room, spawnPos);
    expect(cleared.destroyedStructures).toBe(2);
    expect(cleared.removedSites).toBe(1);
    expect(countFreeSpawnExits(room, spawnPos)).toBe(8);
  });

  test("clearSpawnExitRing keeps filled storage when other exits remain", () => {
    const room = makeRoom({
      structures: [
        { x: 26, y: 25, structureType: "storage", energy: 5000 },
        { x: 24, y: 25, structureType: "extension" },
      ],
    });
    const spawnPos = new RoomPosition(25, 25, room.name);
    const cleared = clearSpawnExitRing(room, spawnPos);
    expect(cleared.destroyedStructures).toBe(1);
    expect(countFreeSpawnExits(room, spawnPos)).toBe(7);
  });
});
