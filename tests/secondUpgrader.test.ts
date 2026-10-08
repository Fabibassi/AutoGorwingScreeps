import { describe, expect, test } from "vitest";
import { wantSecondUpgrader } from "../src/earlyGame/secondUpgrader";

describe("wantSecondUpgrader", () => {
  const base = {
    rcl: 2,
    sourceCount: 2,
    containersAtSources: 2,
    hasConstructionSites: false,
    economyDepressed: false,
    sourceContainerEnergy: 1500,
  };

  test("true when both containers ready and surplus", () => {
    expect(wantSecondUpgrader(base)).toBe(true);
  });

  test("false while a source container is missing", () => {
    expect(
      wantSecondUpgrader({ ...base, containersAtSources: 1 }),
    ).toBe(false);
  });

  test("false while construction sites open (builders first)", () => {
    expect(
      wantSecondUpgrader({ ...base, hasConstructionSites: true }),
    ).toBe(false);
  });

  test("true with open sites only if fat surplus (≥2× threshold)", () => {
    expect(
      wantSecondUpgrader({
        ...base,
        hasConstructionSites: true,
        sourceContainerEnergy: 2000,
      }),
    ).toBe(true);
  });

  test("false when depressed", () => {
    expect(
      wantSecondUpgrader({ ...base, economyDepressed: true }),
    ).toBe(false);
  });

  test("false below surplus threshold when energy provided", () => {
    expect(
      wantSecondUpgrader({ ...base, sourceContainerEnergy: 400 }),
    ).toBe(false);
  });
});
