import { describe, expect, test } from "vitest";
import { registeredRoles, runCreep } from "../src/roles";

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
