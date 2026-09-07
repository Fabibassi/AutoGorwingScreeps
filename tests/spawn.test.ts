import { describe, expect, test } from "vitest";
import { desiredCreeps, getSpawnPriority } from "../src/spawn";

describe("desiredCreeps", () => {
  test("rcl1 wants 3 harvesters and 1 upgrader", () => {
    expect(desiredCreeps(1)).toEqual({ harvester: 3, upgrader: 1 });
  });
  test("rcl2+ wants 4 harvesters and 2 upgraders", () => {
    expect(desiredCreeps(2)).toEqual({ harvester: 4, upgrader: 2 });
    expect(desiredCreeps(3)).toEqual({ harvester: 4, upgrader: 2 });
  });
});

describe("getSpawnPriority", () => {
  test("returns spawning when busy", () => {
    const spawn = {
      spawning: { name: "harvester-99" },
      room: { controller: { level: 1 } },
    } as unknown as StructureSpawn;
    expect(getSpawnPriority(spawn)).toEqual({
      kind: "spawning",
      role: "harvester",
    });
  });

  test("prioritizes harvester when below target", () => {
    (globalThis as { Game: { creeps: Record<string, Creep> } }).Game = {
      creeps: {
        h1: { memory: { role: "harvester" } } as Creep,
        u1: { memory: { role: "upgrader" } } as Creep,
      },
    };
    const spawn = {
      spawning: null,
      room: { controller: { level: 1 } },
    } as unknown as StructureSpawn;
    expect(getSpawnPriority(spawn)).toEqual({
      kind: "spawn",
      role: "harvester",
    });
  });

  test("returns maintain when at target counts", () => {
    (globalThis as { Game: { creeps: Record<string, Creep> } }).Game = {
      creeps: {
        h1: { memory: { role: "harvester" } } as Creep,
        h2: { memory: { role: "harvester" } } as Creep,
        h3: { memory: { role: "harvester" } } as Creep,
        u1: { memory: { role: "upgrader" } } as Creep,
      },
    };
    const spawn = {
      spawning: null,
      room: { controller: { level: 1 } },
    } as unknown as StructureSpawn;
    expect(getSpawnPriority(spawn)).toEqual({ kind: "maintain" });
  });
});
