import { describe, expect, test } from "vitest";
import {
  buildThreatBodies,
  expectedPass,
  hubSeedSpec,
  THREAT_IDS,
} from "../ops/sim/raidThreats";

describe("raidThreats expectedPass", () => {
  test("RCL5 probe expected pass", () => {
    expect(expectedPass(5, "probe")).toBe(true);
  });

  test("RCL3 swarm expected pass (baseline evidence)", () => {
    expect(expectedPass(3, "swarm")).toBe(true);
  });

  test("RCL4 drain expected pass", () => {
    expect(expectedPass(4, "drain")).toBe(true);
  });

  test("RCL5 smash/swarm expected pass", () => {
    expect(expectedPass(5, "smash")).toBe(true);
    expect(expectedPass(5, "swarm")).toBe(true);
  });
});

describe("raidThreats bodies + hub seed", () => {
  test("bodies scale for swarm", () => {
    expect(buildThreatBodies(5, "swarm").length).toBeGreaterThan(3);
  });

  test("every threat has at least one non-empty body", () => {
    for (const threat of THREAT_IDS) {
      const bodies = buildThreatBodies(5, threat);
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies[0].length).toBeGreaterThan(0);
    }
  });

  test("hub seed towers match RCL", () => {
    expect(hubSeedSpec(3).towers).toBe(1);
    expect(hubSeedSpec(4).towers).toBe(1);
    expect(hubSeedSpec(5).towers).toBe(2);
    expect(hubSeedSpec(6).storageEnergy).toBeGreaterThan(0);
  });
});
