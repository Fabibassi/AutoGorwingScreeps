import { describe, expect, test } from "vitest";
import {
  durableCount,
  durableMinerCount,
  minerLiveCap,
  minerMoveTicksPerTile,
  minerNeedsReplacement,
  minerReplacementLeadTime,
  shouldWaitForIncumbentMiner,
  sourceIdForReplacementMiner,
} from "../src/earlyGame/minerHandoff";

describe("minerReplacementLeadTime", () => {
  test("covers spawn time plus slow 5W1M walk plus buffer", () => {
    expect(minerMoveTicksPerTile(5, 1)).toBe(5);
    expect(
      minerReplacementLeadTime({
        bodyParts: 6,
        workParts: 5,
        moveParts: 1,
        range: 20,
        buffer: 10,
      }),
    ).toBe(6 * 3 + 20 * 5 + 10);
  });

  test("1W1M walks one tile per tick", () => {
    expect(minerMoveTicksPerTile(1, 1)).toBe(1);
  });
});

describe("minerNeedsReplacement", () => {
  test("false while spawning (no ttl yet)", () => {
    expect(minerNeedsReplacement(undefined, 100)).toBe(false);
  });

  test("true when ttl is inside the walk+spawn window", () => {
    expect(minerNeedsReplacement(128, 128)).toBe(true);
    expect(minerNeedsReplacement(129, 128)).toBe(false);
  });
});

describe("durableMinerCount / replacement source", () => {
  const sources = ["s1", "s2"];
  const lead = () => 100;

  test("counts a healthy miner as covering its source", () => {
    expect(
      durableMinerCount(
        [
          { sourceId: "s1", ticksToLive: 800 },
          { sourceId: "s2", ticksToLive: 800 },
        ],
        sources,
        lead,
      ),
    ).toBe(2);
  });

  test("dying singleton does not cover the source", () => {
    expect(
      durableMinerCount(
        [
          { sourceId: "s1", ticksToLive: 40 },
          { sourceId: "s2", ticksToLive: 800 },
        ],
        sources,
        lead,
      ),
    ).toBe(1);
  });

  test("incumbent plus incoming replacement still covers the source", () => {
    expect(
      durableMinerCount(
        [
          { sourceId: "s1", ticksToLive: 40 },
          { sourceId: "s1", ticksToLive: 1490 },
          { sourceId: "s2", ticksToLive: 800 },
        ],
        sources,
        lead,
      ),
    ).toBe(2);
  });

  test("assigns the dying source once a replacement is needed", () => {
    expect(
      sourceIdForReplacementMiner(
        [
          { sourceId: "s1", ticksToLive: 40 },
          { sourceId: "s2", ticksToLive: 800 },
        ],
        sources,
        lead,
      ),
    ).toBe("s1");
  });

  test("prefers an empty source over a dying one", () => {
    expect(
      sourceIdForReplacementMiner(
        [{ sourceId: "s1", ticksToLive: 40 }],
        sources,
        lead,
      ),
    ).toBe("s2");
  });

  test("returns null when every source is healthy or already doubled", () => {
    expect(
      sourceIdForReplacementMiner(
        [
          { sourceId: "s1", ticksToLive: 40 },
          { sourceId: "s1", ticksToLive: 1400 },
          { sourceId: "s2", ticksToLive: 800 },
        ],
        sources,
        lead,
      ),
    ).toBeNull();
  });

  test("unassigned miners cover empty sources so spawn does not flood", () => {
    expect(
      durableMinerCount(
        [{ ticksToLive: 1400 }, { ticksToLive: 1390 }],
        sources,
        lead,
      ),
    ).toBe(2);
    expect(
      sourceIdForReplacementMiner(
        [{ ticksToLive: 1400 }, { ticksToLive: 1390 }],
        sources,
        lead,
      ),
    ).toBeNull();
  });

  test("one unassigned miner fills one empty source and still requests the other", () => {
    expect(
      durableMinerCount([{ ticksToLive: 1400 }], sources, lead),
    ).toBe(1);
    expect(
      sourceIdForReplacementMiner([{ ticksToLive: 1400 }], sources, lead),
    ).toBe("s2");
  });
});

describe("shouldWaitForIncumbentMiner", () => {
  test("replacement yields while the older miner is still on the seat", () => {
    expect(
      shouldWaitForIncumbentMiner(
        { name: "miner-new", ticksToLive: 1490 },
        [{ name: "miner-old", ticksToLive: 40 }],
      ),
    ).toBe(true);
  });

  test("incumbent keeps mining when the replacement is waiting", () => {
    expect(
      shouldWaitForIncumbentMiner(
        { name: "miner-old", ticksToLive: 40 },
        [{ name: "miner-new", ticksToLive: 1490 }],
      ),
    ).toBe(false);
  });
});

describe("durableCount", () => {
  test("excludes dying creeps so haulers can be replaced before TTL hits 0", () => {
    expect(
      durableCount(
        [{ ticksToLive: 800 }, { ticksToLive: 40 }],
        100,
      ),
    ).toBe(1);
  });
});

describe("minerLiveCap", () => {
  test("live cap is two miners per source including the walking replacement", () => {
    expect(minerLiveCap(2, 2)).toBe(4);
    expect(minerLiveCap(0, 2)).toBe(4);
  });
});
