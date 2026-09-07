import { desiredCreeps } from "./spawn";

export const STATUS_LOG_INTERVAL = 20;

export type BotPriority = "spawn" | "harvest" | "upgrade";

export interface BotSnapshot {
  tick: number;
  rcl: number;
  spawnEnergy: number;
  spawnCapacity: number;
  creepEnergy: number;
  harvesters: number;
  upgraders: number;
  wantHarvesters: number;
  wantUpgraders: number;
  priority: BotPriority;
  spawning: string | null;
}

export function countCreepsByRole(): { harvester: number; upgrader: number } {
  const counts = { harvester: 0, upgrader: 0 };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role as keyof typeof counts;
    if (role in counts) counts[role]++;
  }
  return counts;
}

export function totalCreepEnergy(): number {
  let total = 0;
  for (const name in Game.creeps) {
    total += Game.creeps[name].store.getUsedCapacity(RESOURCE_ENERGY);
  }
  return total;
}

/** Mirrors spawn order: missing creeps → spawn; else refill spawn → harvest; else upgrade. */
export function getPriority(
  counts: { harvester: number; upgrader: number },
  want: { harvester: number; upgrader: number },
  opts: { spawning: boolean; spawnHasFreeCapacity: boolean },
): BotPriority {
  if (opts.spawning) return "spawn";
  if (counts.harvester < want.harvester || counts.upgrader < want.upgrader) {
    return "spawn";
  }
  if (opts.spawnHasFreeCapacity) return "harvest";
  return "upgrade";
}

export function collectBotSnapshot(tick: number): BotSnapshot | null {
  const room = Object.values(Game.rooms)[0];
  if (!room) return null;

  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const rcl = room.controller?.level ?? 1;
  const want = desiredCreeps(rcl);
  const counts = countCreepsByRole();

  return {
    tick,
    rcl,
    spawnEnergy: spawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    spawnCapacity: spawn?.store.getCapacity(RESOURCE_ENERGY) ?? 0,
    creepEnergy: totalCreepEnergy(),
    harvesters: counts.harvester,
    upgraders: counts.upgrader,
    wantHarvesters: want.harvester,
    wantUpgraders: want.upgrader,
    priority: getPriority(counts, want, {
      spawning: Boolean(spawn?.spawning),
      spawnHasFreeCapacity: Boolean(
        spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      ),
    }),
    spawning: spawn?.spawning?.name ?? null,
  };
}

export function formatStatusLine(snapshot: BotSnapshot): string {
  const energy = `spawn:${snapshot.spawnEnergy}/${snapshot.spawnCapacity} creeps:${snapshot.creepEnergy}`;
  const counts = `H:${snapshot.harvesters}/${snapshot.wantHarvesters} U:${snapshot.upgraders}/${snapshot.wantUpgraders}`;
  const spawning = snapshot.spawning ? ` spawning:${snapshot.spawning}` : "";
  return `[T${snapshot.tick}] RCL${snapshot.rcl} | E ${energy} | ${counts} | prio:${snapshot.priority}${spawning}`;
}

export function shouldLogStatus(
  tick: number,
  interval: number = STATUS_LOG_INTERVAL,
): boolean {
  return tick > 0 && tick % interval === 0;
}

export function logStatusIfDue(
  tick: number,
  interval: number = STATUS_LOG_INTERVAL,
): void {
  if (!shouldLogStatus(tick, interval)) return;

  const snapshot = collectBotSnapshot(tick);
  if (!snapshot) {
    console.log(`[T${tick}] no room visible`);
    return;
  }
  console.log(formatStatusLine(snapshot));
}
