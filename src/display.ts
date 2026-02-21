/**
 * Terminal formatting utilities for nitfy CLI.
 * Zero dependencies - inline ANSI codes only, no chalk.
 */

import type { NtfyMessage } from "./api.js";

// ---------------------------------------------------------------------------
// ANSI constants
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";
const WHITE = "\x1b[37m";

/**
 * Whether to strip all ANSI codes from output.
 * Auto-detected at module load from NO_COLOR env var and TTY status.
 * Use setNoColor() to override programmatically (e.g. from --no-color flag).
 */
let noColor: boolean =
  process.env["NO_COLOR"] !== undefined || !process.stdout.isTTY;

/**
 * Override the noColor setting programmatically.
 */
export function setNoColor(v: boolean): void {
  noColor = v;
}

function c(code: string, text: string): string {
  if (noColor) return text;
  return `${code}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/**
 * Human-readable relative label for a Unix timestamp.
 * e.g. "2m ago", "3h ago", "yesterday"
 */
function relativeTime(unix: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - unix;

  if (diffSec < 10) return "just now";
  if (diffSec < MINUTE) return `${diffSec}s ago`;
  if (diffSec < HOUR) return `${Math.floor(diffSec / MINUTE)}m ago`;
  if (diffSec < DAY) return `${Math.floor(diffSec / HOUR)}h ago`;
  if (diffSec < DAY * 2) return "yesterday";
  return `${Math.floor(diffSec / DAY)}d ago`;
}

/**
 * Format a Unix timestamp as "YYYY-MM-DD HH:MM (Xm ago)".
 */
export function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  const date = d.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = d.toTimeString().slice(0, 5); // HH:MM
  return `${date} ${time} (${relativeTime(unix)})`;
}

/**
 * Format a Unix timestamp as "HH:MM" only.
 */
export function formatTimeShort(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toTimeString().slice(0, 5);
}

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------

// ntfy priority levels: 1=min, 2=low, 3=default, 4=high, 5=max/urgent
const PRIORITY_LABELS: Record<number, string> = {
  1: "min",
  2: "low",
  4: "high",
  5: "urgent",
};

const PRIORITY_COLORS: Record<number, string> = {
  1: GRAY,
  2: CYAN,
  3: WHITE,
  4: YELLOW,
  5: RED,
};

/**
 * Return a colored priority badge like "[urgent]", or empty string for default (3).
 */
export function priorityBadge(p: number | undefined): string {
  if (p === undefined || p === 3) return "";
  const label = PRIORITY_LABELS[p] ?? `p${p}`;
  const color = PRIORITY_COLORS[p] ?? WHITE;
  return c(color, `[${label}]`);
}

// ---------------------------------------------------------------------------
// Tag formatting
// ---------------------------------------------------------------------------

/**
 * Format a tags array as "#tag1 #tag2" (dimmed).
 * Returns empty string for undefined or empty arrays.
 */
export function formatTags(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) return "";
  return c(DIM, tags.map((t) => `#${t}`).join(" "));
}

// ---------------------------------------------------------------------------
// Full message display
// ---------------------------------------------------------------------------

/**
 * Render a separator line.
 */
function separator(): void {
  process.stdout.write(c(DIM, "─".repeat(60)) + "\n");
}

/**
 * Display a formatted list of messages for a given topic.
 */
export function displayMessages(
  messages: NtfyMessage[],
  topicLabel: string
): void {
  if (messages.length === 0) {
    process.stdout.write(
      c(DIM, `No messages found for topic ${topicLabel}\n`)
    );
    return;
  }

  process.stdout.write(
    `\n${c(BOLD + CYAN, topicLabel)} ${c(DIM, `(${messages.length} message${messages.length !== 1 ? "s" : ""})`)}\n`
  );
  separator();

  for (const msg of messages) {
    const time = c(DIM, formatTime(msg.time));
    const badge = priorityBadge(msg.priority);
    const tags = formatTags(msg.tags);

    // Header line: time  [priority]  #tags
    const headerParts = [time, badge, tags].filter(Boolean).join("  ");
    process.stdout.write(`${headerParts}\n`);

    // Title (if present)
    if (msg.title) {
      process.stdout.write(`${c(BOLD, msg.title)}\n`);
    }

    // Message body
    const body = msg.message ?? c(DIM, "(no message body)");
    process.stdout.write(`${body}\n`);

    // Click URL (if present)
    if (msg.click) {
      process.stdout.write(`${c(MAGENTA, msg.click)}\n`);
    }

    separator();
  }
}

// ---------------------------------------------------------------------------
// Unread summary display
// ---------------------------------------------------------------------------

const MAX_PREVIEWS_PER_TOPIC = 5;

/**
 * Display a grouped unread summary across multiple topics.
 *
 * @param results    - Array of {topic, messages} objects
 * @param sinceLabel - Human-readable "since" string, e.g. "1h" or "all"
 */
export function displayUnreadSummary(
  results: { topic: string; messages: NtfyMessage[] }[],
  sinceLabel: string
): void {
  const total = results.reduce((n, r) => n + r.messages.length, 0);

  process.stdout.write(
    `\n${c(BOLD, "Unread messages")} ${c(DIM, `since ${sinceLabel}`)} — ${c(GREEN, `${total} total`)}\n\n`
  );

  for (const { topic, messages } of results) {
    if (messages.length === 0) {
      process.stdout.write(`  ${c(CYAN, topic)}  ${c(DIM, "no new messages")}\n\n`);
      continue;
    }

    process.stdout.write(
      `  ${c(BOLD + CYAN, topic)}  ${c(YELLOW, `${messages.length} message${messages.length !== 1 ? "s" : ""}`)}\n`
    );

    const previews = messages.slice(-MAX_PREVIEWS_PER_TOPIC);
    for (const msg of previews) {
      const time = c(DIM, formatTimeShort(msg.time));
      const badge = priorityBadge(msg.priority);
      const preview = msg.title
        ? c(BOLD, msg.title)
        : (msg.message ?? "").slice(0, 60) + ((msg.message?.length ?? 0) > 60 ? "…" : "");

      const line = [time, badge, preview].filter(Boolean).join("  ");
      process.stdout.write(`    ${line}\n`);
    }

    if (messages.length > MAX_PREVIEWS_PER_TOPIC) {
      process.stdout.write(
        `    ${c(DIM, `… and ${messages.length - MAX_PREVIEWS_PER_TOPIC} more`)}\n`
      );
    }

    process.stdout.write("\n");
  }
}
