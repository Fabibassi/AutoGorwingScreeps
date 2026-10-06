/**
 * Reuse the already-parsed Memory object across consecutive ticks.
 * Inspired by community memHack (TooAngel / International / screepers), but we
 * only skip JSON.parse when Game.time advanced by exactly 1 — not a bot clone.
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
  if (
    state.parsed &&
    shouldReuseParsedMemory(state.lastTick, now)
  ) {
    if (raw) raw._parsed = state.parsed;
    return { lastTick: now, parsed: state.parsed, reused: true };
  }
  if (raw) raw._parsed = freshlyParsed;
  return { lastTick: now, parsed: freshlyParsed, reused: false };
}

type GlobalMem = {
  Memory?: Memory;
  __agsMemHack?: { lastTick?: number; parsed?: Memory };
};

/** First statement of loop(): keep Memory identity when the global survived. */
export function applyParsedMemoryReuse(): boolean {
  const g = globalThis as unknown as GlobalMem;
  const now = typeof Game === "undefined" ? 0 : Game.time;
  const raw =
    typeof RawMemory === "undefined"
      ? undefined
      : (RawMemory as unknown as RawWithParsed);
  const freshlyParsed =
    typeof Memory === "undefined" ? ({} as Memory) : Memory;
  const next = restoreParsedMemory(g.__agsMemHack ?? {}, now, freshlyParsed, raw);
  g.__agsMemHack = { lastTick: next.lastTick, parsed: next.parsed };
  if (next.reused) {
    g.Memory = next.parsed;
  }
  return next.reused;
}
