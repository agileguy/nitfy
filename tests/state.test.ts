/**
 * Tests for src/state.ts
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
  getStateKey,
} from "../src/state.js";
import type { State } from "../src/state.js";

// ---------------------------------------------------------------------------
// Pure function tests (no filesystem I/O)
// ---------------------------------------------------------------------------
describe("getStateKey", () => {
  it("returns 'profile/topic' format", () => {
    const key = getStateKey("myserver", "alerts");
    expect(key).toBe("myserver/alerts");
  });

  it("handles profile names with slashes in topic", () => {
    const key = getStateKey("prod", "team/infra");
    expect(key).toBe("prod/team/infra");
  });
});

describe("getLastReadTime", () => {
  it("returns 0 for an unknown profile+topic", () => {
    const state: State = { topics: {} };
    const t = getLastReadTime(state, "prod", "alerts");
    expect(t).toBe(0);
  });

  it("returns the stored timestamp for a known key", () => {
    const state: State = {
      topics: {
        "prod/alerts": { lastReadTime: 1700000000 },
      },
    };
    const t = getLastReadTime(state, "prod", "alerts");
    expect(t).toBe(1700000000);
  });

  it("returns 0 when profile matches but topic differs", () => {
    const state: State = {
      topics: {
        "prod/alerts": { lastReadTime: 1700000000 },
      },
    };
    const t = getLastReadTime(state, "prod", "other");
    expect(t).toBe(0);
  });
});

describe("setLastReadTime", () => {
  it("sets the timestamp for a new key", () => {
    const state: State = { topics: {} };
    const updated = setLastReadTime(state, "prod", "alerts", 1700000000);
    expect(updated.topics["prod/alerts"]!.lastReadTime).toBe(1700000000);
  });

  it("overwrites an existing timestamp", () => {
    const state: State = {
      topics: { "prod/alerts": { lastReadTime: 1000 } },
    };
    const updated = setLastReadTime(state, "prod", "alerts", 2000);
    expect(updated.topics["prod/alerts"]!.lastReadTime).toBe(2000);
  });

  it("uses current time when no timestamp is provided", () => {
    const before = Math.floor(Date.now() / 1000) - 1;
    const state: State = { topics: {} };
    const updated = setLastReadTime(state, "prod", "alerts");
    const after = Math.floor(Date.now() / 1000) + 1;
    const stored = updated.topics["prod/alerts"]!.lastReadTime;
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(after);
  });

  it("does not mutate the original state object", () => {
    const original: State = { topics: {} };
    setLastReadTime(original, "prod", "alerts", 9999);
    expect(original.topics["prod/alerts"]).toBeUndefined();
  });

  it("preserves other topics in state", () => {
    const state: State = {
      topics: { "prod/other": { lastReadTime: 555 } },
    };
    const updated = setLastReadTime(state, "prod", "alerts", 1000);
    expect(updated.topics["prod/other"]!.lastReadTime).toBe(555);
    expect(updated.topics["prod/alerts"]!.lastReadTime).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Filesystem round-trip tests using temp directory via NTFY_CONFIG_DIR
// ---------------------------------------------------------------------------
describe("state file round-trip", () => {
  let tmpDir: string;
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `ntfy-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tmpDir, { recursive: true });
    savedConfigDir = process.env["NTFY_CONFIG_DIR"];
    // Override config dir so ensureConfigDir uses our temp dir
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

  it("loadState returns empty state when no file exists", () => {
    const state = loadState();
    expect(state).toEqual({ topics: {} });
  });

  it("saveState + loadState round-trips correctly", () => {
    const state: State = {
      topics: {
        "prod/alerts": { lastReadTime: 1700000000 },
        "staging/debug": { lastReadTime: 1700001234 },
      },
    };
    saveState(state);
    const loaded = loadState();
    expect(loaded.topics["prod/alerts"]!.lastReadTime).toBe(1700000000);
    expect(loaded.topics["staging/debug"]!.lastReadTime).toBe(1700001234);
  });

  it("setLastReadTime persists through save/load cycle", () => {
    let state = loadState();
    state = setLastReadTime(state, "prod", "infra", 1699999999);
    saveState(state);

    const reloaded = loadState();
    expect(getLastReadTime(reloaded, "prod", "infra")).toBe(1699999999);
  });
});
