import { describe, expect, test } from "vitest";
import {
  SPAWN_EXIT_MIN_RANGE,
  countFreeSpawnExits,
  findBuildSpotNear,
  isSpawnExitTile,
} from "../src/construction/placement";

type FakeStruct = { structureType: string };
type FakeSite = { structureType: string };

function makeRoom(opts: {
  walls?: Array<[number, number]>;
  structures?: Array<{ x: number; y: number; structureType: string }>;
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
    ensure(s.x, s.y).structs.push({ structureType: s.structureType });
  }
  for (const s of opts.sites ?? []) {
    ensure(s.x, s.y).sites.push({ structureType: s.structureType });
  }

  (globalThis as { TERRAIN_MASK_WALL?: number }).TERRAIN_MASK_WALL = 1;
  (globalThis as { STRUCTURE_ROAD?: string }).STRUCTURE_ROAD = "road";
  (globalThis as { STRUCTURE_CONTAINER?: string }).STRUCTURE_CONTAINER =
    "container";
  (globalThis as { LOOK_STRUCTURES?: string }).LOOK_STRUCTURES = "structures";
  (globalThis as { LOOK_CONSTRUCTION_SITES?: string }).LOOK_CONSTRUCTION_SITES =
    "sites";

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
});
