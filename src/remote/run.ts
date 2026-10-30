/**
 * Remote room side effects: place container sites when plan wants them.
 */
import { remotePlanNeedsContainer, parseRemotePlan } from "../earlyGame/remotePlan";

function placeRemoteContainers(remote: Room): boolean {
  for (const source of remote.find(FIND_SOURCES)) {
    const hasContainer = source.pos
      .findInRange(FIND_STRUCTURES, 1)
      .some((s) => s.structureType === STRUCTURE_CONTAINER);
    const hasSite = source.pos
      .findInRange(FIND_CONSTRUCTION_SITES, 1)
      .some((s) => s.structureType === STRUCTURE_CONTAINER);
    if (hasContainer || hasSite) continue;

    const terrain = remote.getTerrain();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = source.pos.x + dx;
        const y = source.pos.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        remote.createConstructionSite(x, y, STRUCTURE_CONTAINER);
        return true;
      }
    }
  }
  return false;
}

export function runRemoteConstruction(homeRoom: Room): void {
  const plan = parseRemotePlan(Memory.ags?.remotePlan);
  if (!remotePlanNeedsContainer(plan)) return;
  const remotes = [Memory.ags?.remoteRoom, Memory.ags?.remoteRoom2].filter(
    (n): n is string => Boolean(n) && n !== homeRoom.name,
  );
  for (const remoteName of remotes) {
    const remote = Game.rooms[remoteName];
    if (!remote) continue;
    if (placeRemoteContainers(remote)) return;
  }
}
