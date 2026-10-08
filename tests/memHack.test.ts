import { describe, expect, test } from "vitest";
import {
  applyParsedMemoryReuse,
  restoreParsedMemory,
  shouldReuseParsedMemory,
} from "../src/loop/memHack";

describe("shouldReuseParsedMemory", () => {
  test("reuses only on the next consecutive tick", () => {
    expect(shouldReuseParsedMemory(10, 11)).toBe(true);
    expect(shouldReuseParsedMemory(10, 12)).toBe(false);
    expect(shouldReuseParsedMemory(undefined, 11)).toBe(false);
  });
});

describe("restoreParsedMemory", () => {
  test("keeps the same object and stamps RawMemory._parsed", () => {
    const parsed = { creeps: {} } as Memory;
    const raw: { _parsed?: Memory } = {};
    const first = restoreParsedMemory({}, 100, parsed, raw);
    expect(first.reused).toBe(false);
    const second = restoreParsedMemory(
      first,
      101,
      { creeps: { x: {} } } as unknown as Memory,
      raw,
    );
    expect(second.reused).toBe(true);
    expect(second.parsed).toBe(parsed);
    expect(raw._parsed).toBe(parsed);
  });
});

describe("applyParsedMemoryReuse", () => {
  test("does not throw when Memory cannot be assigned", () => {
    const g = globalThis as { Memory?: Memory; __agsMemHack?: unknown };
    const prevHack = g.__agsMemHack;
    g.__agsMemHack = {
      lastTick: 10,
      parsed: { creeps: {} } as Memory,
    };
    expect(() => applyParsedMemoryReuse()).not.toThrow();
    g.__agsMemHack = prevHack;
  });

  test("reuse installs cached parse on RawMemory before any Memory read", () => {
    const g = globalThis as {
      Memory?: Memory;
      Game?: { time: number };
      RawMemory?: { _parsed?: Memory };
      __agsMemHack?: unknown;
    };
    const cached = { creeps: {}, ags: { metrics: { tick: 10 } } } as Memory;
    const throwaway = { creeps: { junk: {} } } as unknown as Memory;
    const prev = {
      hack: g.__agsMemHack,
      memory: g.Memory,
      game: g.Game,
      raw: g.RawMemory,
    };
    g.Game = { time: 11 };
    g.RawMemory = { _parsed: throwaway };
    g.Memory = throwaway;
    g.__agsMemHack = { lastTick: 10, parsed: cached };

    expect(applyParsedMemoryReuse()).toBe(true);
    expect(g.RawMemory?._parsed).toBe(cached);
    expect(g.Memory).toBe(cached);

    g.__agsMemHack = prev.hack;
    g.Memory = prev.memory;
    g.Game = prev.game;
    g.RawMemory = prev.raw;
  });
});
