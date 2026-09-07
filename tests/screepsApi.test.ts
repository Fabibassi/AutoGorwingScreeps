import { describe, expect, test } from "vitest";
import { screepsHeaders } from "../ops/screepsApi";

describe("screepsHeaders", () => {
  test("sets X-Token", () => {
    expect(screepsHeaders("abc")["X-Token"]).toBe("abc");
  });

  test("sets shard header when provided", () => {
    expect(screepsHeaders("abc", "shard3")["X-Shard"]).toBe("shard3");
  });

  test("omits shard header when empty", () => {
    expect(screepsHeaders("abc", "")["X-Shard"]).toBeUndefined();
  });
});
