import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  SPAWN_IDLE_MIN_RANGE,
  evictIdleFromSpawnRing,
  pickIdleStand,
  shouldStayOnSpawnRing,
} from "../src/roles/idlePark";

function chebyshev(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function stubGlobals(): void {
  vi.stubGlobal("FIND_MY_SPAWNS", 106);
  vi.stubGlobal("LOOK_STRUCTURES", "structure");
  vi.stubGlobal("STRUCTURE_ROAD", "road");
  vi.stubGlobal("STRUCTURE_CONTAINER", "container");
  vi.stubGlobal("TERRAIN_MASK_WALL", 1);
  vi.stubGlobal("RESOURCE_ENERGY", "energy");
}

function makeSpawn(x = 25, y = 25, store?: Record<string, unknown>) {
  return {
    pos: { x, y, roomName: "W1N1" },
    store: store ?? {
      getFreeCapacity: () => 0,
      getUsedCapacity: () => 300,
    },
  };
}

function makeCreep(opts: {
  x: number;
  y: number;
  role?: string;
  energy?: number;
  recycling?: boolean;
  spawn?: ReturnType<typeof makeSpawn>;
  lookForAt?: () => unknown[];
}): {
  creep: Creep;
  moveTo: ReturnType<typeof vi.fn>;
  spawn: ReturnType<typeof makeSpawn>;
} {
  const spawn = opts.spawn ?? makeSpawn();
  const moveTo = vi.fn(() => 0);
  const creep = {
    name: "c1",
    id: "id1",
    memory: { role: opts.role ?? "hauler", recycling: opts.recycling },
    store: { energy: opts.energy ?? 0 },
    pos: {
      x: opts.x,
      y: opts.y,
      roomName: "W1N1",
      getRangeTo: (target: { pos?: { x: number; y: number } } | { x: number; y: number }) => {
        const p =
          "pos" in target && target.pos
            ? target.pos
            : (target as { x: number; y: number });
        return chebyshev(opts.x, opts.y, p.x, p.y);
      },
      isEqualTo: (p: { x: number; y: number }) => p.x === opts.x && p.y === opts.y,
    },
    moveTo,
    room: {
      name: "W1N1",
      find: (t: number) => (t === FIND_MY_SPAWNS ? [spawn] : []),
      getTerrain: () => ({ get: () => 0 }),
      lookForAt: opts.lookForAt ?? (() => []),
    },
  } as unknown as Creep;
  return { creep, moveTo, spawn };
}

describe("idlePark", () => {
  beforeEach(() => {
    stubGlobals();
    vi.stubGlobal("Game", { creeps: {}, map: { getRoomTerrain: () => ({ get: () => 0 }) } });
  });

  test("picks a stand tile at least 3 from spawn", () => {
    const { creep, spawn } = makeCreep({ x: 25, y: 26 });
    const stand = pickIdleStand(creep);
    expect(stand).toBeTruthy();
    expect(
      chebyshev(stand!.x, stand!.y, spawn.pos.x, spawn.pos.y),
    ).toBeGreaterThanOrEqual(SPAWN_IDLE_MIN_RANGE);
  });

  test("evicts an idle hauler from the spawn ring", () => {
    const { creep, moveTo } = makeCreep({ x: 25, y: 26, energy: 0, role: "hauler" });
    expect(evictIdleFromSpawnRing(creep)).toBe(true);
    expect(moveTo).toHaveBeenCalled();
    const dest = moveTo.mock.calls[0][0] as { x: number; y: number };
    expect(chebyshev(dest.x, dest.y, 25, 25)).toBeGreaterThanOrEqual(3);
  });

  test("hauler delivering energy stays on the ring", () => {
    const spawn = makeSpawn(25, 25, {
      getFreeCapacity: () => 50,
      getUsedCapacity: () => 250,
    });
    const { creep, moveTo } = makeCreep({
      x: 25,
      y: 26,
      energy: 50,
      role: "hauler",
      spawn,
    });
    expect(shouldStayOnSpawnRing(creep)).toBe(true);
    expect(evictIdleFromSpawnRing(creep)).toBe(false);
    expect(moveTo).not.toHaveBeenCalled();
  });

  test("filler delivering energy stays on the ring", () => {
    const spawn = makeSpawn(25, 25, {
      getFreeCapacity: () => 50,
      getUsedCapacity: () => 200,
    });
    const { creep, moveTo } = makeCreep({
      x: 26,
      y: 25,
      energy: 50,
      role: "filler",
      spawn,
    });
    expect(shouldStayOnSpawnRing(creep)).toBe(true);
    expect(evictIdleFromSpawnRing(creep)).toBe(false);
    expect(moveTo).not.toHaveBeenCalled();
  });
});
