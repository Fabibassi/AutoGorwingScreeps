import { afterEach, describe, expect, test, vi } from "vitest";
import { createIssue, dispatchEvolveWorkflow } from "../ops/githubIssues";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createIssue", () => {
  test("creates without labels then adds labels so labeled can fire", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, body });
        if (url.endsWith("/issues") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ number: 42 }),
            text: async () => "",
          };
        }
        if (url.endsWith("/issues/42/labels")) {
          return { ok: true, json: async () => [], text: async () => "" };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const n = await createIssue({
      token: "t",
      repo: "owner/repo",
      title: "AGS evolve: test",
      body: "body",
      labels: ["evolve"],
    });

    expect(n).toBe(42);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.github.com/repos/owner/repo/issues");
    expect(calls[0].body).toEqual({
      title: "AGS evolve: test",
      body: "body",
    });
    expect(calls[0].body).not.toHaveProperty("labels");
    expect(calls[1].url).toBe(
      "https://api.github.com/repos/owner/repo/issues/42/labels",
    );
    expect(calls[1].body).toEqual({ labels: ["evolve"] });
  });
});

describe("dispatchEvolveWorkflow", () => {
  test("posts workflow_dispatch with issue_number", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchEvolveWorkflow({
      token: "t",
      repo: "owner/repo",
      issueNumber: 42,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/owner/repo/actions/workflows/evolve.yml/dispatches",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      ref: "main",
      inputs: { issue_number: "42" },
    });
  });
});
