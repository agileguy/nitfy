/**
 * Watch mode for ntfy-cli.
 * Polls one or more topics on an interval and plays a sound on new messages.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ServerProfile } from "./config.js";
import type { NtfyMessage } from "./api.js";
import { fetchMessages } from "./api.js";
import { formatTimeShort, priorityBadge, formatTags } from "./display.js";

// ---------------------------------------------------------------------------
// ANSI constants (inline for watch output independence from display.ts state)
// ---------------------------------------------------------------------------
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

function c(code: string, text: string): string {
  return `${code}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Default sound path
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the bundled ping.aiff sound file.
 * Works both when running via `bun run ntfy.ts` (ESM) and compiled binary.
 */
export function defaultSoundPath(): string {
  // When compiled with bun build --compile, import.meta.url may not be file://
  // Fall back to process.execPath-based resolution in that case.
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return join(dirname(thisFile), "..", "sounds", "ping.aiff");
  } catch {
    return join(process.cwd(), "sounds", "ping.aiff");
  }
}

// ---------------------------------------------------------------------------
// Audio playback
// ---------------------------------------------------------------------------

export interface PlaySoundOptions {
  /** Optional audio output device (macOS AudioDeviceID or device name) */
  device?: string;
  /** If true, no audio is played at all */
  noSound?: boolean;
}

/**
 * Play an audio file using the platform-appropriate command.
 *
 * - macOS: uses `afplay` (built-in), with optional `-d <device>` flag.
 * - Linux: tries `play` (sox), then `paplay`, then warns and skips.
 *
 * Errors in audio playback are silently swallowed - a notification sound
 * failing should never crash the watch loop.
 */
export async function playSound(
  soundPath: string,
  options: PlaySoundOptions = {}
): Promise<void> {
  if (options.noSound) return;

  const platform = process.platform;

  if (platform === "darwin") {
    const cmd = ["afplay"];
    if (options.device) {
      cmd.push("-d", options.device);
    }
    cmd.push(soundPath);

    try {
      const proc = Bun.spawn(cmd, {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    } catch {
      // afplay not available or failed - silently skip
    }
    return;
  }

  // Linux fallback chain: try sox/play, then paplay, then warn
  if (platform === "linux") {
    const players = [
      ["play", soundPath],
      ["paplay", soundPath],
    ];

    for (const cmd of players) {
      try {
        const proc = Bun.spawn(cmd, {
          stdout: "ignore",
          stderr: "ignore",
        });
        const exitCode = await proc.exited;
        if (exitCode === 0) return;
      } catch {
        // Player not available, try next
        continue;
      }
    }

    // No player worked
    process.stderr.write(
      "Warning: no audio player found (tried: play, paplay). Install sox or pulseaudio-utils.\n"
    );
    return;
  }

  // Unsupported platform - silently skip
}

// ---------------------------------------------------------------------------
// Watch loop options
// ---------------------------------------------------------------------------

export interface WatchOptions {
  /** Polling interval in seconds (default: 10) */
  intervalSeconds?: number;
  /** Skip audio playback entirely */
  noSound?: boolean;
  /** Audio device to pass to the player */
  device?: string;
  /** Minimum priority level (1-5) to trigger audio */
  priorityThreshold?: number;
  /** Path to the sound file */
  soundPath?: string;
  /** AbortSignal to stop the watch loop cleanly (used in tests) */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Pure detection logic (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Given an array of messages and a "last seen" timestamp,
 * returns only the messages that are strictly newer than lastSeenTime.
 * Sorted by time ascending.
 *
 * This is the core new-message detection logic extracted for testability.
 */
export function filterNewMessages(
  messages: NtfyMessage[],
  lastSeenTime: number
): NtfyMessage[] {
  const newer = messages.filter((m) => m.time > lastSeenTime);
  newer.sort((a, b) => a.time - b.time);
  return newer;
}

/**
 * Returns true if any message in the array meets or exceeds the priority threshold.
 * Messages with no priority field default to 3 (ntfy standard default).
 */
export function shouldTriggerSound(
  messages: NtfyMessage[],
  priorityThreshold: number
): boolean {
  return messages.some((m) => (m.priority ?? 3) >= priorityThreshold);
}

// ---------------------------------------------------------------------------
// Message formatting for watch output
// ---------------------------------------------------------------------------

/**
 * Format a single message for watch mode output.
 * Prefixes each message with a timestamp and topic label.
 */
function formatWatchMessage(msg: NtfyMessage, topic: string): string {
  const time = c(DIM, formatTimeShort(msg.time));
  const topicLabel = c(CYAN, `[${topic}]`);
  const badge = priorityBadge(msg.priority);
  const tags = formatTags(msg.tags);

  const headerParts = [time, topicLabel, badge, tags].filter(Boolean).join(" ");

  const lines: string[] = [headerParts];

  if (msg.title) {
    lines.push(c(BOLD, msg.title));
  }

  const body = msg.message ?? "";
  if (body) {
    lines.push(body);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Watch loop
// ---------------------------------------------------------------------------

/**
 * Run the watch loop, polling topics every `intervalSeconds` seconds.
 *
 * Tracks the highest message timestamp seen per topic to detect new messages
 * on subsequent polls. Prints new messages to stdout and plays audio.
 *
 * Installs a SIGINT handler to print a session summary on Ctrl+C.
 */
export async function watchLoop(
  profile: ServerProfile,
  topics: string[],
  options: WatchOptions = {}
): Promise<void> {
  const intervalSeconds = options.intervalSeconds ?? 10;
  const soundPath = options.soundPath ?? defaultSoundPath();

  // Per-topic tracking: last seen message timestamp (Unix seconds)
  const lastSeenTime: Map<string, number> = new Map();

  // Session counters
  const messageCounts: Map<string, number> = new Map();
  const startTime = Date.now();

  // Initialize lastSeenTime to "now" so we only show messages arriving
  // after the watch session starts.
  const startUnix = Math.floor(startTime / 1000);
  for (const topic of topics) {
    lastSeenTime.set(topic, startUnix);
    messageCounts.set(topic, 0);
  }

  // SIGINT handler - print session summary and exit cleanly
  process.on("SIGINT", () => {
    const durationMs = Date.now() - startTime;
    const durationSec = Math.floor(durationMs / 1000);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    const totalMessages = Array.from(messageCounts.values()).reduce(
      (sum, n) => sum + n,
      0
    );

    process.stdout.write("\n");
    process.stdout.write(c(BOLD, "Watch session ended\n"));
    process.stdout.write(
      c(DIM, `Duration: ${durationStr}\n`)
    );
    process.stdout.write(
      c(DIM, `Topics watched: ${topics.join(", ")}\n`)
    );
    process.stdout.write(
      c(DIM, `Messages seen: ${totalMessages}\n`)
    );

    for (const [topic, count] of messageCounts.entries()) {
      if (count > 0) {
        process.stdout.write(
          `  ${c(CYAN, topic)}: ${c(GREEN, String(count))} message${count !== 1 ? "s" : ""}\n`
        );
      }
    }

    process.exit(0);
  });

  // Print startup banner
  process.stdout.write(
    `\n${c(BOLD + CYAN, "ntfy watch")} ${c(DIM, `— polling every ${intervalSeconds}s`)}\n`
  );
  process.stdout.write(
    `${c(DIM, `Topics: ${topics.join(", ")}`)}\n`
  );
  process.stdout.write(
    `${c(DIM, `Sound: ${options.noSound ? "disabled" : soundPath}`)}\n\n`
  );
  process.stdout.write(
    `${c(DIM, "Press Ctrl+C to stop and see session summary.")}\n\n`
  );

  const signal = options.signal;

  // Main polling loop
  while (true) {
    // Check abort signal before each poll cycle
    if (signal?.aborted) break;

    for (const topic of topics) {
      // Check abort signal between topics too
      if (signal?.aborted) break;

      try {
        const lastTime = lastSeenTime.get(topic) ?? startUnix;
        // Fetch messages since the last time we saw a message for this topic
        const messages = await fetchMessages(
          profile.url,
          profile.user,
          profile.password,
          topic,
          String(lastTime)
        );

        // Filter to messages strictly newer than what we've already seen
        const newMessages = filterNewMessages(messages, lastTime);

        if (newMessages.length === 0) continue;

        // Update last seen time to the newest message
        const newestTime = newMessages[newMessages.length - 1]!.time;
        lastSeenTime.set(topic, newestTime);

        // Count messages
        const prevCount = messageCounts.get(topic) ?? 0;
        messageCounts.set(topic, prevCount + newMessages.length);

        // Display new messages
        for (const msg of newMessages) {
          process.stdout.write(formatWatchMessage(msg, topic) + "\n\n");
        }

        // Play sound for new messages that meet the priority threshold
        const threshold = options.priorityThreshold ?? 1;
        if (shouldTriggerSound(newMessages, threshold)) {
          await playSound(soundPath, {
            noSound: options.noSound,
            device: options.device,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `${c(YELLOW, `[${topic}]`)} fetch error: ${msg}\n`
        );
      }
    }

    // Check abort before sleeping
    if (signal?.aborted) break;

    // Wait for the next poll interval
    await sleep(intervalSeconds * 1000);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
