import { runHarvester } from "./harvester";
import { runUpgrader } from "./upgrader";

/** Energy harvested this tick; 0 for non-harvest roles. */
export type RoleRunner = (creep: Creep) => number;

const roleRunners: Record<string, RoleRunner> = {
  harvester: runHarvester,
  upgrader: (creep) => {
    runUpgrader(creep);
    return 0;
  },
};

export function registeredRoles(): string[] {
  return Object.keys(roleRunners);
}

export function runCreep(creep: Creep): number {
  const role = creep.memory.role;
  if (!role) return 0;
  const runner = roleRunners[role];
  if (!runner) return 0;
  return runner(creep);
}
