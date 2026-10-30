import { describe, expect, test } from "vitest";
import {
  REMOTE_THREAT_HOLD_TICKS,
  allowRemoteSalvageSpawn,
  remoteThreatActive,
  shouldEvacuateRemoteOpts,
  tickRemoteThreat,
} from "../src/defense/remoteThreat";
import { STORAGE_FLOOR_ENERGY } from "../src/earlyGame/storageFloor";

describe("tickRemoteThreat", () => {
  test("arms sticky window when hostiles seen", () => {
    const mem: { remoteThreatUntil?: number; remoteThreatCount?: number } = {};
    const r = tickRemoteThreat(mem, { tick: 1000, hostilesNow: 2 });
    expect(r.active).toBe(true);
    expect(r.count).toBe(2);
    expect(mem.remoteThreatUntil).toBe(1000 + REMOTE_THREAT_HOLD_TICKS);
    expect(remoteThreatActive(mem, 1000)).toBe(true);
    expect(remoteThreatActive(mem, 1000 + REMOTE_THREAT_HOLD_TICKS - 1)).toBe(
      true,
    );
  });

  test("stays active without vision until hold expires", () => {
    const mem = { remoteThreatUntil: 1300, remoteThreatCount: 2 };
    const mid = tickRemoteThreat(mem, { tick: 1200, hostilesNow: null });
    expect(mid.active).toBe(true);
    expect(mem.remoteThreatUntil).toBe(1300);
  });

  test("clears after hold when room empty or no vision", () => {
    const mem = { remoteThreatUntil: 1100, remoteThreatCount: 1 };
    const cleared = tickRemoteThreat(mem, { tick: 1100, hostilesNow: 0 });
    expect(cleared.active).toBe(false);
    expect(mem.remoteThreatUntil).toBeUndefined();
    expect(remoteThreatActive(mem, 1100)).toBe(false);
  });

  test("re-arms while hostiles still present after expiry tick", () => {
    const mem = { remoteThreatUntil: 1000, remoteThreatCount: 1 };
    const r = tickRemoteThreat(mem, { tick: 1000, hostilesNow: 2 });
    expect(r.active).toBe(true);
    expect(mem.remoteThreatUntil).toBe(1000 + REMOTE_THREAT_HOLD_TICKS);
  });
});

describe("shouldEvacuateRemoteOpts blackout salvage", () => {
  test("always flees live hostiles", () => {
    expect(
      shouldEvacuateRemoteOpts({
        threatSticky: false,
        hostilesInCreepRoom: 1,
        role: "remoteHauler",
        storageEnergy: 0,
      }),
    ).toBe(true);
  });

  test("hauler salvages during sticky + blackout (can leave home)", () => {
    expect(
      shouldEvacuateRemoteOpts({
        threatSticky: true,
        hostilesInCreepRoom: 0,
        role: "remoteHauler",
        storageEnergy: 0,
      }),
    ).toBe(false);
  });

  test("miner still flees sticky even in blackout", () => {
    expect(
      shouldEvacuateRemoteOpts({
        threatSticky: true,
        hostilesInCreepRoom: 0,
        role: "remoteMiner",
        storageEnergy: 0,
      }),
    ).toBe(true);
  });

  test("hauler flees sticky when storage healthy", () => {
    expect(
      shouldEvacuateRemoteOpts({
        threatSticky: true,
        hostilesInCreepRoom: 0,
        role: "remoteHauler",
        storageEnergy: STORAGE_FLOOR_ENERGY + 1,
      }),
    ).toBe(true);
  });
});

describe("allowRemoteSalvageSpawn", () => {
  test("only under sticky threat + floor", () => {
    expect(
      allowRemoteSalvageSpawn({
        threatActive: true,
        storageEnergy: 0,
      }),
    ).toBe(true);
    expect(
      allowRemoteSalvageSpawn({
        threatActive: false,
        storageEnergy: 0,
      }),
    ).toBe(false);
    expect(
      allowRemoteSalvageSpawn({
        threatActive: true,
        storageEnergy: STORAGE_FLOOR_ENERGY + 1,
      }),
    ).toBe(false);
  });
});
