import { describe, expect, test } from "vitest";
import {
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
