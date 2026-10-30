/**
 * Edge helpers for the fixed 2/47 wall frame.
 * Depth scoring / swamp preference retired — walls always sit on coord 2/47.
 */

export type ExitSide = "top" | "right" | "bottom" | "left";

export const EDGE_DEPTHS = [2, 3, 4] as const;

export function inwardDelta(
  side: ExitSide,
): { dx: number; dy: number } {
  switch (side) {
    case "top":
      return { dx: 0, dy: 1 };
    case "bottom":
      return { dx: 0, dy: -1 };
    case "left":
      return { dx: 1, dy: 0 };
    case "right":
      return { dx: -1, dy: 0 };
  }
}

export function projectInward(
  exit: { x: number; y: number },
  side: ExitSide,
  depth: number,
): { x: number; y: number } {
  const { dx, dy } = inwardDelta(side);
  return { x: exit.x + dx * depth, y: exit.y + dy * depth };
}

export type EdgeTileInfo = {
  x: number;
  y: number;
  /** Terrain is not natural wall. */
  walkable: boolean;
  swamp: boolean;
};

/**
 * Prefer a depth whose choke is mostly plains and reasonably narrow.
 * Swamp-only mouths (e.g. west x=2 strip) lose to a plains gap one tile deeper.
 * Same-quality plains: tighter wins (do NOT reward a wider deeper line).
 */
export function scoreEdgeDepth(tiles: EdgeTileInfo[]): number {
  const walk = tiles.filter((t) => t.walkable);
  if (walk.length === 0) return Number.NEGATIVE_INFINITY;
  const plains = walk.filter((t) => !t.swamp).length;
  const swampOnly = plains === 0;
  // Swamp-only: heavy penalty, still slightly prefer tighter.
  if (swampOnly) return 1 - walk.length * 0.1;
  // Plains: base + plains bonus − width. Tighter plains beat wide plains.
  return 100 + plains * 10 - walk.length * 20;
}

export function pickBestEdgeDepth(
  byDepth: Record<number, EdgeTileInfo[]>,
): number | null {
  let best: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const d of EDGE_DEPTHS) {
    const tiles = byDepth[d] ?? [];
    const score = scoreEdgeDepth(tiles);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  if (best == null || bestScore === Number.NEGATIVE_INFINITY) return null;
  return best;
}

/**
 * Expand projected exit tiles along the same depth line so a multi-tile
 * choke between natural walls is fully covered.
 */
export function expandChokeAlongEdge(
  seeds: Array<{ x: number; y: number }>,
  side: ExitSide,
  walkable: Set<string>,
): Array<{ x: number; y: number }> {
  const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
  const out = new Map<string, { x: number; y: number }>();
  const queue = [...seeds];
  for (const s of seeds) out.set(key(s), s);

  const horiz = side === "top" || side === "bottom";
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const neighbors = horiz
      ? [
          { x: cur.x - 1, y: cur.y },
          { x: cur.x + 1, y: cur.y },
        ]
      : [
          { x: cur.x, y: cur.y - 1 },
          { x: cur.x, y: cur.y + 1 },
        ];
    for (const n of neighbors) {
      const k = key(n);
      if (out.has(k) || !walkable.has(k)) continue;
      out.set(k, n);
      queue.push(n);
    }
  }
  return [...out.values()];
}

/** Gate = choke tile closest to spawn (own traffic). */
export function pickChokeGate(
  tiles: Array<{ x: number; y: number }>,
  spawn: { x: number; y: number },
): { x: number; y: number } | null {
  if (tiles.length === 0) return null;
  let best = tiles[0];
  let bestD =
    Math.max(Math.abs(best.x - spawn.x), Math.abs(best.y - spawn.y));
  for (const t of tiles) {
    const d = Math.max(Math.abs(t.x - spawn.x), Math.abs(t.y - spawn.y));
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

export function planChokeWallTiles(
  choke: Array<{ x: number; y: number }>,
  spawn: { x: number; y: number },
): { walls: Array<{ x: number; y: number }>; gate: { x: number; y: number } | null } {
  const gate = pickChokeGate(choke, spawn);
  if (!gate) return { walls: [], gate: null };
  const walls = choke.filter((t) => t.x !== gate.x || t.y !== gate.y);
  return { walls, gate };
}

const ORTH: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * BFS: can we walk from `from` to any exit without stepping on `blocked`?
 * `isWalkable` is terrain (and optional structure) walkability — blocked wins.
 */
export function canReachAnyExit(
  isWalkable: (x: number, y: number) => boolean,
  blocked: ReadonlySet<string>,
  from: { x: number; y: number },
  exits: Array<{ x: number; y: number }>,
): boolean {
  if (exits.length === 0) return true;
  const goals = new Set(exits.map((e) => `${e.x},${e.y}`));
  const start = `${from.x},${from.y}`;
  if (blocked.has(start)) return false;
  const seen = new Set<string>([start]);
  const queue: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const ck = `${cur.x},${cur.y}`;
    if (goals.has(ck)) return true;
    for (const [dx, dy] of ORTH) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
      const nk = `${nx},${ny}`;
      if (seen.has(nk) || blocked.has(nk)) continue;
      if (!isWalkable(nx, ny) && !goals.has(nk)) continue;
      // Exits on the border may be terrain-wall-adjacent; allow stepping onto goal.
      if (!isWalkable(nx, ny) && goals.has(nk)) {
        return true;
      }
      if (!isWalkable(nx, ny)) continue;
      seen.add(nk);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

/**
 * True if adding `candidate` to the blocked set would seal spawn off every exit.
 */
export function wallWouldSealExitPath(
  isWalkable: (x: number, y: number) => boolean,
  alreadyBlocked: ReadonlySet<string>,
  candidate: { x: number; y: number },
  spawn: { x: number; y: number },
  exits: Array<{ x: number; y: number }>,
): boolean {
  if (exits.length === 0) return false;
  const blocked = new Set(alreadyBlocked);
  blocked.add(`${candidate.x},${candidate.y}`);
  return !canReachAnyExit(isWalkable, blocked, spawn, exits);
}

/**
 * Edge-band tiles (e.g. y=2) that lie on at least one walk from spawn to a
 * side exit. Those form the real "mouth" — never seal all of them.
 */
export function edgeTilesOnPathsToExits(
  isWalkable: (x: number, y: number) => boolean,
  spawn: { x: number; y: number },
  exits: Array<{ x: number; y: number }>,
  isEdgeTile: (x: number, y: number) => boolean,
): Set<string> {
  const mouth = new Set<string>();
  if (exits.length === 0) return mouth;
  const goals = new Set(exits.map((e) => `${e.x},${e.y}`));
  const parent = new Map<string, string | null>();
  const start = `${spawn.x},${spawn.y}`;
  parent.set(start, null);
  const queue: Array<{ x: number; y: number }> = [{ x: spawn.x, y: spawn.y }];
  const reachedGoals: string[] = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const ck = `${cur.x},${cur.y}`;
    if (goals.has(ck)) {
      reachedGoals.push(ck);
      continue; // still explore other routes
    }
    for (const [dx, dy] of ORTH) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
      const nk = `${nx},${ny}`;
      if (parent.has(nk)) continue;
      const goal = goals.has(nk);
      if (!goal && !isWalkable(nx, ny)) continue;
      parent.set(nk, ck);
      queue.push({ x: nx, y: ny });
    }
  }

  for (const goal of reachedGoals) {
    let cur: string | null = goal;
    while (cur) {
      const [xs, ys] = cur.split(",");
      const x = Number(xs);
      const y = Number(ys);
      if (isEdgeTile(x, y)) mouth.add(cur);
      cur = parent.get(cur) ?? null;
    }
  }
  return mouth;
}

/** Narrow mouths stay fully open; wide mouths keep a single gate. */
export const EDGE_MOUTH_FULL_OPEN_MAX = 3;
