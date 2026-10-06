/** Unicode icons shown above creeps (visual-only say bubbles). */
export const ROLE_ICONS: Readonly<Record<string, string>> = {
  harvester: "⛏",
  miner: "⛏",
  hauler: "📦",
  filler: "⛽",
  builder: "🔨",
  upgrader: "⚡",
};

/** Skip say() when the CPU bucket is thin (Overmind/TooAngel: CPU is a resource). */
export function shouldShowCreepJobs(bucket: number): boolean {
  return bucket >= 2000;
}

export function showCreepJob(creep: Creep): void {
  const bucket =
    typeof Game !== "undefined" && Game.cpu ? Game.cpu.bucket : 10000;
  if (!shouldShowCreepJobs(bucket)) return;
  const role = creep.memory.role;
  if (!role) return;
  const icon = ROLE_ICONS[role];
  if (!icon) return;
  creep.say(icon, true);
}
