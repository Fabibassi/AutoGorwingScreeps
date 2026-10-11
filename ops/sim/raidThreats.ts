/**
 * RCL3–6 attack-raid threat catalog + expected pass matrix.
 * Spec: docs/superpowers/specs/2026-10-11-defense-attack-sim-design.md
 */

export type RaidThreatId = "probe" | "drain" | "smash" | "swarm";
export type RclLevel = 3 | 4 | 5 | 6;

export const THREAT_IDS: RaidThreatId[] = [
  "probe",
  "drain",
  "smash",
  "swarm",
];
export const RCL_LEVELS: RclLevel[] = [3, 4, 5, 6];

export type HubSeedSpec = {
  rcl: RclLevel;
  towers: number;
  extensions: number;
  storageEnergy: number;
  spawnEnergy: number;
  containerEnergy: number;
};

/** Body part names as used by mockup creep docs / Screeps constants. */
export type RaidBodyPart =
  | "move"
  | "attack"
  | "ranged_attack"
  | "heal"
  | "tough"
  | "work"
  | "carry";

/**
 * Expected pass matrix.
 * Baseline 2026-10-11 (seeded hub, full towers): all catalog threats clear
 * under tower fire in &lt;10 ticks. Fail-ok cells from the initial Spec were
 * upgraded to pass after evidence; harder bodies are a follow-up campaign.
 */
const EXPECTED_PASS: Record<RclLevel, Record<RaidThreatId, boolean>> = {
  3: { probe: true, drain: true, smash: true, swarm: true },
  4: { probe: true, drain: true, smash: true, swarm: true },
  5: { probe: true, drain: true, smash: true, swarm: true },
  6: { probe: true, drain: true, smash: true, swarm: true },
};

export function expectedPass(rcl: RclLevel, threat: RaidThreatId): boolean {
  return EXPECTED_PASS[rcl][threat];
}

export function hubSeedSpec(rcl: RclLevel): HubSeedSpec {
  if (rcl === 3) {
    return {
      rcl,
      towers: 1,
      extensions: 10,
      storageEnergy: 0,
      spawnEnergy: 300,
      containerEnergy: 1800,
    };
  }
  if (rcl === 4) {
    return {
      rcl,
      towers: 1,
      extensions: 20,
      storageEnergy: 25_000,
      spawnEnergy: 300,
      containerEnergy: 1800,
    };
  }
  // RCL5/6: full hub (2 towers, ~30 ext)
  return {
    rcl,
    towers: 2,
    extensions: 30,
    storageEnergy: 60_000,
    spawnEnergy: 300,
    containerEnergy: 1800,
  };
}

function parts(...p: RaidBodyPart[]): RaidBodyPart[] {
  return p;
}

/** One body per hostile creep to inject. */
export function buildThreatBodies(
  rcl: RclLevel,
  threat: RaidThreatId,
): RaidBodyPart[][] {
  switch (threat) {
    case "probe":
      return rcl <= 3
        ? [parts("move", "attack")]
        : [parts("move", "attack", "attack")];
    case "drain": {
      const tank = parts(
        "tough",
        "tough",
        "heal",
        "heal",
        "move",
        "move",
      );
      return rcl >= 5 ? [tank, tank] : [tank];
    }
    case "smash":
      return rcl >= 5
        ? [parts("work", "work", "work", "move", "move")]
        : [parts("attack", "attack", "attack", "move")];
    case "swarm": {
      const n = rcl <= 3 ? 4 : rcl === 4 ? 6 : 8;
      const unit =
        rcl >= 5
          ? parts("move", "attack", "attack")
          : parts("move", "attack");
      return Array.from({ length: n }, () => [...unit]);
    }
    default:
      return [parts("move", "attack")];
  }
}

export function isRclLevel(n: number): n is RclLevel {
  return n === 3 || n === 4 || n === 5 || n === 6;
}

export function isRaidThreatId(s: string): s is RaidThreatId {
  return (THREAT_IDS as string[]).includes(s);
}
