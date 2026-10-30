/**
 * Exit-choke perimeter walls — not a naive mid-edge frame.
 *
 * Example: west exit with swamp on x=2 and a 3-tile plains gap at x=3 around
 * y≈35 → wall that gap (depth 3), gate on the tile closest to spawn.
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
