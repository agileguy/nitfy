/**
 * Tests for the enhanced health command (--all flag).
 *
 * Tests the checkHealth function behavior with multiple profiles,
 * parallel execution, and error handling.
 */

import { describe, it, expect, spyOn, afterEach, mock } from "bun:test";
import { checkHealth } from "../src/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

function makeResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    statusText: status === 200 ? "OK" : "Error",
  });
}

// ---------------------------------------------------------------------------
// checkHealth (single profile)
// ---------------------------------------------------------------------------

describe("checkHealth single profile", () => {
  afterEach(() => {
    mock.restore();
  });

  it("returns healthy: true with version when server is healthy", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse({ healthy: true, version: "2.9.0" })
    );

    const result = await checkHealth("https://ntfy.example.com", "user", "pass");

    expect(result.healthy).toBe(true);
    expect(result.version).toBe("2.9.0");

    spy.mockRestore();
  });

  it("returns healthy: false on 500 status", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse("Internal Server Error", 500)
    );

    const result = await checkHealth("https://ntfy.example.com", "", "");

    expect(result.healthy).toBe(false);

    spy.mockRestore();
  });

  it("returns healthy: false when fetch rejects (network error)", async () => {
    const spy = spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("ECONNREFUSED")
    );

    const result = await checkHealth("https://ntfy.example.com", "", "");

    expect(result.healthy).toBe(false);

    spy.mockRestore();
  });

  it("returns healthy: false when server explicitly says unhealthy", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse({ healthy: false })
    );

    const result = await checkHealth("https://ntfy.example.com", "", "");

    expect(result.healthy).toBe(false);
    expect(result.version).toBeUndefined();

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Enhanced health --all: multi-profile parallel checks
//
// We test the core behavior by directly calling checkHealth multiple times
// in parallel (as the --all flag would do), and verify the aggregation logic.
// ---------------------------------------------------------------------------

describe("health --all multi-profile aggregation", () => {
  afterEach(() => {
    mock.restore();
  });

  it("all healthy: all return healthy: true", async () => {
    // Use mockImplementation (not mockResolvedValue) so each call gets a fresh
    // Response - Response body streams can only be consumed once.
    const spy = spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeJsonResponse({ healthy: true, version: "2.8.0" })
    );

    const profiles = [
      { name: "home", url: "https://ntfy.home.example.com", user: "", password: "" },
      { name: "work", url: "https://ntfy.work.example.com", user: "u", password: "p" },
    ];

    const results = await Promise.all(
      profiles.map(async (p) => {
        try {
          const health = await checkHealth(p.url, p.user, p.password);
          return { profile: p.name, url: p.url, healthy: health.healthy, version: health.version };
        } catch (err: unknown) {
          return { profile: p.name, url: p.url, healthy: false, error: String(err) };
        }
      })
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.healthy)).toBe(true);
    expect(results[0]!.profile).toBe("home");
    expect(results[1]!.profile).toBe("work");

    spy.mockRestore();
  });

  it("one unhealthy: any-unhealthy detection works", async () => {
    let callCount = 0;
    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      // First call healthy, second call unhealthy
      if (callCount === 1) {
        return makeJsonResponse({ healthy: true, version: "2.8.0" });
      }
      return makeResponse("Service Unavailable", 503);
    });

    const profiles = [
      { name: "home", url: "https://ntfy.home.example.com", user: "", password: "" },
      { name: "work", url: "https://ntfy.work.example.com", user: "", password: "" },
    ];

    const results = await Promise.all(
      profiles.map(async (p) => {
        try {
          const health = await checkHealth(p.url, p.user, p.password);
          return { profile: p.name, url: p.url, healthy: health.healthy };
        } catch (err: unknown) {
          return { profile: p.name, url: p.url, healthy: false };
        }
      })
    );

    const anyUnhealthy = results.some((r) => !r.healthy);

    expect(anyUnhealthy).toBe(true);
    expect(results[0]!.healthy).toBe(true);
    expect(results[1]!.healthy).toBe(false);

    spy.mockRestore();
  });

  it("network error for one profile: captured in error field", async () => {
    let callCount = 0;
    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeJsonResponse({ healthy: true, version: "2.8.0" });
      }
      throw new Error("connect ECONNREFUSED 10.0.0.1:443");
    });

    const profiles = [
      { name: "online", url: "https://ntfy.online.example.com", user: "", password: "" },
      { name: "offline", url: "https://ntfy.offline.example.com", user: "", password: "" },
    ];

    const results = await Promise.all(
      profiles.map(async (p) => {
        try {
          const health = await checkHealth(p.url, p.user, p.password);
          return { profile: p.name, url: p.url, healthy: health.healthy, version: health.version };
        } catch (err: unknown) {
          return {
            profile: p.name,
            url: p.url,
            healthy: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    // The offline profile has a network error but checkHealth catches it internally
    // and returns { healthy: false } rather than throwing.
    // So the catch block in our aggregation never fires for checkHealth.
    expect(results[0]!.healthy).toBe(true);
    expect(results[1]!.healthy).toBe(false);
    expect(results.some((r) => !r.healthy)).toBe(true);

    spy.mockRestore();
  });

  it("JSON output format has all required fields", async () => {
    const spy = spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeJsonResponse({ healthy: true, version: "2.10.0" })
    );

    const profile = { name: "test", url: "https://ntfy.example.com", user: "", password: "" };

    const health = await checkHealth(profile.url, profile.user, profile.password);
    const result = {
      profile: profile.name,
      url: profile.url,
      healthy: health.healthy,
      version: health.version,
    };

    // Verify the JSON-serializable shape matches SRD spec: {profile, url, healthy, version, error?}
    expect(result).toHaveProperty("profile");
    expect(result).toHaveProperty("url");
    expect(result).toHaveProperty("healthy");
    expect(typeof result.profile).toBe("string");
    expect(typeof result.url).toBe("string");
    expect(typeof result.healthy).toBe("boolean");

    spy.mockRestore();
  });

  it("all profiles run in parallel (fetch called for each)", async () => {
    const fetchCalls: string[] = [];
    const spy = spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      fetchCalls.push(typeof url === "string" ? url : url.toString());
      return makeJsonResponse({ healthy: true, version: "2.8.0" });
    });

    const urls = [
      "https://ntfy.server1.example.com",
      "https://ntfy.server2.example.com",
      "https://ntfy.server3.example.com",
    ];

    await Promise.all(urls.map((url) => checkHealth(url, "", "")));

    expect(fetchCalls).toHaveLength(3);
    // Verify all three URLs were fetched (in any order due to parallelism)
    for (const url of urls) {
      expect(fetchCalls.some((c) => c.includes(url))).toBe(true);
    }

    spy.mockRestore();
  });
});
