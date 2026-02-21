/**
 * ntfy-cli - Main entry point
 * Usage: bun run ntfy.ts <command> [args]
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getFlag, hasFlag, getPositionals } from "./src/args.js";
import { fetchMessages, sendMessage, checkHealth, deleteMessage, authHeader } from "./src/api.js";
import type { NtfyMessage } from "./src/api.js";
import {
  setNoColor,
  setQuiet,
  quietMode,
  displayMessages,
  displayUnreadSummary,
  displayConfigList,
} from "./src/display.js";
import {
  loadConfig,
  saveConfig,
  resolveProfile,
  validateProfile,
} from "./src/config.js";
import type { ServerProfile, Config } from "./src/config.js";
import {
  loadState,
  saveState,
  getLastReadTime,
  setLastReadTime,
} from "./src/state.js";
import { watchLoop, defaultSoundPath } from "./src/watch.js";
import {
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
} from "./src/completions.js";

// ---------------------------------------------------------------------------
// Version constant
// ---------------------------------------------------------------------------
const VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Priority name map: ntfy levels 1=min, 2=low, 3=default, 4=high, 5=urgent
// SRD §9.5: aliases minimum→1, normal→3, maximum→5 are also supported.
// ---------------------------------------------------------------------------
const PRIORITY_NAMES: Record<string, number> = {
  min: 1,
  minimum: 1,
  low: 2,
  default: 3,
  normal: 3,
  high: 4,
  urgent: 5,
  max: 5,
  maximum: 5,
};

/**
 * Parse a priority input string to a number (1–5).
 * Accepts numeric strings ("1"–"5") or named levels
 * ("min", "low", "default", "high", "urgent", "max").
 * Returns undefined if the input is not recognised.
 */
export function parsePriority(input: string): number | undefined {
  const lower = input.trim().toLowerCase();
  if (lower in PRIORITY_NAMES) {
    return PRIORITY_NAMES[lower];
  }
  const n = parseInt(lower, 10);
  if (!isNaN(n) && n >= 1 && n <= 5) {
    return n;
  }
  return undefined;
}

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
  messages [--topic/-t <topic>] [--since/-s <since>] [--priority <level>] [--limit <n>] [--json]
      Fetch and display messages for a topic.
      --priority: filter to messages at or above this level (1-5 or min/low/default/high/urgent)
      --limit: show only the last N messages after filtering

  all
      Alias: fetch messages for the FAST-all (or first configured) topic.

  unread [--topic <topic>] [--since <since>] [--json] [--count] [--total]
      Show unread messages across all watched topics since last read time.

  send <message> [--topic/-t <topic>] [--title <title>] [--priority/-p <prio>] [--tags <tags>]
      Send a notification message.

  read [--topic <topic>]
      Mark topic(s) as read (updates last-read timestamp).

  delete <message-id> [--topic/-t <topic>]
      Attempt to delete a message by sending DELETE to its message URL.

  watch [--topic/-t <topic>] [--group <group>] [--interval <seconds>] [--no-sound] [--sound <path>] [--device <device>] [--priority <level>]
      Watch topic(s) for new messages in real time, polling every N seconds (default 60).
      Plays an audio ping on new messages. Ctrl+C prints a session summary.

  health [--json] [--all]
      Check server health and version.
      --all: check all configured profiles in parallel (non-zero exit if any unhealthy)

  version
      Print the nitfy version.

  topics list [--json]
      List watched topics and groups for the active profile.

  topics add <topic>
      Add a topic to the active profile's watch list.

  topics remove <topic>
      Remove a topic from the watch list (cannot remove defaultTopic).

  topics group add <group-name> <topic1> [topic2...]
      Create or update a named topic group.

  topics group remove <group-name>
      Delete a named topic group.

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
  const since = getFlag(args, "--since", "-s") ?? "12h";
  const json = hasFlag(args, "--json");
  const priorityStr = getFlag(args, "--priority");
  const limitStr = getFlag(args, "--limit");

  let messages = await fetchMessages(profile.url, profile.user, profile.password, topic, since);

  // Apply --priority filter (client-side)
  if (priorityStr !== undefined) {
    const minPriority = parsePriority(priorityStr);
    if (minPriority === undefined) {
      console.error(
        `Error: invalid --priority "${priorityStr}". Use 1-5 or: min, low, default, high, urgent`
      );
      process.exit(2);
    }
    // Messages with no priority field default to 3 (ntfy standard default priority)
    messages = messages.filter((m) => (m.priority ?? 3) >= minPriority);
  }

  // Apply --limit filter (take last N).
  // ntfy returns messages oldest-first, so slice(-n) correctly returns the
  // most recent N messages while preserving chronological display order.
  if (limitStr !== undefined) {
    const n = parseInt(limitStr, 10);
    if (isNaN(n) || n < 1) {
      console.error(`Error: --limit must be a positive integer, got: "${limitStr}"`);
      process.exit(2);
    }
    messages = messages.slice(-n);
  }

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
    if (topicArg) {
      // Single topic: output just the integer count
      console.log(String(results[0]?.messages.length ?? 0));
    } else {
      // No topic: sum all topics and output a plain integer (same as --total)
      console.log(String(totalCount));
    }
    return;
  }

  if (json) {
    // Compute the earliest sinceTimestamp across topics (use already-loaded state)
    const sinceTimestamp = topics.reduce((earliest, topic) => {
      const lastRead = getLastReadTime(state, profileName, topic);
      return lastRead > 0 && (earliest === 0 || lastRead < earliest) ? lastRead : earliest;
    }, 0);

    const output = {
      profileName,
      sinceTimestamp: sinceTimestamp > 0 ? sinceTimestamp : Math.floor(Date.now() / 1000),
      total: totalCount,
      topics: results.map((r) => ({
        topic: r.topic,
        count: r.messages.length,
        messages: r.messages,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const sinceLabel = since ?? "last read";
  displayUnreadSummary(results, sinceLabel);
}

// ---------------------------------------------------------------------------
// Command: send
// ---------------------------------------------------------------------------
async function cmdSend(profile: ServerProfile, args: string[]): Promise<void> {
  const flagsWithValues = [
    "--topic", "-t",
    "--title",
    "--priority", "-p",
    "--tags",
    "--delay",
    "--click",
    "--attach",
  ];
  const positionals = getPositionals(args, flagsWithValues);

  if (positionals.length === 0) {
    console.error("Error: message text is required. Usage: ntfy send <message>");
    process.exit(2);
  }

  const message = positionals.join(" ");
  const topic = getFlag(args, "--topic", "-t") ?? profile.defaultTopic;
  const title = getFlag(args, "--title");
  const priorityStr = getFlag(args, "--priority", "-p");
  const tags = getFlag(args, "--tags");
  const delay = getFlag(args, "--delay");
  const click = getFlag(args, "--click");
  const attach = getFlag(args, "--attach");
  const markdown = hasFlag(args, "--markdown") || hasFlag(args, "--md");

  const priority = priorityStr !== undefined ? parsePriority(priorityStr) : undefined;
  if (priorityStr !== undefined && priority === undefined) {
    console.error(`Error: invalid --priority "${priorityStr}". Use 1-5 or: min, low, default, high, urgent`);
    process.exit(2);
  }

  const json = hasFlag(args, "--json");

  const result = await sendMessage(profile.url, profile.user, profile.password, topic, message, {
    title,
    priority,
    tags,
    delay,
    click,
    attach,
    markdown,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!quietMode) {
    // Truncate message ID to 8 chars in display; full ID is available in --json output
    const displayId = result.id.slice(0, 8);
    console.log(`Sent: ${displayId} to ${topic}`);
  }
}

// ---------------------------------------------------------------------------
// Command: read (mark as read)
// ---------------------------------------------------------------------------
function cmdRead(
  profileName: string,
  profile: ServerProfile,
  args: string[],
  config: ReturnType<typeof loadConfig>
): void {
  const topicArg = getFlag(args, "--topic");
  const allFlag = hasFlag(args, "--all");

  // --all: mark all topics on ALL profiles as read
  if (allFlag) {
    if (!config) {
      console.error("No config found. Cannot mark all topics as read.");
      process.exit(1);
      return;
    }

    let state = loadState();
    let totalTopics = 0;
    const profileCount = Object.keys(config.profiles).length;

    for (const [pName, pProfile] of Object.entries(config.profiles)) {
      for (const topic of pProfile.topics) {
        state = setLastReadTime(state, pName, topic);
        totalTopics++;
      }
    }
    saveState(state);

    if (!quietMode) {
      console.log(`Marked ${totalTopics} topics as read across ${profileCount} profiles`);
    }
    return;
  }

  // --topic <t>: mark only the specified topic as read
  if (topicArg) {
    let state = loadState();
    state = setLastReadTime(state, profileName, topicArg);
    saveState(state);

    if (!quietMode) {
      console.log(`Marked ${topicArg} as read`);
    }
    return;
  }

  // Default: mark all topics in the current profile as read
  const topics = profile.topics;

  if (topics.length === 0) {
    console.error("No topics to mark as read.");
    process.exit(1);
  }

  let state = loadState();
  for (const topic of topics) {
    state = setLastReadTime(state, profileName, topic);
  }
  saveState(state);

  if (!quietMode) {
    console.log(`Marked as read: ${topics.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Command: health
// ---------------------------------------------------------------------------
async function cmdHealth(
  profile: ServerProfile,
  args: string[],
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  const json = hasFlag(args, "--json");
  const allFlag = hasFlag(args, "--all");

  // --all with no config is an error
  if (allFlag && config === null) {
    console.error("Error: --all requires a config file with named profiles.");
    process.exit(2);
  }

  // --all: check all profiles in parallel
  if (allFlag && config !== null) {
    const profileEntries = Object.entries(config.profiles);

    const results = await Promise.all(
      profileEntries.map(async ([name, p]) => {
        try {
          const health = await checkHealth(p.url, p.user, p.password);
          return {
            profile: name,
            url: p.url,
            healthy: health.healthy,
            version: health.version,
          };
        } catch (err: unknown) {
          return {
            profile: name,
            url: p.url,
            healthy: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    const anyUnhealthy = results.some((r) => !r.healthy);

    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        const status = r.healthy ? "healthy" : "UNHEALTHY";
        const ver = r.version ? ` v${r.version}` : "";
        const errorStr = r.error ? ` (${r.error})` : "";
        console.log(`${r.profile}: ${status}${ver} — ${r.url}${errorStr}`);
      }
    }

    if (anyUnhealthy) {
      process.exit(1);
    }
    return;
  }

  // Single profile health check
  const result = await checkHealth(profile.url, profile.user, profile.password);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.healthy) {
    const ver = result.version ? ` v${result.version}` : "";
    console.log(`Server is healthy${ver}: ${profile.url}`);
  } else {
    console.error(`Server appears unhealthy: ${profile.url}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command: watch
// ---------------------------------------------------------------------------
async function cmdWatch(
  profile: ServerProfile,
  profileName: string,
  args: string[]
): Promise<void> {
  const flagsWithValues = [
    "--topic", "-t",
    "--group",
    "--interval",
    "--device",
    "--priority",
    "--sound",
  ];
  const topicArg = getFlag(args, "--topic", "-t");
  const groupArg = getFlag(args, "--group");
  const intervalStr = getFlag(args, "--interval");
  const noSound = hasFlag(args, "--no-sound");
  const device = getFlag(args, "--device");
  const priorityStr = getFlag(args, "--priority");
  const soundPath = getFlag(args, "--sound") ?? defaultSoundPath();

  // Resolve topics to watch
  let topics: string[] = [];

  if (topicArg) {
    topics = [topicArg];
  } else if (groupArg) {
    const group = profile.topicGroups[groupArg];
    if (!group || group.length === 0) {
      console.error(`Error: group "${groupArg}" not found in active profile.`);
      process.exit(1);
    }
    topics = group;
  } else if (profile.topics.length > 0) {
    // Default: watch all configured topics
    topics = profile.topics;
  } else {
    // Fall back to default topic
    topics = [profile.defaultTopic];
  }

  // Parse interval
  let intervalSeconds = 60;
  if (intervalStr !== undefined) {
    const n = parseInt(intervalStr, 10);
    if (isNaN(n) || n < 1) {
      console.error(`Error: --interval must be a positive integer, got: "${intervalStr}"`);
      process.exit(2);
    }
    intervalSeconds = n;
  }

  // Parse priority threshold
  let priorityThreshold: number | undefined;
  if (priorityStr !== undefined) {
    priorityThreshold = parsePriority(priorityStr);
    if (priorityThreshold === undefined) {
      console.error(`Error: invalid --priority "${priorityStr}". Use 1-5 or: min, low, default, high, urgent`);
      process.exit(2);
    }
  }

  await watchLoop(profile, topics, {
    intervalSeconds,
    noSound,
    device,
    priorityThreshold,
    soundPath,
    profileName,
  });
}

// ---------------------------------------------------------------------------
// Command: version
// ---------------------------------------------------------------------------
function cmdVersion(): void {
  console.log(`nitfy v${VERSION}`);
}

// ---------------------------------------------------------------------------
// Command: delete
// ---------------------------------------------------------------------------
async function cmdDelete(profile: ServerProfile, args: string[]): Promise<void> {
  // --topic is accepted for backward compatibility but not used in the URL;
  // ntfy message IDs are globally unique and the API route is DELETE /v1/messages/<id>.
  const flagsWithValues = ["--topic", "-t"];
  const positionals = getPositionals(args, flagsWithValues);
  const messageId = positionals[0];

  if (!messageId) {
    console.error("Error: message ID is required. Usage: ntfy delete <message-id> [--topic/-t <topic>]");
    process.exit(2);
  }

  try {
    await deleteMessage(profile.url, profile.user, profile.password, messageId);

    if (!quietMode) {
      // Truncate message ID to 8 chars in display; full IDs are available in --json output
      const displayId = messageId.slice(0, 8);
      console.log(`Message "${displayId}" deleted.`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command: topics list
// ---------------------------------------------------------------------------
function cmdTopicsList(
  profile: ServerProfile,
  profileName: string,
  args: string[]
): void {
  const json = hasFlag(args, "--json");

  if (json) {
    console.log(
      JSON.stringify(
        { topics: profile.topics, defaultTopic: profile.defaultTopic, topicGroups: profile.topicGroups },
        null,
        2
      )
    );
    return;
  }

  // Quiet mode: output one topic name per line, no decorations
  if (quietMode) {
    for (const t of profile.topics) {
      console.log(t);
    }
    return;
  }

  const url = profile.url;
  console.log(`Topics for ${profileName} (${url}):`);

  if (profile.topics.length === 0) {
    console.log("  (none)");
  } else {
    for (const t of profile.topics) {
      const defaultMarker = t === profile.defaultTopic ? "  [default]" : "";
      console.log(`  ${t}${defaultMarker}`);
    }
  }

  const groups = profile.topicGroups;
  const groupNames = Object.keys(groups);
  if (groupNames.length > 0) {
    console.log("\nGroups:");
    for (const name of groupNames) {
      const members = (groups[name] ?? []).join(", ");
      console.log(`  ${name}  -> ${members}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Command: topics add
// ---------------------------------------------------------------------------
function cmdTopicsAdd(
  config: Config,
  profileName: string,
  args: string[]
): void {
  const positionals = getPositionals(args, []);
  const topic = positionals[0];

  if (!topic) {
    console.error("Error: topic name is required. Usage: ntfy topics add <topic>");
    process.exit(2);
  }

  const profile = config.profiles[profileName]!;

  if (profile.topics.includes(topic)) {
    if (!quietMode) {
      console.log(`Topic "${topic}" is already in profile "${profileName}".`);
    }
    return;
  }

  profile.topics = [...profile.topics, topic];
  saveConfig(config);
  if (!quietMode) {
    console.log(`Topic "${topic}" added to profile "${profileName}".`);
  }
}

// ---------------------------------------------------------------------------
// Command: topics remove
// ---------------------------------------------------------------------------
function cmdTopicsRemove(
  config: Config,
  profileName: string,
  args: string[]
): void {
  const positionals = getPositionals(args, []);
  const topic = positionals[0];

  if (!topic) {
    console.error("Error: topic name is required. Usage: ntfy topics remove <topic>");
    process.exit(2);
  }

  const profile = config.profiles[profileName]!;

  if (topic === profile.defaultTopic) {
    console.error(
      `Error: cannot remove "${topic}" because it is the default topic. ` +
        `To remove it, first change the default topic with: ntfy config add`
    );
    process.exit(1);
  }

  if (!profile.topics.includes(topic)) {
    console.error(`Error: topic "${topic}" is not in profile "${profileName}".`);
    process.exit(1);
  }

  // Remove from topics array
  profile.topics = profile.topics.filter((t) => t !== topic);

  // Remove from any topic groups that reference it
  for (const groupName of Object.keys(profile.topicGroups)) {
    const members = profile.topicGroups[groupName];
    if (members) {
      profile.topicGroups[groupName] = members.filter((t) => t !== topic);
    }
  }

  saveConfig(config);

  // Clean up state.json entries for this topic
  const state = loadState();
  const key = `${profileName}/${topic}`;
  const cleanedTopics = { ...state.topics };
  delete cleanedTopics[key];
  saveState({ ...state, topics: cleanedTopics });

  if (!quietMode) {
    console.log(`Topic "${topic}" removed from profile "${profileName}".`);
  }
}

// ---------------------------------------------------------------------------
// Command: topics group add
// ---------------------------------------------------------------------------
function cmdTopicsGroupAdd(
  config: Config,
  profileName: string,
  args: string[]
): void {
  const positionals = getPositionals(args, []);
  const groupName = positionals[0];
  const topicArgs = positionals.slice(1);

  if (!groupName) {
    console.error("Error: group name is required. Usage: ntfy topics group add <group-name> <topic1> [topic2...]");
    process.exit(2);
  }

  if (topicArgs.length === 0) {
    console.error("Error: at least one topic is required.");
    process.exit(2);
  }

  const profile = config.profiles[profileName]!;

  // Validate that all topics are in the watched list
  const unknownTopics = topicArgs.filter((t) => !profile.topics.includes(t));
  if (unknownTopics.length > 0) {
    console.error(
      `Error: the following topics are not in the watched list: ${unknownTopics.join(", ")}. ` +
        `Add them first with: ntfy topics add <topic>`
    );
    process.exit(1);
  }

  profile.topicGroups = { ...profile.topicGroups, [groupName]: topicArgs };
  saveConfig(config);
  if (!quietMode) {
    console.log(`Group "${groupName}" set to: ${topicArgs.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Command: topics group remove
// ---------------------------------------------------------------------------
function cmdTopicsGroupRemove(
  config: Config,
  profileName: string,
  args: string[]
): void {
  const positionals = getPositionals(args, []);
  const groupName = positionals[0];

  if (!groupName) {
    console.error("Error: group name is required. Usage: ntfy topics group remove <group-name>");
    process.exit(2);
  }

  const profile = config.profiles[profileName]!;

  if (!(groupName in profile.topicGroups)) {
    console.error(`Error: group "${groupName}" does not exist in profile "${profileName}".`);
    process.exit(1);
  }

  const updatedGroups = { ...profile.topicGroups };
  delete updatedGroups[groupName];
  profile.topicGroups = updatedGroups;
  saveConfig(config);
  if (!quietMode) {
    console.log(`Group "${groupName}" removed from profile "${profileName}".`);
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
    process.exit(2);
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
    process.exit(2);
  }

  const profile: ServerProfile = {
    url: url!,
    user: user ?? "",
    password: password ?? "",
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

  console.log(`Profile "${name}" saved. Run: ntfy config use ${name}`);
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
    process.exit(2);
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

  // Clean up all state keys for this profile
  const state = loadState();
  const prefix = `${name}/`;
  const cleanedTopics: typeof state.topics = {};
  for (const [key, value] of Object.entries(state.topics)) {
    if (!key.startsWith(prefix)) {
      cleanedTopics[key] = value;
    }
  }
  saveState({ ...state, topics: cleanedTopics });

  console.log(`Profile "${name}" removed.`);
}

// ---------------------------------------------------------------------------
// Command: config list
// ---------------------------------------------------------------------------
function cmdConfigList(args: string[]): void {
  const json = hasFlag(args, "--json");
  const config = loadConfig();
  if (config === null || Object.keys(config.profiles).length === 0) {
    if (json) {
      console.log(JSON.stringify({ active: "", profiles: [] }, null, 2));
    } else {
      console.log("No profiles configured.");
    }
    return;
  }

  const profiles = Object.entries(config.profiles).map(([name, profile]) => ({
    name,
    url: profile.url,
    user: profile.user || "",
    topicCount: profile.topics.length,
  }));

  if (json) {
    // Passwords are NEVER included in JSON output
    console.log(
      JSON.stringify(
        {
          active: config.activeProfile,
          profiles,
        },
        null,
        2
      )
    );
    return;
  }

  // Human-readable SRD format
  displayConfigList({
    active: config.activeProfile,
    profiles,
  });
}

// ---------------------------------------------------------------------------
// Command: config use
// ---------------------------------------------------------------------------
function cmdConfigUse(args: string[]): void {
  const positionals = getPositionals(args, []);
  const name = positionals[0];

  if (!name) {
    console.error("Error: profile name is required. Usage: ntfy config use <name>");
    process.exit(2);
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
// Command: completions
// ---------------------------------------------------------------------------
function cmdCompletions(args: string[]): void {
  // The completions command doesn't need an active profile;
  // we load config only to embed dynamic profile/topic names.
  const shell = args[0];
  const config = loadConfig();

  switch (shell) {
    case "bash":
      process.stdout.write(generateBashCompletions(config));
      break;
    case "zsh":
      process.stdout.write(generateZshCompletions(config));
      break;
    case "fish":
      process.stdout.write(generateFishCompletions(config));
      break;
    default:
      console.error(
        `Error: unknown shell "${shell ?? "(none)"}". ` +
          `Supported shells: bash, zsh, fish`
      );
      console.error("Usage: ntfy completions <bash|zsh|fish>");
      process.exit(2);
  }
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
  const noColorFlag = hasFlag(rawArgs, "--no-color");
  const quietFlag = hasFlag(rawArgs, "--quiet", "-q");

  // Apply no-color globally via the display module setter
  if (noColorFlag) {
    setNoColor(true);
  }

  // Apply quiet mode globally
  if (quietFlag) {
    setQuiet(true);
  }

  // Identify command (first non-flag token), skipping global flags that consume a value.
  // This prevents flag values (e.g. `ntfy --server myserver messages`) from being
  // mistakenly identified as the command name.
  const GLOBAL_FLAGS_WITH_VALUES = ["--server"];
  let commandIdx = -1;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (GLOBAL_FLAGS_WITH_VALUES.includes(arg!)) {
      i++; // skip the value argument
      continue;
    }
    if (arg!.startsWith("-")) continue;
    commandIdx = i;
    break;
  }
  const command = commandIdx >= 0 ? rawArgs[commandIdx] : undefined;
  const commandArgs = commandIdx >= 0 ? rawArgs.slice(commandIdx + 1) : [];

  // Completions command doesn't need a profile
  if (command === "completions") {
    cmdCompletions(commandArgs);
    return;
  }

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
        cmdConfigList(subArgs);
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
        process.exit(2);
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
      cmdRead(profileName, profile, commandArgs, config);
      break;

    case "health":
      await cmdHealth(profile, commandArgs, config);
      break;

    case "watch":
      await cmdWatch(profile, profileName, commandArgs);
      break;

    case "delete":
      await cmdDelete(profile, commandArgs);
      break;

    case "version":
      cmdVersion();
      break;

    case "topics": {
      const subcommand = commandArgs[0];
      const subArgs = commandArgs.slice(1);

      // topics group is a nested sub-command
      if (subcommand === "group") {
        const groupSub = subArgs[0];
        const groupArgs = subArgs.slice(1);

        switch (groupSub) {
          case "add":
            if (!config) {
              console.error("Error: no config found. Create a profile first.");
              process.exit(1);
            }
            cmdTopicsGroupAdd(config, profileName, groupArgs);
            break;
          case "remove":
          case "rm":
            if (!config) {
              console.error("Error: no config found. Create a profile first.");
              process.exit(1);
            }
            cmdTopicsGroupRemove(config, profileName, groupArgs);
            break;
          default:
            console.error(`Unknown topics group subcommand: "${groupSub ?? "(none)"}"`);
            console.error("Available: add, remove");
            process.exit(2);
        }
        break;
      }

      switch (subcommand) {
        case "list":
        case "ls":
          cmdTopicsList(profile, profileName, subArgs);
          break;
        case "add":
          if (!config) {
            console.error("Error: no config found. Create a profile first.");
            process.exit(1);
          }
          cmdTopicsAdd(config, profileName, subArgs);
          break;
        case "remove":
        case "rm":
          if (!config) {
            console.error("Error: no config found. Create a profile first.");
            process.exit(1);
          }
          cmdTopicsRemove(config, profileName, subArgs);
          break;
        default:
          console.error(`Unknown topics subcommand: "${subcommand ?? "(none)"}"`);
          console.error("Available: list, add, remove, group");
          process.exit(2);
      }
      break;
    }

    default:
      if (command) {
        console.error(`Unknown command: "${command}"`);
      }
      showHelp();
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  // When --json is a global flag and an error occurs, output structured JSON to
  // stdout so that callers using --json always get machine-parseable output.
  // Otherwise fall back to plain text on stderr.
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ error: msg }));
  } else {
    console.error(`Error: ${msg}`);
  }
  process.exit(1);
});
