const EXIT_DIRS: DirectionConstant[] = [
  TOP,
  TOP_RIGHT,
  RIGHT,
  BOTTOM_RIGHT,
  BOTTOM,
  BOTTOM_LEFT,
  LEFT,
  TOP_LEFT,
];

/** True when the creep is standing on a spawn tile (newborn / jammed). */
export function isOnSpawnTile(creep: Creep): boolean {
  return creep.room
    .find(FIND_MY_SPAWNS)
    .some((s) => s.pos.isEqualTo(creep.pos));
}

/**
 * Newborns land on the spawn tile and cannot act until they step off.
 * Returns true if this tick was spent leaving the spawn (caller should skip role work).
 */
export function moveOffSpawn(creep: Creep): boolean {
  if (!isOnSpawnTile(creep)) return false;
  if (creep.fatigue > 0) return true;
  if (creep.getActiveBodyparts(MOVE) === 0) return true;

  for (const dir of EXIT_DIRS) {
    if (creep.move(dir) === OK) return true;
  }
  // All exits blocked this tick — still claim the tick so roles don't path-into spawn.
  return true;
}
