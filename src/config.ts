/**
 * Configuration management for ntfy-cli.
 * Stores profiles at ~/.config/ntfy-cli/config.json
 */

import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface ServerProfile {
  url: string;
  user: string;
  password: string;
  defaultTopic: string;
  topics: string[];
  topicGroups: Record<string, string[]>;
  skipSSLVerification?: boolean;
}

export interface Config {
  activeProfile: string;
  profiles: Record<string, ServerProfile>;
}

/**
 * Returns the config directory path, creating it if it does not exist.
 * Respects the NTFY_CONFIG_DIR environment variable for testing purposes.
 */
export function ensureConfigDir(): string {
  const dir = process.env["NTFY_CONFIG_DIR"] ?? join(homedir(), ".config", "ntfy-cli");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Reads config.json from the config directory.
 * Returns null if the file does not exist.
 */
export function loadConfig(): Config | null {
  const dir = ensureConfigDir();
  const path = join(dir, "config.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as Config;
  } catch {
    return null;
  }
}

/**
 * Writes the config to disk with 2-space indentation and mode 0600.
 */
export function saveConfig(config: Config): void {
  const dir = ensureConfigDir();
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  chmodSync(path, 0o600);
}

/**
 * Returns the currently active profile from the config.
 * Throws if the active profile does not exist.
 */
export function getActiveProfile(config: Config): ServerProfile {
  const profile = config.profiles[config.activeProfile];
  if (!profile) {
    throw new Error(
      `Active profile "${config.activeProfile}" not found in config. ` +
        `Run: ntfy config list`
    );
  }
  return profile;
}

/**
 * Validates a partial profile and returns an array of error strings.
 * Returns an empty array if the profile is valid.
 */
export function validateProfile(profile: Partial<ServerProfile>): string[] {
  const errors: string[] = [];

  if (!profile.url || profile.url.trim() === "") {
    errors.push("url is required");
  } else {
    try {
      new URL(profile.url);
    } catch {
      errors.push(`url "${profile.url}" is not a valid URL`);
    }
  }

  if (!profile.user || profile.user.trim() === "") {
    errors.push("user is required");
  }

  if (!profile.password || profile.password.trim() === "") {
    errors.push("password is required");
  }

  if (!profile.defaultTopic || profile.defaultTopic.trim() === "") {
    errors.push("defaultTopic is required");
  }

  return errors;
}

/**
 * Builds a ServerProfile from NTFY_* environment variables.
 * Returns null if NTFY_URL is not set.
 */
export function getProfileFromEnv(): ServerProfile | null {
  const url = process.env["NTFY_URL"];
  if (!url) {
    return null;
  }

  const user = process.env["NTFY_USER"] ?? "";
  const password = process.env["NTFY_PASSWORD"] ?? "";
  const topic = process.env["NTFY_TOPIC"] ?? "notifications";

  return {
    url,
    user,
    password,
    defaultTopic: topic,
    topics: [topic],
    topicGroups: {},
  };
}

/**
 * Resolves the active profile with the following precedence:
 *   1. Named profile from --server flag (if provided)
 *   2. Active profile from config file (if config is loaded)
 *   3. Environment variables (NTFY_URL / NTFY_USER / NTFY_PASSWORD / NTFY_TOPIC)
 *
 * Throws a descriptive error if no profile can be resolved.
 */
export function resolveProfile(
  config: Config | null,
  serverOverride?: string
): ServerProfile {
  // 1. Explicit --server override
  if (serverOverride !== undefined) {
    if (!config) {
      throw new Error(
        `--server "${serverOverride}" specified but no config file found. ` +
          `Run: ntfy config add <name> --url ... to create a profile.`
      );
    }
    const profile = config.profiles[serverOverride];
    if (!profile) {
      const names = Object.keys(config.profiles).join(", ") || "(none)";
      throw new Error(
        `Profile "${serverOverride}" not found. Available profiles: ${names}`
      );
    }
    return profile;
  }

  // 2. Config file active profile
  if (config !== null) {
    try {
      return getActiveProfile(config);
    } catch {
      // Fall through to env vars
    }
  }

  // 3. Environment variables
  const envProfile = getProfileFromEnv();
  if (envProfile !== null) {
    return envProfile;
  }

  throw new Error(
    "No profile configured. Options:\n" +
      "  1. Run: ntfy config add <name> --url <url> --user <user> --password <pass> --topic <topic>\n" +
      "  2. Set environment variables: NTFY_URL, NTFY_USER, NTFY_PASSWORD, NTFY_TOPIC"
  );
}
