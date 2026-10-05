import { describe, expect, test } from "vitest";
import {
  parseRoadPolicy,
  preferSourceRoads,
  roadMinRcl,
  roadsBlockedByContainers,
  roadsWhileContainersMissing,
} from "../src/earlyGame/roadPolicy";
import { shouldBuildRoads } from "../src/earlyGame/policy";

describe("roadPolicy", () => {
  test("parses known policies and defaults", () => {
    expect(parseRoadPolicy("parallel")).toBe("parallel");
    expect(parseRoadPolicy("nope")).toBe("parallel");
  });

  test("after_rcl3 waits for RCL3", () => {
    expect(roadMinRcl("after_rcl3")).toBe(3);
    expect(roadMinRcl("parallel")).toBe(2);
  });

  test("parallel/source_first may road while containers missing", () => {
    expect(roadsWhileContainersMissing("parallel")).toBe(true);
    expect(roadsWhileContainersMissing("source_first")).toBe(true);
    expect(roadsWhileContainersMissing("after_containers")).toBe(false);
    expect(roadsBlockedByContainers("after_containers")).toBe(true);
    expect(roadsBlockedByContainers("parallel")).toBe(false);
  });

  test("source_first prefers source paths", () => {
    expect(preferSourceRoads("source_first")).toBe(true);
    expect(preferSourceRoads("after_containers")).toBe(false);
  });

  test("shouldBuildRoads respects custom minRcl", () => {
    expect(shouldBuildRoads(2, 300, false, { minRcl: 3 })).toBe(false);
    expect(shouldBuildRoads(3, 300, false, { minRcl: 3 })).toBe(true);
  });
});
