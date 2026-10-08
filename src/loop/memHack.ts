/**
 * Reuse the already-parsed Memory object across consecutive ticks.
 * Inspired by community memHack (TooAngel / International / screepers), but we
 * only skip JSON.parse when Game.time advanced by exactly 1 — not a bot clone.
 *
 * LIVE NOTE (shard3/World): installing RawMemory._parsed for reuse caused
 * Memory.ags writes to stop serializing after the first post-deploy ticks
 * (metrics.tick / cpuUsedAvg frozen while creeps still ran). Keep the pure
 * helpers for tests; applyParsedMemoryReuse is a no-op until a safer World
 * strategy is proven.
 */
export function shouldReuseParsedMemory(
  lastTick: number | undefined,
  now: number,
): boolean {
  return lastTick != null && lastTick + 1 === now;
}

type RawWithParsed = { _parsed?: Memory };

export function restoreParsedMemory(
  state: { lastTick?: number; parsed?: Memory },
  now: number,
  freshlyParsed: Memory,
  raw?: RawWithParsed,
): { lastTick: number; parsed: Memory; reused: boolean } {
  if (state.parsed && shouldReuseParsedMemory(state.lastTick, now)) {
    if (raw) raw._parsed = state.parsed;
    return { lastTick: now, parsed: state.parsed, reused: true };
  }
  if (raw) raw._parsed = freshlyParsed;
  return { lastTick: now, parsed: freshlyParsed, reused: false };
}

/**
 * First statement of loop(). Currently disabled on World — see file header.
 * Returns false always so the engine's normal Memory parse/serialize runs.
 */
export function applyParsedMemoryReuse(): boolean {
  return false;
}
