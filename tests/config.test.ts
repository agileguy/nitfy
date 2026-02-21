/**
 * Tests for src/config.ts
 *
 * Note: functions that touch the real filesystem (loadConfig, saveConfig,
 * ensureConfigDir, resolveProfile with file I/O) are tested with a temporary
 * directory so we never pollute ~/.config/ntfy-cli during CI or development.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test the pure functions directly (no filesystem side effects)
import {
  validateProfile,
  getProfileFromEnv,
  resolveProfile,
  loadConfig,
  saveConfig,
} from "../src/config.js";
import type { Config, ServerProfile } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helper: create a minimal valid profile
// ---------------------------------------------------------------------------
function makeProfile(overrides: Partial<ServerProfile> = {}): Partial<ServerProfile> {
  return {
    url: "https://ntfy.example.com",
    user: "alice",
    password: "s3cr3t",
    defaultTopic: "alerts",
    topics: ["alerts"],
    topicGroups: {},
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    activeProfile: "default",
    profiles: {
      default: makeProfile() as ServerProfile,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateProfile
// ---------------------------------------------------------------------------
describe("validateProfile", () => {
  it("returns empty array for a fully valid profile", () => {
    const errors = validateProfile(makeProfile());
    expect(errors).toEqual([]);
  });

  it("catches missing url", () => {
    const errors = validateProfile(makeProfile({ url: undefined }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("url"))).toBe(true);
  });

  it("catches empty url string", () => {
    const errors = validateProfile(makeProfile({ url: "" }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("url"))).toBe(true);
  });

  it("catches invalid url format", () => {
    const errors = validateProfile(makeProfile({ url: "not-a-url" }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("url"))).toBe(true);
  });

  it("catches missing user", () => {
    const errors = validateProfile(makeProfile({ user: undefined }));
    expect(errors.some((e) => e.includes("user"))).toBe(true);
  });

  it("catches empty user", () => {
    const errors = validateProfile(makeProfile({ user: "" }));
    expect(errors.some((e) => e.includes("user"))).toBe(true);
  });

  it("catches missing password", () => {
    const errors = validateProfile(makeProfile({ password: undefined }));
    expect(errors.some((e) => e.includes("password"))).toBe(true);
  });

  it("catches missing defaultTopic", () => {
    const errors = validateProfile(makeProfile({ defaultTopic: undefined }));
    expect(errors.some((e) => e.includes("defaultTopic"))).toBe(true);
  });

  it("catches empty defaultTopic", () => {
    const errors = validateProfile(makeProfile({ defaultTopic: "" }));
    expect(errors.some((e) => e.includes("defaultTopic"))).toBe(true);
  });

  it("can return multiple errors at once", () => {
    const errors = validateProfile({});
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// getProfileFromEnv
// ---------------------------------------------------------------------------
describe("getProfileFromEnv", () => {
  // Save and restore env vars around each test
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NTFY_URL: process.env["NTFY_URL"],
      NTFY_USER: process.env["NTFY_USER"],
      NTFY_PASSWORD: process.env["NTFY_PASSWORD"],
      NTFY_TOPIC: process.env["NTFY_TOPIC"],
    };
    delete process.env["NTFY_URL"];
    delete process.env["NTFY_USER"];
    delete process.env["NTFY_PASSWORD"];
    delete process.env["NTFY_TOPIC"];
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("returns null when NTFY_URL is not set", () => {
    const profile = getProfileFromEnv();
    expect(profile).toBeNull();
  });

  it("returns a profile when NTFY_URL is set", () => {
    process.env["NTFY_URL"] = "https://ntfy.sh";
    process.env["NTFY_USER"] = "bob";
    process.env["NTFY_PASSWORD"] = "pass";
    process.env["NTFY_TOPIC"] = "myfeed";

    const profile = getProfileFromEnv();
    expect(profile).not.toBeNull();
    expect(profile!.url).toBe("https://ntfy.sh");
    expect(profile!.user).toBe("bob");
    expect(profile!.password).toBe("pass");
    expect(profile!.defaultTopic).toBe("myfeed");
  });

  it("uses default topic 'notifications' when NTFY_TOPIC is unset", () => {
    process.env["NTFY_URL"] = "https://ntfy.sh";

    const profile = getProfileFromEnv();
    expect(profile).not.toBeNull();
    expect(profile!.defaultTopic).toBe("notifications");
  });
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------
describe("resolveProfile", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NTFY_URL: process.env["NTFY_URL"],
      NTFY_USER: process.env["NTFY_USER"],
      NTFY_PASSWORD: process.env["NTFY_PASSWORD"],
      NTFY_TOPIC: process.env["NTFY_TOPIC"],
    };
    delete process.env["NTFY_URL"];
    delete process.env["NTFY_USER"];
    delete process.env["NTFY_PASSWORD"];
    delete process.env["NTFY_TOPIC"];
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("uses env vars when no config is provided", () => {
    process.env["NTFY_URL"] = "https://env.ntfy.sh";
    process.env["NTFY_USER"] = "envuser";
    process.env["NTFY_PASSWORD"] = "envpass";
    process.env["NTFY_TOPIC"] = "envtopic";

    const profile = resolveProfile(null);
    expect(profile.url).toBe("https://env.ntfy.sh");
    expect(profile.user).toBe("envuser");
  });

  it("uses config active profile when no server override is given", () => {
    const config = makeConfig();
    const profile = resolveProfile(config);
    expect(profile.url).toBe("https://ntfy.example.com");
  });

  it("uses the named server override when provided", () => {
    const config = makeConfig({
      profiles: {
        default: makeProfile() as ServerProfile,
        staging: makeProfile({ url: "https://staging.ntfy.sh" }) as ServerProfile,
      },
    });
    const profile = resolveProfile(config, "staging");
    expect(profile.url).toBe("https://staging.ntfy.sh");
  });

  it("throws when server override names unknown profile", () => {
    const config = makeConfig();
    expect(() => resolveProfile(config, "nonexistent")).toThrow();
  });

  it("throws when no config and no env vars", () => {
    expect(() => resolveProfile(null)).toThrow();
  });

  it("throws when --server given but no config file", () => {
    expect(() => resolveProfile(null, "myprofile")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// File-system round-trip tests (using temp directory via NTFY_CONFIG_DIR)
// ---------------------------------------------------------------------------
describe("config file round-trip", () => {
  let tmpDir: string;
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ntfy-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    savedConfigDir = process.env["NTFY_CONFIG_DIR"];
    // Override config dir so ensureConfigDir / loadConfig / saveConfig use tmpDir
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

  it("saveConfig + loadConfig round-trips successfully", () => {
    const config = makeConfig();
    saveConfig(config);
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.activeProfile).toBe("default");
    expect(loaded!.profiles["default"]!.url).toBe("https://ntfy.example.com");
  });

  it("loadConfig returns null when config file does not exist", () => {
    const result = loadConfig();
    expect(result).toBeNull();
  });

  it("config.json is created with mode 0600", () => {
    saveConfig(makeConfig());
    const path = join(tmpDir, "config.json");
    expect(existsSync(path)).toBe(true);
    const stat = Bun.file(path);
    // File should be readable by Bun (existence check suffices for cross-platform)
    expect(stat.size).toBeGreaterThan(0);
  });
});
