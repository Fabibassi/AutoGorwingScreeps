import { STORAGE_FLOOR_ENERGY } from "./storageFloor";

/**
 * How upgraders get energy once a controller link exists.
 * Live default is park: wait on the link, do not hike to a source container.
 * feed / static arms stay sim-only until they win a bench.
 */
export const UPGRADE_STYLES = [
  "baseline",
  "park",
  "feed",
  "static",
  "static_park",
  "static_feed",
] as const;

export type UpgradeStyle = (typeof UPGRADE_STYLES)[number];

/** Link may keep feeding this far under the 20k spawn floor. */
export const LINK_FEED_FLOOR = 2_000;

export function parseUpgradeStyle(raw?: string): UpgradeStyle {
  if (
    typeof raw === "string" &&
    (UPGRADE_STYLES as readonly string[]).includes(raw)
  ) {
    return raw as UpgradeStyle;
  }
  return "park";
}

/** Do not walk to source containers or storage. Wait on the controller link. */
export function upgradeStyleParks(style: UpgradeStyle): boolean {
  return style === "park" || style === "static_park";
}

/** Storage→controller link stays on down to LINK_FEED_FLOOR. */
export function upgradeStyleFeeds(style: UpgradeStyle): boolean {
  return style === "feed" || style === "static_feed";
}

/** WORK-heavy body: one CARRY, one MOVE, rest WORK. */
export function upgradeStyleStatic(style: UpgradeStyle): boolean {
  return style === "static" || style === "static_park" || style === "static_feed";
}

export function linkFeedFloor(style: UpgradeStyle): number {
  return upgradeStyleFeeds(style) ? LINK_FEED_FLOOR : STORAGE_FLOOR_ENERGY;
}
