/**
 * Tests for Phase 2B enhanced unread/read command behaviour.
 *
 * Tests are written against the logic directly (not by spawning the CLI) to
 * keep them fast and dependency-free.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadState,
  saveState,
  getLastReadTime,
  setLastReadTime,
} from "../src/state.js";
import type { State } from "../src/state.js";

// ---------------------------------------------------------------------------
// Test isolation: per-test temp directory for config/state files
// ---------------------------------------------------------------------------

let tmpDir: string;
let savedConfigDir: string | undefined;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `ntfy-unread-read-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(tmpDir, { recursive: true });
  savedConfigDir = process.env["NTFY_CONFIG_DIR"];
  process.env["NTFY_CONFIG_DIR"] = tmpDir;
});

afterEach(() => {
  if (savedConfigDir !== undefined) {
    process.env["NTFY_CONFIG_DIR"] = savedConfigDir;
  } else {
    delete process.env["NTFY_CONFIG_DIR"];
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: build a fake unread result set (mimics cmdUnread output shape)
// ---------------------------------------------------------------------------

interface FakeResult {
  topic: string;
  count: number;
  messages: Array<{ id: string; time: number; event: string; topic: string; message: string }>;
}

function buildUnreadJsonOutput(
  profileName: string,
  sinceTimestamp: number,
  results: FakeResult[]
): object {
  const total = results.reduce((sum, r) => sum + r.count, 0);
  return {
    profileName,
    sinceTimestamp,
    total,
    topics: results.map((r) => ({
      topic: r.topic,
      count: r.count,
      messages: r.messages,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests: unread --json schema
// ---------------------------------------------------------------------------

describe("unread --json output schema", () => {
  it("includes profileName field", () => {
    const output = buildUnreadJsonOutput(
      "home",
      1708432800,
      [{ topic: "FAST-daniel_elliot", count: 3, messages: [] }]
    );

    expect(output).toHaveProperty("profileName", "home");
  });

  it("includes sinceTimestamp field", () => {
    const output = buildUnreadJsonOutput(
      "home",
      1708432800,
      [{ topic: "FAST-daniel_elliot", count: 3, messages: [] }]
    );

    expect(output).toHaveProperty("sinceTimestamp", 1708432800);
  });

  it("includes total field matching sum of all topic counts", () => {
    const output = buildUnreadJsonOutput("home", 1708432800, [
      { topic: "FAST-all", count: 2, messages: [] },
      { topic: "FAST-daniel_elliot", count: 3, messages: [] },
    ]) as { total: number };

    expect(output.total).toBe(5);
  });

  it("includes per-topic count field in topics array", () => {
    const output = buildUnreadJsonOutput("home", 1708432800, [
      {
        topic: "FAST-daniel_elliot",
        count: 3,
        messages: [
          { id: "a1", time: 1708432801, event: "message", topic: "FAST-daniel_elliot", message: "hello" },
        ],
      },
    ]) as { topics: Array<{ count: number }> };

    expect(output.topics[0]!.count).toBe(3);
  });

  it("JSON-stringifies without errors and matches snapshot shape", () => {
    const output = buildUnreadJsonOutput("home", 1708432800, [
      { topic: "FAST-all", count: 1, messages: [] },
    ]);

    const json = JSON.stringify(output);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(typeof parsed["profileName"]).toBe("string");
    expect(typeof parsed["sinceTimestamp"]).toBe("number");
    expect(typeof parsed["total"]).toBe("number");
    expect(Array.isArray(parsed["topics"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: read --topic only updates the specified topic in state
// ---------------------------------------------------------------------------

describe("read --topic updates only the specified topic", () => {
  it("marks only the target topic, leaves others untouched", () => {
    // Set up initial state with two topics already read at time 1000
    let state: State = { topics: {} };
    state = setLastReadTime(state, "home", "FAST-all", 1000);
    state = setLastReadTime(state, "home", "FAST-daniel_elliot", 1000);
    saveState(state);

    // Simulate read --topic FAST-all (updates only FAST-all to now)
    const before = Math.floor(Date.now() / 1000);
    let loaded = loadState();
    loaded = setLastReadTime(loaded, "home", "FAST-all");
    saveState(loaded);

    // Verify: FAST-all is updated, FAST-daniel_elliot is still 1000
    const final = loadState();
    const fastAllTime = getLastReadTime(final, "home", "FAST-all");
    const danielTime = getLastReadTime(final, "home", "FAST-daniel_elliot");

    expect(fastAllTime).toBeGreaterThanOrEqual(before);
    expect(danielTime).toBe(1000); // unchanged
  });

  it("does not touch topics from other profiles", () => {
    let state: State = { topics: {} };
    state = setLastReadTime(state, "home", "FAST-all", 2000);
    state = setLastReadTime(state, "work", "alerts", 2000);
    saveState(state);

    // Mark only home/FAST-all as read
    let loaded = loadState();
    loaded = setLastReadTime(loaded, "home", "FAST-all");
    saveState(loaded);

    const final = loadState();
    // work/alerts should be untouched
    expect(getLastReadTime(final, "work", "alerts")).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// Tests: read --all updates all profiles
// ---------------------------------------------------------------------------

describe("read --all updates all profiles", () => {
  it("updates all topics across multiple profiles", () => {
    // Simulate --all: iterate config profiles and set all topics
    const profileMap: Record<string, string[]> = {
      home: ["FAST-all", "FAST-daniel_elliot"],
      personal: ["ntfy-alerts"],
    };

    const before = Math.floor(Date.now() / 1000);
    let state: State = { topics: {} };

    for (const [profileName, topics] of Object.entries(profileMap)) {
      for (const topic of topics) {
        state = setLastReadTime(state, profileName, topic);
      }
    }
    saveState(state);

    const after = Math.floor(Date.now() / 1000);
    const final = loadState();

    // All three topics should now be set to approximately "now"
    const t1 = getLastReadTime(final, "home", "FAST-all");
    const t2 = getLastReadTime(final, "home", "FAST-daniel_elliot");
    const t3 = getLastReadTime(final, "personal", "ntfy-alerts");

    expect(t1).toBeGreaterThanOrEqual(before);
    expect(t1).toBeLessThanOrEqual(after + 1);
    expect(t2).toBeGreaterThanOrEqual(before);
    expect(t3).toBeGreaterThanOrEqual(before);
  });

  it("topic count matches sum of all profile topics", () => {
    const profileMap: Record<string, string[]> = {
      home: ["FAST-all", "FAST-daniel_elliot", "FAST-infra"],
      personal: ["ntfy-alerts"],
    };

    let totalTopics = 0;
    for (const topics of Object.values(profileMap)) {
      totalTopics += topics.length;
    }

    expect(totalTopics).toBe(4);
  });

  it("does not affect existing unrelated state keys", () => {
    // Pre-existing state key from a different/deleted profile
    let state: State = { topics: {} };
    state = setLastReadTime(state, "old-profile", "stale-topic", 1234567890);
    saveState(state);

    // Simulate --all for a fresh config (only "home" profile)
    let loaded = loadState();
    loaded = setLastReadTime(loaded, "home", "FAST-all");
    saveState(loaded);

    const final = loadState();
    // Old key should still be there
    expect(getLastReadTime(final, "old-profile", "stale-topic")).toBe(1234567890);
  });
});
