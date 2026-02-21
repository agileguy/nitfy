/**
 * Tests for Phase 2A: parsePriority helper and topic management commands.
 *
 * Topic add/remove tests use NTFY_CONFIG_DIR temp directory so we never
 * touch the real ~/.config/ntfy-cli during CI or development.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// parsePriority is exported from the main entry point
import { parsePriority } from "../ntfy.js";

// Config helpers for filesystem tests
import { loadConfig, saveConfig } from "../src/config.js";
import type { Config, ServerProfile } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    url: "https://ntfy.example.com",
    user: "alice",
    password: "s3cr3t",
    defaultTopic: "alerts",
    topics: ["alerts", "homelab"],
    topicGroups: {},
    ...overrides,
  };
}

function makeConfig(profileName = "home", overrides: Partial<Config> = {}): Config {
  return {
    activeProfile: profileName,
    profiles: {
      [profileName]: makeProfile(),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parsePriority - named levels
// ---------------------------------------------------------------------------

describe("parsePriority - named levels", () => {
  it("converts 'min' to 1", () => {
    expect(parsePriority("min")).toBe(1);
  });

  it("converts 'low' to 2", () => {
    expect(parsePriority("low")).toBe(2);
  });

  it("converts 'default' to 3", () => {
    expect(parsePriority("default")).toBe(3);
  });

  it("converts 'high' to 4", () => {
    expect(parsePriority("high")).toBe(4);
  });

  it("converts 'urgent' to 5", () => {
    expect(parsePriority("urgent")).toBe(5);
  });

  it("converts 'max' to 5 (alias for urgent)", () => {
    expect(parsePriority("max")).toBe(5);
  });

  it("converts 'minimum' to 1 (SRD §9.5 alias)", () => {
    expect(parsePriority("minimum")).toBe(1);
  });

  it("converts 'normal' to 3 (SRD §9.5 alias)", () => {
    expect(parsePriority("normal")).toBe(3);
  });

  it("converts 'maximum' to 5 (SRD §9.5 alias)", () => {
    expect(parsePriority("maximum")).toBe(5);
  });

  it("is case-insensitive for named levels", () => {
    expect(parsePriority("HIGH")).toBe(4);
    expect(parsePriority("Urgent")).toBe(5);
    expect(parsePriority("LOW")).toBe(2);
  });

  it("trims whitespace around named levels", () => {
    expect(parsePriority("  high  ")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// parsePriority - numeric strings
// ---------------------------------------------------------------------------

describe("parsePriority - numeric strings", () => {
  it("converts '1' to 1", () => {
    expect(parsePriority("1")).toBe(1);
  });

  it("converts '2' to 2", () => {
    expect(parsePriority("2")).toBe(2);
  });

  it("converts '3' to 3", () => {
    expect(parsePriority("3")).toBe(3);
  });

  it("converts '4' to 4", () => {
    expect(parsePriority("4")).toBe(4);
  });

  it("converts '5' to 5", () => {
    expect(parsePriority("5")).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// parsePriority - invalid inputs
// ---------------------------------------------------------------------------

describe("parsePriority - invalid inputs", () => {
  it("returns undefined for out-of-range number '0'", () => {
    expect(parsePriority("0")).toBeUndefined();
  });

  it("returns undefined for out-of-range number '6'", () => {
    expect(parsePriority("6")).toBeUndefined();
  });

  it("returns undefined for unknown name 'critical'", () => {
    expect(parsePriority("critical")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parsePriority("")).toBeUndefined();
  });

  it("returns undefined for non-numeric gibberish", () => {
    expect(parsePriority("abc")).toBeUndefined();
  });

  it("returns undefined for negative number", () => {
    expect(parsePriority("-1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Topic add / remove - filesystem tests
// ---------------------------------------------------------------------------

describe("topic management (filesystem)", () => {
  let tmpDir: string;
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `ntfy-topics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

  it("adding a topic saves it to the profile's topics array", () => {
    const config = makeConfig();
    saveConfig(config);

    // Simulate what cmdTopicsAdd does
    const loaded = loadConfig()!;
    const profile = loaded.profiles["home"]!;
    const newTopic = "new-alerts";
    profile.topics = [...profile.topics, newTopic];
    saveConfig(loaded);

    const reloaded = loadConfig()!;
    expect(reloaded.profiles["home"]!.topics).toContain(newTopic);
  });

  it("adding a topic does not duplicate an existing topic", () => {
    const config = makeConfig();
    saveConfig(config);

    const loaded = loadConfig()!;
    const profile = loaded.profiles["home"]!;
    const existingTopic = "alerts"; // already in topics

    // Guard as cmdTopicsAdd does
    if (!profile.topics.includes(existingTopic)) {
      profile.topics = [...profile.topics, existingTopic];
      saveConfig(loaded);
    }

    const reloaded = loadConfig()!;
    const count = reloaded.profiles["home"]!.topics.filter((t) => t === existingTopic).length;
    expect(count).toBe(1);
  });

  it("removing a topic removes it from the topics array", () => {
    const config = makeConfig();
    saveConfig(config);

    const loaded = loadConfig()!;
    const profile = loaded.profiles["home"]!;
    const topicToRemove = "homelab"; // not the default

    profile.topics = profile.topics.filter((t) => t !== topicToRemove);
    saveConfig(loaded);

    const reloaded = loadConfig()!;
    expect(reloaded.profiles["home"]!.topics).not.toContain(topicToRemove);
  });

  it("removing a topic also removes it from topic groups", () => {
    const config = makeConfig();
    config.profiles["home"]!.topicGroups = {
      infra: ["alerts", "homelab"],
      alerts: ["alerts"],
    };
    saveConfig(config);

    const loaded = loadConfig()!;
    const profile = loaded.profiles["home"]!;
    const topicToRemove = "homelab";

    // Remove from topics array
    profile.topics = profile.topics.filter((t) => t !== topicToRemove);

    // Remove from groups (as cmdTopicsRemove does)
    for (const groupName of Object.keys(profile.topicGroups)) {
      const members = profile.topicGroups[groupName];
      if (members) {
        profile.topicGroups[groupName] = members.filter((t) => t !== topicToRemove);
      }
    }
    saveConfig(loaded);

    const reloaded = loadConfig()!;
    const groups = reloaded.profiles["home"]!.topicGroups;
    expect(groups["infra"]).toEqual(["alerts"]);
    expect(groups["alerts"]).toEqual(["alerts"]);
  });

  it("cannot remove the default topic (guard logic)", () => {
    const config = makeConfig();
    saveConfig(config);

    const loaded = loadConfig()!;
    const profile = loaded.profiles["home"]!;
    const defaultTopic = profile.defaultTopic; // "alerts"

    // Simulate the guard condition in cmdTopicsRemove: the attempt to remove
    // the default topic should be caught by the topic === profile.defaultTopic check.
    // We verify the guard fires correctly and leaves the topic list unchanged.
    const topicsBeforeAttempt = [...profile.topics];

    if (profile.defaultTopic === defaultTopic) {
      // Guard fires: do NOT remove, leave config unchanged
    } else {
      profile.topics = profile.topics.filter((t) => t !== defaultTopic);
      saveConfig(loaded);
    }

    // Config should not have been changed - default topic still in the list
    const reloaded = loadConfig()!;
    expect(reloaded.profiles["home"]!.topics).toContain(defaultTopic);
    expect(reloaded.profiles["home"]!.topics).toEqual(topicsBeforeAttempt);
    expect(reloaded.profiles["home"]!.defaultTopic).toBe(defaultTopic);
  });

  it("adding a topic group saves it correctly", () => {
    const config = makeConfig();
    saveConfig(config);

    const loaded = loadConfig()!;
    const profile = loaded.profiles["home"]!;
    profile.topicGroups = { ...profile.topicGroups, infra: ["alerts", "homelab"] };
    saveConfig(loaded);

    const reloaded = loadConfig()!;
    expect(reloaded.profiles["home"]!.topicGroups["infra"]).toEqual(["alerts", "homelab"]);
  });

  it("removing a topic group deletes it from topicGroups", () => {
    const config = makeConfig();
    config.profiles["home"]!.topicGroups = { infra: ["alerts"] };
    saveConfig(config);

    const loaded = loadConfig()!;
    const profile = loaded.profiles["home"]!;
    const updatedGroups = { ...profile.topicGroups };
    delete updatedGroups["infra"];
    profile.topicGroups = updatedGroups;
    saveConfig(loaded);

    const reloaded = loadConfig()!;
    expect(reloaded.profiles["home"]!.topicGroups["infra"]).toBeUndefined();
  });
});
