import { describe, expect, test } from "vitest";
import {
  SOURCE_CONTAINER_RANGE,
  chebyshevDist,
  countSourcesWithNearbyContainers,
  pickHomeRoom,
} from "../src/room/queries";

describe("source container proximity", () => {
  test("chebyshevDist matches Screeps findInRange metric", () => {
    expect(chebyshevDist({ x: 10, y: 10 }, { x: 11, y: 11 })).toBe(1);
    expect(chebyshevDist({ x: 10, y: 10 }, { x: 12, y: 10 })).toBe(2);
  });

  test("range-2 container still covers the source (live false 1/2)", () => {
    const sources = [
      { x: 14, y: 33 },
      { x: 42, y: 22 },
    ];
    // One seat at classic adjacency, one at range 2 (missed by old range-1 count).
    const containers = [
      { x: 15, y: 33 },
      { x: 42, y: 24 },
    ];
    expect(countSourcesWithNearbyContainers(sources, containers, 1)).toBe(1);
    expect(
      countSourcesWithNearbyContainers(
        sources,
        containers,
        SOURCE_CONTAINER_RANGE,
      ),
    ).toBe(2);
  });

  test("ghost site at 14,32 is not required when both sources already covered", () => {
    const sources = [
      { x: 22, y: 10 },
      { x: 41, y: 22 },
    ];
    const finished = [
      { x: 23, y: 9 },
      { x: 42, y: 23 },
    ];
    // Live probe: both seats range-1; orphan site (14,32) is irrelevant to the count.
    expect(countSourcesWithNearbyContainers(sources, finished, 1)).toBe(2);
    expect(
      countSourcesWithNearbyContainers(sources, finished, SOURCE_CONTAINER_RANGE),
    ).toBe(2);
  });

  test("pickHomeRoom prefers spawn room over random vision rooms", () => {
    const home = {
      name: "W21N35",
      controller: { my: true },
    } as unknown as Room;
    const scout = {
      name: "W22N35",
      controller: { my: false },
    } as unknown as Room;
    const spawn = { room: home } as unknown as StructureSpawn;
    expect(
      pickHomeRoom(
        { W22N35: scout, W21N35: home },
        { Spawn1: spawn },
      )?.name,
    ).toBe("W21N35");
  });
});
