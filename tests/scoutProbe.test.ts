import { describe, expect, test } from "vitest";
import {
  HOME_PROBE_HOLD_TICKS,
  countPlayerHostiles,
  probeResponseAction,
  tickHomeProbe,
} from "../src/defense/scoutProbe";

describe("countPlayerHostiles", () => {
  test("ignores Invader username", () => {
    const hostiles = [
      { owner: { username: "Invader" } },
      { owner: { username: "Enemy" } },
    ] as Creep[];
    expect(countPlayerHostiles(hostiles)).toBe(1);
  });
});

describe("tickHomeProbe", () => {
  test("arms sticky window on player hostile", () => {
    const mem: {
      homeProbeUntil?: number;
      homeProbeCount?: number;
      homeProbePlayer?: boolean;
    } = {};
    const r = tickHomeProbe(mem, {
      tick: 500,
      hostiles: [{ owner: { username: "Enemy" } }] as Creep[],
    });
    expect(r.active).toBe(true);
    expect(r.player).toBe(true);
    expect(mem.homeProbeUntil).toBe(500 + HOME_PROBE_HOLD_TICKS);
  });

  test("does not arm on Invader-only", () => {
    const mem = {};
    const r = tickHomeProbe(mem, {
      tick: 500,
      hostiles: [{ owner: { username: "Invader" } }] as Creep[],
    });
    expect(r.active).toBe(false);
    expect(mem).toEqual({});
  });
});

describe("probeResponseAction", () => {
  test("safemode when spawn damaged", () => {
    expect(
      probeResponseAction({
        probeActive: true,
        playerProbe: true,
        spawnDamaged: true,
        safeModeAvailable: 1,
      }),
    ).toBe("safemode");
  });

  test("towers for scout without spawn hits", () => {
    expect(
      probeResponseAction({
        probeActive: true,
        playerProbe: true,
        spawnDamaged: false,
        safeModeAvailable: 1,
      }),
    ).toBe("towers");
  });
});
