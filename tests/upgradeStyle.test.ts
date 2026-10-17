import { describe, expect, test } from "vitest";
import {
  linkFeedFloor,
  parseUpgradeStyle,
  upgradeStyleParks,
} from "../src/earlyGame/upgradeStyle";
import { STORAGE_FLOOR_ENERGY } from "../src/earlyGame/storageFloor";

describe("upgrade style", () => {
  test("live default waits on the controller link", () => {
    expect(parseUpgradeStyle()).toBe("park");
    expect(upgradeStyleParks(parseUpgradeStyle())).toBe(true);
    expect(linkFeedFloor(parseUpgradeStyle())).toBe(STORAGE_FLOOR_ENERGY);
  });

  test("baseline still hikes and feed lowers the link floor", () => {
    expect(upgradeStyleParks(parseUpgradeStyle("baseline"))).toBe(false);
    expect(linkFeedFloor(parseUpgradeStyle("feed"))).toBe(2_000);
  });
});
