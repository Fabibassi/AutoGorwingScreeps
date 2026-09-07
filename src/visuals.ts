/** Unicode icons shown above creeps (visual-only say bubbles). */
export const ROLE_ICONS: Readonly<Record<string, string>> = {
  harvester: "⛏",
  upgrader: "⚡",
};

export function showCreepJob(creep: Creep): void {
  const role = creep.memory.role;
  if (!role) return;
  const icon = ROLE_ICONS[role];
  if (!icon) return;
  creep.say(icon, true);
}
