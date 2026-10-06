import { describe, expect, test } from "vitest";
import {
  HUB_EXTENSION_STAMP,
  HUB_ROAD_STAMP,
  SPAWN_EXIT_MIN_RANGE,
  clearBlockingSitesOnRoads,
  clearSpawnExitRing,
  countFreeSpawnExits,
  findBuildSpotNear,
  isHubCorridor,
  isSpawnExitTile,
  tryPlaceExtension,
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
    find(type: number) {
      if (type === 111) {
        const out: Array<FakeSite & { pos: RoomPosition }> = [];
        for (const [k, cell] of byPos) {
          const [x, y] = k.split(",").map(Number);
          for (const site of cell.sites) {
            out.push(
              Object.assign(site, {
                pos: new RoomPosition(x, y, "W0N0"),
              }),
            );
          }
        }
        return out;
      }
      if (type === 112) {
        // FIND_MY_SPAWNS — fake one at 25,25 when structures include spawn
        return [{ pos: new RoomPosition(25, 25, "W0N0") }];
      }
      return [];
    },
    createConstructionSite(x: number, y: number, type: string) {
      const cell = ensure(x, y);
      if (cell.structs.length || cell.sites.length) return -7;
      cell.sites.push({
        structureType: type,
        remove() {
          return 0;
        },
      });
      return 0;
    },
  } as unknown as Room;

  (globalThis as { FIND_CONSTRUCTION_SITES?: number }).FIND_CONSTRUCTION_SITES =
    111;
  (globalThis as { FIND_MY_SPAWNS?: number }).FIND_MY_SPAWNS = 112;

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

  test("even minRange 1 skips hub corridors (exit ring + cardinal rays)", () => {
    const room = makeRoom({});
    const spawnPos = new RoomPosition(25, 25, room.name);
    const spot = findBuildSpotNear(room, spawnPos, 4, 1);
    expect(spot).not.toBeNull();
    expect(isSpawnExitTile(spawnPos, spot!.x, spot!.y)).toBe(false);
    expect(isHubCorridor(spawnPos, spot!.x, spot!.y)).toBe(false);
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

  test("exit tiles with roads still count as free exits", () => {
    const room = makeRoom({
      structures: [
        { x: 26, y: 25, structureType: "road" },
        { x: 24, y: 25, structureType: "road" },
        { x: 25, y: 26, structureType: "road" },
      ],
    });
    const spawnPos = new RoomPosition(25, 25, room.name);
    expect(countFreeSpawnExits(room, spawnPos)).toBe(8);
  });
});

describe("diamond hub stamp", () => {
  test("hub corridors reserve exit ring and cardinal rays", () => {
    const room = makeRoom({});
    const spawnPos = new RoomPosition(25, 25, room.name);
    expect(room.name).toBe("W0N0");
    expect(isHubCorridor(spawnPos, 25, 26)).toBe(true); // exit
    expect(isHubCorridor(spawnPos, 26, 26)).toBe(true); // exit diagonal
    expect(isHubCorridor(spawnPos, 25, 27)).toBe(true); // south ray
    expect(isHubCorridor(spawnPos, 25, 29)).toBe(true);
    expect(isHubCorridor(spawnPos, 27, 25)).toBe(true);
    expect(isHubCorridor(spawnPos, 27, 26)).toBe(false); // stamp pocket [2,1]
    expect(isHubCorridor(spawnPos, 26, 27)).toBe(false); // stamp pocket [1,2]
  });

  test("extension stamp never overlaps road stamp or corridors", () => {
    const roads = new Set(HUB_ROAD_STAMP.map(([x, y]) => `${x},${y}`));
    const origin = { x: 0, y: 0 } as RoomPosition;
    for (const [dx, dy] of HUB_EXTENSION_STAMP) {
      expect(roads.has(`${dx},${dy}`)).toBe(false);
      expect(dx === 0 || dy === 0).toBe(false);
      expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeGreaterThanOrEqual(2);
      expect(isHubCorridor(origin, dx, dy)).toBe(false);
    }
  });

  test("tryPlaceExtension uses stamp pocket not south corridor", () => {
    const room = makeRoom({});
    const spawnPos = new RoomPosition(25, 25, room.name);
    expect(tryPlaceExtension(room, spawnPos)).toBe(true);
    // First stamp pocket is [2,1] → (27,26)
    const sites = room.find(FIND_CONSTRUCTION_SITES) as Array<{
      pos: RoomPosition;
      structureType: string;
    }>;
    expect(sites).toHaveLength(1);
    expect(sites[0].pos.x).toBe(27);
    expect(sites[0].pos.y).toBe(26);
    expect(isHubCorridor(spawnPos, sites[0].pos.x, sites[0].pos.y)).toBe(
      false,
    );
  });

  test("clearSpawnExitRing destroys a north-ray extension that would seal the road", () => {
    const room = makeRoom({
      structures: [
        { x: 25, y: 23, structureType: "extension" },
        { x: 27, y: 26, structureType: "extension" },
      ],
    });
    const spawnPos = new RoomPosition(25, 25, room.name);
    expect(isHubCorridor(spawnPos, 25, 23)).toBe(true);
    expect(isHubCorridor(spawnPos, 27, 26)).toBe(false);
    const cleared = clearSpawnExitRing(room, spawnPos);
    expect(cleared.destroyedStructures).toBe(1);
    const north = new RoomPosition(25, 23, room.name).lookFor(LOOK_STRUCTURES);
    const pocket = new RoomPosition(27, 26, room.name).lookFor(LOOK_STRUCTURES);
    expect(north).toHaveLength(0);
    expect(pocket).toHaveLength(1);
  });

  test("clearBlockingSitesOnRoads removes extension sites on corridors", () => {
    const room = makeRoom({
      sites: [{ x: 25, y: 27, structureType: "extension" }],
    });
    expect(clearBlockingSitesOnRoads(room)).toBe(1);
  });

  test("clearBlockingSitesOnRoads removes extension sites on roads", () => {
    const room = makeRoom({
      structures: [{ x: 26, y: 27, structureType: "road" }],
      sites: [{ x: 26, y: 27, structureType: "extension" }],
    });
    expect(clearBlockingSitesOnRoads(room)).toBe(1);
  });

  test("preferOffCardinal picks diagonal before axis corridor", () => {
    const room = makeRoom({});
    const spawnPos = new RoomPosition(25, 25, room.name);
    const spot = findBuildSpotNear(room, spawnPos, 4, SPAWN_EXIT_MIN_RANGE, true);
    expect(spot).not.toBeNull();
    expect(spot!.x !== 25 && spot!.y !== 25).toBe(true);
  });
});
