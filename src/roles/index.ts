import { runAttacker } from "./attacker";
import { runBuilder } from "./builder";
import { runClaimer } from "./claimer";
import { runFiller } from "./filler";
import { runHarvester } from "./harvester";
import { runHauler } from "./hauler";
import { evictIdleFromSpawnRing } from "./idlePark";
import { runMineralMiner } from "./mineralMiner";
import { runMiner } from "./miner";
import { moveOffSpawn } from "./moveOffSpawn";
import { runRemoteHauler } from "./remoteHauler";
import { runRemoteMiner } from "./remoteMiner";
import { runReserver } from "./reserver";
import { runUpgrader } from "./upgrader";

/** Energy harvested this tick; 0 for non-harvest roles. */
export type RoleRunner = (creep: Creep) => number;

const roleRunners: Record<string, RoleRunner> = {
  harvester: runHarvester,
  miner: runMiner,
  hauler: (creep) => {
    runHauler(creep);
    return 0;
  },
  filler: (creep) => {
    runFiller(creep);
    return 0;
  },
  builder: (creep) => {
    runBuilder(creep);
    return 0;
  },
  upgrader: (creep) => {
    runUpgrader(creep);
    return 0;
  },
  remoteMiner: runRemoteMiner,
  remoteHauler: (creep) => {
    runRemoteHauler(creep);
    return 0;
  },
  reserver: (creep) => {
    runReserver(creep);
    return 0;
  },
  attacker: (creep) => {
    runAttacker(creep);
    return 0;
  },
  mineralMiner: runMineralMiner,
  claimer: (creep) => {
    runClaimer(creep);
    return 0;
  },
};

export function registeredRoles(): string[] {
  return Object.keys(roleRunners);
}

export function runCreep(creep: Creep): number {
  // Spawn tile is not walkable for work — step off before any role logic.
  if (moveOffSpawn(creep)) return 0;
  const role = creep.memory.role;
  const runner = role ? roleRunners[role] : undefined;
  const harvested = runner ? runner(creep) : 0;
  evictIdleFromSpawnRing(creep);
  return harvested;
}
