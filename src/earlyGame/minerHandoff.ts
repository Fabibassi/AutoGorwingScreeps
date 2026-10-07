export type MinerHandoffSnapshot = {
  sourceId?: string;
  ticksToLive?: number;
};

export function minerMoveTicksPerTile(workParts: number, moveParts: number): number {
  const moves = Math.max(1, moveParts);
  const fatiguePerTile = Math.max(1, workParts) * 2;
  return Math.max(1, Math.ceil(fatiguePerTile / (moves * 2)));
}

export function minerReplacementLeadTime(opts: {
  bodyParts: number;
  workParts: number;
  moveParts: number;
  range: number;
  buffer?: number;
}): number {
  const spawnTicks = Math.max(0, opts.bodyParts) * 3;
  const travel =
    Math.max(0, opts.range) *
    minerMoveTicksPerTile(opts.workParts, opts.moveParts);
  return spawnTicks + travel + (opts.buffer ?? 10);
}

export function minerNeedsReplacement(
  ticksToLive: number | undefined,
  leadTime: number,
): boolean {
  if (ticksToLive == null) return false;
  return ticksToLive <= leadTime;
}

function minersOnSource(
  miners: MinerHandoffSnapshot[],
  sourceId: string,
): MinerHandoffSnapshot[] {
  return miners.filter((m) => m.sourceId === sourceId);
}

export function durableCount(
  snapshots: Array<{ ticksToLive?: number }>,
  leadTime: number,
): number {
  return snapshots.filter((s) => !minerNeedsReplacement(s.ticksToLive, leadTime))
    .length;
}

export function durableMinerCount(
  miners: MinerHandoffSnapshot[],
  sourceIds: string[],
  leadTimeFor: (sourceId: string) => number,
): number {
  let n = 0;
  for (const sid of sourceIds) {
    const here = minersOnSource(miners, sid);
    const lead = leadTimeFor(sid);
    const healthy = here.filter((m) => !minerNeedsReplacement(m.ticksToLive, lead));
    if (healthy.length > 0 || here.length >= 2) n++;
  }
  const uncovered = Math.max(0, sourceIds.length - n);
  if (uncovered === 0) return n;
  const fallbackLead =
    sourceIds.length > 0 ? leadTimeFor(sourceIds[0]) : 100;
  const unassignedHealthy = miners.filter(
    (m) =>
      !m.sourceId && !minerNeedsReplacement(m.ticksToLive, fallbackLead),
  ).length;
  return n + Math.min(uncovered, unassignedHealthy);
}

/** Never more than one seat plus one walking replacement per source. */
export function minerLiveCap(wantMiner: number, sourceCount: number): number {
  const seats = Math.max(wantMiner, sourceCount, 0);
  return seats * 2;
}

/**
 * Spawn quota for miners is per mining seat, not per room source count.
 * Partial containers / drop-mine seat lists must not stack extras on one source.
 */
export function minerSpawnSeatsWanted(
  wantMiner: number,
  seatCount: number,
): number {
  if (seatCount <= 0) return Math.max(0, wantMiner);
  return Math.min(Math.max(0, wantMiner), seatCount);
}

export function sourceIdForReplacementMiner(
  miners: MinerHandoffSnapshot[],
  sourceIds: string[],
  leadTimeFor: (sourceId: string) => number,
): string | null {
  let unassigned = miners.filter((m) => !m.sourceId).length;
  for (const sid of sourceIds) {
    if (minersOnSource(miners, sid).length === 0) {
      if (unassigned > 0) {
        unassigned--;
        continue;
      }
      return sid;
    }
  }
  for (const sid of sourceIds) {
    const here = minersOnSource(miners, sid);
    const lead = leadTimeFor(sid);
    const healthy = here.filter((m) => !minerNeedsReplacement(m.ticksToLive, lead));
    if (healthy.length === 0 && here.length === 1) return sid;
  }
  return null;
}

/**
 * Pick a mining seat: empty sources first (never pile both miners on the near one),
 * then sticky if sole occupant, then fewest peers / closest.
 */
export function pickMinerSourceId(opts: {
  selfName: string;
  selfSourceId?: string;
  sourceIds: string[];
  peers: Array<{ name: string; sourceId?: string }>;
  rangeTo?: (sourceId: string) => number;
}): string | null {
  if (opts.sourceIds.length === 0) return null;
  const rangeTo = opts.rangeTo ?? (() => 0);
  const counts = new Map<string, number>();
  for (const sid of opts.sourceIds) counts.set(sid, 0);
  for (const peer of opts.peers) {
    if (peer.name === opts.selfName) continue;
    if (!peer.sourceId || !counts.has(peer.sourceId)) continue;
    counts.set(peer.sourceId, (counts.get(peer.sourceId) ?? 0) + 1);
  }

  const empty = opts.sourceIds.filter((sid) => (counts.get(sid) ?? 0) === 0);
  if (empty.length > 0) {
    if (
      opts.selfSourceId &&
      empty.includes(opts.selfSourceId) &&
      (counts.get(opts.selfSourceId) ?? 0) === 0
    ) {
      return opts.selfSourceId;
    }
    empty.sort((a, b) => rangeTo(a) - rangeTo(b) || a.localeCompare(b));
    return empty[0] ?? null;
  }

  if (opts.selfSourceId && counts.has(opts.selfSourceId)) {
    return opts.selfSourceId;
  }

  const ranked = [...opts.sourceIds].sort((a, b) => {
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (ca !== cb) return ca - cb;
    const ra = rangeTo(a) - rangeTo(b);
    if (ra !== 0) return ra;
    return a.localeCompare(b);
  });
  return ranked[0] ?? null;
}

/** Replacement (higher TTL) yields the seat while the incumbent still mines. */
export function shouldWaitForIncumbentMiner(
  self: { name: string; ticksToLive?: number },
  peersNearSource: Array<{ name: string; ticksToLive?: number }>,
): boolean {
  const selfTtl = self.ticksToLive ?? 1500;
  return peersNearSource.some((p) => {
    if (p.name === self.name) return false;
    const peerTtl = p.ticksToLive ?? 0;
    return peerTtl > 0 && peerTtl < selfTtl;
  });
}
