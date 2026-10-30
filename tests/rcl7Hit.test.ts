import { beforeAll, describe, expect, test, vi } from "vitest";

beforeAll(() => {
  vi.stubGlobal("STRUCTURE_EXTENSION", "extension");
  vi.stubGlobal("STRUCTURE_TOWER", "tower");
  vi.stubGlobal("STRUCTURE_SPAWN", "spawn");
  vi.stubGlobal("STRUCTURE_LINK", "link");
});

const {
  nextRcl7HitStructure,
  parseRcl7BuildOrder,
} = await import("../src/earlyGame/rcl7Hit");

describe("parseRcl7BuildOrder", () => {
  test("defaults to ext_first", () => {
    expect(parseRcl7BuildOrder(undefined)).toBe("ext_first");
    expect(parseRcl7BuildOrder("tower_first")).toBe("tower_first");
  });
});

describe("nextRcl7HitStructure", () => {
  const quotas = {
    extensionQuota: 50,
    towerQuota: 3,
    spawnQuota: 2,
    linkQuota: 4,
  };

  test("ext_first prefers extensions", () => {
    expect(
      nextRcl7HitStructure({
        order: "ext_first",
        extensions: 40,
        towers: 2,
        spawns: 1,
        links: 3,
        ...quotas,
      }),
    ).toBe("extension");
  });

  test("tower_first prefers tower", () => {
    expect(
      nextRcl7HitStructure({
        order: "tower_first",
        extensions: 40,
        towers: 2,
        spawns: 1,
        links: 3,
        ...quotas,
      }),
    ).toBe("tower");
  });

  test("spawn_first prefers spawn", () => {
    expect(
      nextRcl7HitStructure({
        order: "spawn_first",
        extensions: 40,
        towers: 2,
        spawns: 1,
        links: 3,
        ...quotas,
      }),
    ).toBe("spawn");
  });

  test("falls through to link when hub quotas met", () => {
    expect(
      nextRcl7HitStructure({
        order: "ext_first",
        extensions: 50,
        towers: 3,
        spawns: 2,
        links: 3,
        ...quotas,
      }),
    ).toBe("link");
  });

  test("null when all quotas met", () => {
    expect(
      nextRcl7HitStructure({
        order: "ext_first",
        extensions: 50,
        towers: 3,
        spawns: 2,
        links: 4,
        ...quotas,
      }),
    ).toBeNull();
  });
});
