import { describe, expect, test } from "vitest";
import {
  breakEvenDistance,
  evaluateRemoteEconomics,
  haulersForIncome,
  rankRemotePlansAtDistance,
  sourceEnergyPerTick,
} from "../src/earlyGame/remoteEconomics";

describe("remoteEconomics", () => {
  test("reserved sources yield 10 e/t, unreserved 5", () => {
    expect(sourceEnergyPerTick(false)).toBe(5);
    expect(sourceEnergyPerTick(true)).toBe(10);
  });

  test("home_only is zero net", () => {
    const r = evaluateRemoteEconomics({
      sources: 2,
      pathLength: 50,
      plan: "home_only",
    });
    expect(r.netEnergyPerTick).toBe(0);
    expect(r.haulerCount).toBe(0);
  });

  test("at short range reserved beats unreserved gross and usually net", () => {
    const drop = evaluateRemoteEconomics({
      sources: 2,
      pathLength: 25,
      plan: "drop_unreserved",
    });
    const reserved = evaluateRemoteEconomics({
      sources: 2,
      pathLength: 25,
      plan: "reserved_container",
    });
    expect(reserved.grossEnergyPerTick).toBe(2 * drop.grossEnergyPerTick);
    expect(reserved.netEnergyPerTick).toBeGreaterThan(drop.netEnergyPerTick);
  });

  test("net falls as path length grows (wiki distance pressure)", () => {
    const near = evaluateRemoteEconomics({
      sources: 2,
      pathLength: 25,
      plan: "drop_unreserved",
    });
    const far = evaluateRemoteEconomics({
      sources: 2,
      pathLength: 150,
      plan: "drop_unreserved",
    });
    expect(far.netEnergyPerTick).toBeLessThan(near.netEnergyPerTick);
    expect(far.haulerCount).toBeGreaterThanOrEqual(near.haulerCount);
  });

  test("haulersForIncome scales with distance", () => {
    expect(haulersForIncome(10, 25)).toBeLessThan(haulersForIncome(10, 100));
  });

  test("breakEvenDistance for drop is finite and beyond near remotes", () => {
    const d = breakEvenDistance("drop_unreserved");
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(50);
  });

  test("rank at distance 25 prefers a reserved plan over home_only", () => {
    const ranking = rankRemotePlansAtDistance(25);
    expect(ranking[0].plan).not.toBe("home_only");
    expect(ranking[ranking.length - 1].plan).toBe("home_only");
  });

  test("distance table 25/50/100/150 keeps monotonic drop for unreserved", () => {
    const nets = [25, 50, 100, 150].map(
      (pathLength) =>
        evaluateRemoteEconomics({
          sources: 2,
          pathLength,
          plan: "drop_unreserved",
        }).netEnergyPerTick,
    );
    for (let i = 1; i < nets.length; i++) {
      expect(nets[i]).toBeLessThanOrEqual(nets[i - 1]);
    }
  });
});
