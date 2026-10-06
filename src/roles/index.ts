import { runBuilder } from "./builder";
import { runFiller } from "./filler";
import { runHarvester } from "./harvester";
import { runHauler } from "./hauler";
import { runMiner } from "./miner";
import { moveOffSpawn } from "./moveOffSpawn";
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
};

export function registeredRoles(): string[] {
  return Object.keys(roleRunners);
}

export function runCreep(creep: Creep): number {
  // Spawn tile is not walkable for work — step off before any role logic.
  if (moveOffSpawn(creep)) return 0;
  const role = creep.memory.role;
  if (!role) return 0;
  const runner = roleRunners[role];
  if (!runner) return 0;
  return runner(creep);
}
