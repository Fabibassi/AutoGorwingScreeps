import { desiredCreeps } from "./spawn";

export const STATUS_LOG_INTERVAL = 20;

export interface ColonySnapshot {
  tick: number;
  rcl: number;
  spawnEnergy: number;
  spawnEnergyCap: number;
  creepEnergy: number;
  harvesters: number;
  upgraders: number;
  wantHarvesters: number;
  wantUpgraders: number;
  priority: "spawn" | "harvest" | "upgrade";
  priorityDetail?: string;
}

export function countCreepsByRole(): { harvester: number; upgrader: number } {
  const counts = { harvester: 0, upgrader: 0 };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role;
    if (role === "harvester") counts.harvester++;
    else if (role === "upgrader") counts.upgrader++;
  }
  return counts;
}

export function resolvePriority(opts: {
  spawning: boolean;
  spawningRole?: string;
  harvesters: number;
  upgraders: number;
  wantHarvesters: number;
  wantUpgraders: number;
  spawnEnergy: number;
  spawnEnergyCap: number;
}): { priority: ColonySnapshot["priority"]; detail?: string } {
  if (opts.spawning) {
    return { priority: "spawn", detail: opts.spawningRole ?? "creep" };
  }
  if (opts.harvesters < opts.wantHarvesters) {
    return { priority: "spawn", detail: "harvester" };
  }
  if (opts.upgraders < opts.wantUpgraders) {
    return { priority: "spawn", detail: "upgrader" };
  }
  const fillRatio =
    opts.spawnEnergyCap > 0 ? opts.spawnEnergy / opts.spawnEnergyCap : 1;
  if (fillRatio < 0.5) {
    return { priority: "harvest" };
  }
  return { priority: "upgrade" };
}

export function formatStatusLine(snapshot: ColonySnapshot): string {
  const priorityLabel = snapshot.priorityDetail
    ? `${snapshot.priority}:${snapshot.priorityDetail}`
    : snapshot.priority;
  return (
    `[t${snapshot.tick}] RCL${snapshot.rcl} | ` +
    `spawn ${snapshot.spawnEnergy}/${snapshot.spawnEnergyCap}E | ` +
    `creeps ${snapshot.creepEnergy}E | ` +
    `H ${snapshot.harvesters}/${snapshot.wantHarvesters} ` +
    `U ${snapshot.upgraders}/${snapshot.wantUpgraders} | ` +
    `→ ${priorityLabel}`
  );
}

export function shouldLogStatus(
  tick: number,
  interval: number = STATUS_LOG_INTERVAL,
): boolean {
  return tick > 0 && tick % interval === 0;
}

export function collectColonySnapshot(): ColonySnapshot | undefined {
  const spawn = Object.values(Game.spawns)[0];
  if (!spawn) return undefined;

  const room = spawn.room;
  const rcl = room.controller?.level ?? 1;
  const want = desiredCreeps(rcl);
  const counts = countCreepsByRole();

  let creepEnergy = 0;
  for (const name in Game.creeps) {
    creepEnergy += Game.creeps[name].store.getUsedCapacity(RESOURCE_ENERGY);
  }

  const spawningRole = spawn.spawning?.name.split("-")[0];
  const { priority, detail } = resolvePriority({
    spawning: !!spawn.spawning,
    spawningRole,
    harvesters: counts.harvester,
    upgraders: counts.upgrader,
    wantHarvesters: want.harvester,
    wantUpgraders: want.upgrader,
    spawnEnergy: spawn.store.getUsedCapacity(RESOURCE_ENERGY),
    spawnEnergyCap: spawn.store.getCapacity(RESOURCE_ENERGY),
  });

  return {
    tick: Game.time,
    rcl,
    spawnEnergy: spawn.store.getUsedCapacity(RESOURCE_ENERGY),
    spawnEnergyCap: spawn.store.getCapacity(RESOURCE_ENERGY),
    creepEnergy,
    harvesters: counts.harvester,
    upgraders: counts.upgrader,
    wantHarvesters: want.harvester,
    wantUpgraders: want.upgrader,
    priority,
    priorityDetail: detail,
  };
}

export function logColonyStatus(): void {
  const snapshot = collectColonySnapshot();
  if (!snapshot) return;
  console.log(formatStatusLine(snapshot));
}
