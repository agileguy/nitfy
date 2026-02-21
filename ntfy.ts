/**
 * ntfy-cli - Main entry point
 * Usage: bun run ntfy.ts <command> [args]
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getFlag, hasFlag, getPositionals } from "./src/args.js";
import { fetchMessages, sendMessage, checkHealth } from "./src/api.js";
import type { NtfyMessage } from "./src/api.js";
import { noColor as _noColor, formatTime, displayMessages, displayUnreadSummary } from "./src/display.js";
import {
  loadConfig,
  saveConfig,
  resolveProfile,
  validateProfile,
  getActiveProfile,
} from "./src/config.js";
import type { ServerProfile, Config } from "./src/config.js";
import {
  loadState,
  saveState,
  getLastReadTime,
  setLastReadTime,
} from "./src/state.js";

// ---------------------------------------------------------------------------
// Env loader - scan ~/.claude/.env for NTFY_* variables
// ---------------------------------------------------------------------------
function loadEnvFile(): void {
  const envPath = join(homedir(), ".claude", ".env");
  if (!existsSync(envPath)) return;
  try {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
      // Only load NTFY_* vars and only if not already set
      if (key.startsWith("NTFY_") && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silently ignore env file errors
  }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------
function showHelp(): void {
  console.log(`ntfy-cli - ntfy push notification client

Usage:
  ntfy <command> [flags]

Commands:
  messages [--topic/-t <topic>] [--since/-s <since>] [--json]
      Fetch and display messages for a topic.

  all
      Alias: fetch messages for the FAST-all (or first configured) topic.

  unread [--topic <topic>] [--since <since>] [--json] [--count] [--total]
      Show unread messages across all watched topics since last read time.

  send <message> [--topic/-t <topic>] [--title <title>] [--priority/-p <prio>] [--tags <tags>]
      Send a notification message.

  read [--topic <topic>]
      Mark topic(s) as read (updates last-read timestamp).

  health [--json]
      Check server health and version.

  config add <name> --url <url> --user <user> --password <pass> --topic <topic>
      Add a new server profile.

  config remove <name>
      Remove a server profile.

  config list
      List all configured profiles.

  config use <name>
      Set the active profile.

  config show
      Show the active profile details (password masked).

Global Flags:
  --server <name>   Use a specific server profile.
  --json            Output raw JSON.
  --no-color        Disable colored output.
  --quiet           Suppress non-essential output.
  --help / -h       Show this help text.
`);
}

// ---------------------------------------------------------------------------
// Command: messages
// ---------------------------------------------------------------------------
async function cmdMessages(profile: ServerProfile, args: string[]): Promise<void> {
  const topic = getFlag(args, "--topic", "-t") ?? profile.defaultTopic;
  const since = getFlag(args, "--since", "-s") ?? "1h";
  const json = hasFlag(args, "--json");

  const messages = await fetchMessages(profile.url, profile.user, profile.password, topic, since);

  if (json) {
    console.log(JSON.stringify(messages, null, 2));
  } else {
    displayMessages(messages, topic);
  }
}

// ---------------------------------------------------------------------------
// Command: unread
// ---------------------------------------------------------------------------
async function cmdUnread(
  profile: ServerProfile,
  profileName: string,
  args: string[]
): Promise<void> {
  const topicArg = getFlag(args, "--topic");
  const since = getFlag(args, "--since");
  const json = hasFlag(args, "--json");
  const countOnly = hasFlag(args, "--count");
  const totalOnly = hasFlag(args, "--total");

  const state = loadState();

  // Determine topics to check
  const topics = topicArg ? [topicArg] : profile.topics;

  if (topics.length === 0) {
    console.error("No topics configured. Add topics to your profile or use --topic.");
    process.exit(1);
  }

  // Fetch all topics in parallel
  const results = await Promise.all(
    topics.map(async (topic) => {
      const lastRead = getLastReadTime(state, profileName, topic);
      // Use "since" override or last-read timestamp (converted to "Xs" format for the API)
      const sinceParam = since ?? (lastRead > 0 ? String(lastRead) : "1h");
      const messages = await fetchMessages(
        profile.url,
        profile.user,
        profile.password,
        topic,
        sinceParam
      );
      // Filter to only messages newer than last read time
      const unread = lastRead > 0
        ? messages.filter((m) => m.time > lastRead)
        : messages;
      return { topic, messages: unread };
    })
  );

  const totalCount = results.reduce((sum, r) => sum + r.messages.length, 0);

  if (totalOnly) {
    console.log(String(totalCount));
    return;
  }

  if (countOnly) {
    for (const r of results) {
      console.log(`${r.topic}: ${r.messages.length}`);
    }
    return;
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const sinceLabel = since ?? "last read";
  displayUnreadSummary(results, sinceLabel);
}

// ---------------------------------------------------------------------------
// Command: send
// ---------------------------------------------------------------------------
async function cmdSend(profile: ServerProfile, args: string[]): Promise<void> {
  const flagsWithValues = ["--topic", "-t", "--title", "--priority", "-p", "--tags"];
  const positionals = getPositionals(args, flagsWithValues);

  if (positionals.length === 0) {
    console.error("Error: message text is required. Usage: ntfy send <message>");
    process.exit(1);
  }

  const message = positionals.join(" ");
  const topic = getFlag(args, "--topic", "-t") ?? profile.defaultTopic;
  const title = getFlag(args, "--title");
  const priorityStr = getFlag(args, "--priority", "-p");
  const tags = getFlag(args, "--tags");

  const priority = priorityStr !== undefined ? parseInt(priorityStr, 10) : undefined;

  const result = await sendMessage(profile.url, profile.user, profile.password, topic, message, {
    title,
    priority,
    tags,
  });

  console.log(`Sent: ${result.id} to ${topic}`);
}

// ---------------------------------------------------------------------------
// Command: read (mark as read)
// ---------------------------------------------------------------------------
function cmdRead(profileName: string, profile: ServerProfile, args: string[]): void {
  const topicArg = getFlag(args, "--topic");
  const topics = topicArg ? [topicArg] : profile.topics;

  if (topics.length === 0) {
    console.error("No topics to mark as read.");
    process.exit(1);
  }

  let state = loadState();
  for (const topic of topics) {
    state = setLastReadTime(state, profileName, topic);
  }
  saveState(state);

  console.log(`Marked as read: ${topics.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Command: health
// ---------------------------------------------------------------------------
async function cmdHealth(profile: ServerProfile, args: string[]): Promise<void> {
  const json = hasFlag(args, "--json");
  const result = await checkHealth(profile.url, profile.user, profile.password);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.healthy) {
    const ver = result.version ? ` v${result.version}` : "";
    console.log(`Server is healthy${ver}: ${profile.url}`);
  } else {
    console.log(`Server appears unhealthy: ${profile.url}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command: config add
// ---------------------------------------------------------------------------
function cmdConfigAdd(args: string[]): void {
  const positionals = getPositionals(args, [
    "--url", "--user", "--password", "--topic", "--name",
  ]);
  const name = positionals[0] ?? getFlag(args, "--name");

  if (!name) {
    console.error("Error: profile name is required. Usage: ntfy config add <name> --url ...");
    process.exit(1);
  }

  const url = getFlag(args, "--url");
  const user = getFlag(args, "--user");
  const password = getFlag(args, "--password");
  const topic = getFlag(args, "--topic");

  const partial = { url, user, password, defaultTopic: topic };
  const errors = validateProfile(partial);
  if (errors.length > 0) {
    console.error("Validation errors:");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  const profile: ServerProfile = {
    url: url!,
    user: user!,
    password: password!,
    defaultTopic: topic!,
    topics: [topic!],
    topicGroups: {},
  };

  let config = loadConfig();
  if (config === null) {
    config = { activeProfile: name, profiles: {} };
  }

  config.profiles[name] = profile;
  saveConfig(config);

  console.log(`Profile "${name}" added.`);
  if (config.activeProfile === name) {
    console.log(`Set as active profile.`);
  }
}

// ---------------------------------------------------------------------------
// Command: config remove
// ---------------------------------------------------------------------------
function cmdConfigRemove(args: string[]): void {
  const positionals = getPositionals(args, []);
  const name = positionals[0];

  if (!name) {
    console.error("Error: profile name is required. Usage: ntfy config remove <name>");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config || !config.profiles[name]) {
    console.error(`Profile "${name}" not found.`);
    process.exit(1);
    return;
  }

  delete config.profiles[name];

  // If we removed the active profile, switch to another if available
  if (config.activeProfile === name) {
    const remaining = Object.keys(config.profiles);
    if (remaining.length > 0) {
      config.activeProfile = remaining[0]!;
      console.log(`Active profile switched to "${config.activeProfile}".`);
    } else {
      config.activeProfile = "";
    }
  }

  saveConfig(config);
  console.log(`Profile "${name}" removed.`);
}

// ---------------------------------------------------------------------------
// Command: config list
// ---------------------------------------------------------------------------
function cmdConfigList(): void {
  const config = loadConfig();
  if (config === null || Object.keys(config.profiles).length === 0) {
    console.log("No profiles configured.");
    return;
  }

  for (const [name, profile] of Object.entries(config.profiles)) {
    const active = name === config.activeProfile ? " (active)" : "";
    console.log(`  ${name}${active}`);
    console.log(`    url:   ${profile.url}`);
    console.log(`    user:  ${profile.user}`);
    console.log(`    topic: ${profile.defaultTopic}`);
  }
}

// ---------------------------------------------------------------------------
// Command: config use
// ---------------------------------------------------------------------------
function cmdConfigUse(args: string[]): void {
  const positionals = getPositionals(args, []);
  const name = positionals[0];

  if (!name) {
    console.error("Error: profile name is required. Usage: ntfy config use <name>");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config || !config.profiles[name]) {
    console.error(`Profile "${name}" not found.`);
    process.exit(1);
    return;
  }

  config.activeProfile = name;
  saveConfig(config);
  console.log(`Active profile set to "${name}".`);
}

// ---------------------------------------------------------------------------
// Command: config show
// ---------------------------------------------------------------------------
function cmdConfigShow(profile: ServerProfile): void {
  const masked = { ...profile, password: "***" };
  console.log(JSON.stringify(masked, null, 2));
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // Load env file for backward compat with NTFY_* env vars
  loadEnvFile();

  const rawArgs = process.argv.slice(2);

  // Global flags
  if (hasFlag(rawArgs, "--help", "-h") || rawArgs.length === 0) {
    showHelp();
    return;
  }

  const serverOverride = getFlag(rawArgs, "--server");
  const useJson = hasFlag(rawArgs, "--json");
  const noColorFlag = hasFlag(rawArgs, "--no-color");
  const quiet = hasFlag(rawArgs, "--quiet");

  // Apply no-color globally via the display module's exported variable
  if (noColorFlag) {
    // The display module exports `noColor` - set it via dynamic import trick
    // Since ES modules are live bindings we need to set it through the module
    (await import("./src/display.js")).noColor = true;
  }

  // Suppress unused variable warnings
  void useJson;
  void quiet;

  // Identify command (first non-flag token)
  const command = rawArgs.find((a) => !a.startsWith("-"));
  // Args after command name for command-specific parsing
  const commandArgs = command ? rawArgs.slice(rawArgs.indexOf(command) + 1) : [];

  // Config commands don't always need a profile
  if (command === "config") {
    const subcommand = commandArgs[0];
    const subArgs = commandArgs.slice(1);

    switch (subcommand) {
      case "add":
        cmdConfigAdd(subArgs);
        return;
      case "remove":
      case "rm":
        cmdConfigRemove(subArgs);
        return;
      case "list":
      case "ls":
        cmdConfigList();
        return;
      case "use":
        cmdConfigUse(subArgs);
        return;
      case "show": {
        const config = loadConfig();
        const profile = resolveProfile(config, serverOverride);
        cmdConfigShow(profile);
        return;
      }
      default:
        console.error(`Unknown config subcommand: "${subcommand ?? "(none)"}"`);
        console.error("Available: add, remove, list, use, show");
        process.exit(1);
    }
  }

  // All other commands need a profile
  const config = loadConfig();
  const profile = resolveProfile(config, serverOverride);

  // Determine profile name for state tracking
  let profileName = "default";
  if (config !== null) {
    if (serverOverride && config.profiles[serverOverride]) {
      profileName = serverOverride;
    } else {
      profileName = config.activeProfile;
    }
  }

  switch (command) {
    case "messages":
    case "msg":
      await cmdMessages(profile, commandArgs);
      break;

    case "all": {
      // Backward-compat alias: use FAST-all topic if available, else first topic
      const topic = profile.topics.includes("FAST-all")
        ? "FAST-all"
        : (profile.topics[0] ?? profile.defaultTopic);
      await cmdMessages(profile, ["--topic", topic, ...commandArgs]);
      break;
    }

    case "unread":
      await cmdUnread(profile, profileName, commandArgs);
      break;

    case "send":
      await cmdSend(profile, commandArgs);
      break;

    case "read":
      cmdRead(profileName, profile, commandArgs);
      break;

    case "health":
      await cmdHealth(profile, commandArgs);
      break;

    default:
      if (command) {
        console.error(`Unknown command: "${command}"`);
      }
      showHelp();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
});
