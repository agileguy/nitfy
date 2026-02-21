import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  formatTime,
  formatTimeShort,
  priorityBadge,
  formatTags,
  setNoColor,
  setQuiet,
  displayMessages,
  displayUnreadSummary,
} from "../src/display";
import type { NtfyMessage } from "../src/api";

// Import module namespace for potential future use
import * as displayModule from "../src/display";

// ---------------------------------------------------------------------------
// Ensure ANSI color is enabled and quiet mode is off for tests.
// ---------------------------------------------------------------------------
beforeEach(() => {
  setNoColor(false);
  setQuiet(false);
});

afterEach(() => {
  // Reset to a neutral state
  setNoColor(false);
  setQuiet(false);
});

// ---------------------------------------------------------------------------
// Helper: strip ANSI escape codes for clean assertions
// ---------------------------------------------------------------------------

function stripAnsi(str: string): string {
  // Matches ESC[ ... m sequences
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe("formatTime", () => {
  it("returns 'just now' for a timestamp within the last 10 seconds", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTime(now - 5);
    expect(result).toContain("just now");
  });

  it("returns seconds ago for 30 seconds ago", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTime(now - 30);
    expect(result).toContain("30s ago");
  });

  it("returns minutes ago for 2 minutes ago", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTime(now - 120);
    expect(result).toContain("2m ago");
  });

  it("returns hours ago for 3 hours ago", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTime(now - 10800);
    expect(result).toContain("3h ago");
  });

  it("includes date and time components", () => {
    // Use a fixed Unix timestamp: 2026-02-20 00:00:00 UTC = 1771200000
    const ts = 1771200000;
    const result = formatTime(ts);
    // Should contain a date-like prefix (YYYY-MM-DD)
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
    // Should contain a time-like component (HH:MM)
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// formatTimeShort
// ---------------------------------------------------------------------------

describe("formatTimeShort", () => {
  it("returns HH:MM format only", () => {
    const ts = 1771200000; // 2026-02-20 00:00:00 UTC
    const result = formatTimeShort(ts);
    // Must match HH:MM and nothing more
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// priorityBadge
// ---------------------------------------------------------------------------

describe("priorityBadge", () => {
  it("returns empty string for priority 3 (default)", () => {
    expect(priorityBadge(3)).toBe("");
  });

  it("returns empty string for undefined priority", () => {
    expect(priorityBadge(undefined)).toBe("");
  });

  it("returns '[urgent]' text for priority 5", () => {
    const result = stripAnsi(priorityBadge(5));
    expect(result).toBe("[urgent]");
  });

  it("returns '[high]' text for priority 4", () => {
    const result = stripAnsi(priorityBadge(4));
    expect(result).toBe("[high]");
  });

  it("returns '[low]' text for priority 2", () => {
    const result = stripAnsi(priorityBadge(2));
    expect(result).toBe("[low]");
  });

  it("returns '[min]' text for priority 1", () => {
    const result = stripAnsi(priorityBadge(1));
    expect(result).toBe("[min]");
  });

  it("badge for priority 5 contains red ANSI code", () => {
    const result = priorityBadge(5);
    // Red = \x1b[31m
    expect(result).toContain("\x1b[31m");
  });

  it("badge for priority 4 contains yellow ANSI code", () => {
    const result = priorityBadge(4);
    // Yellow = \x1b[33m
    expect(result).toContain("\x1b[33m");
  });
});

// ---------------------------------------------------------------------------
// formatTags
// ---------------------------------------------------------------------------

describe("formatTags", () => {
  it("returns empty string for undefined", () => {
    expect(formatTags(undefined)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(formatTags([])).toBe("");
  });

  it("formats a single tag with # prefix", () => {
    const result = stripAnsi(formatTags(["warning"]));
    expect(result).toBe("#warning");
  });

  it("formats multiple tags separated by spaces", () => {
    const result = stripAnsi(formatTags(["warning", "critical", "prod"]));
    expect(result).toBe("#warning #critical #prod");
  });

  it("applies DIM ANSI code to output", () => {
    const result = formatTags(["test"]);
    // DIM = \x1b[2m
    expect(result).toContain("\x1b[2m");
  });
});

// ---------------------------------------------------------------------------
// quietMode
// ---------------------------------------------------------------------------

/**
 * Capture all stdout.write calls during a function, returning the
 * concatenated string output.
 */
function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  // @ts-expect-error - overriding write for test capture
  process.stdout.write = (chunk: string) => {
    chunks.push(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join("");
}

/** Build a minimal NtfyMessage for testing. */
function makeMsg(overrides: Partial<NtfyMessage> = {}): NtfyMessage {
  return {
    id: "test-id",
    time: Math.floor(Date.now() / 1000) - 60,
    event: "message",
    topic: "test-topic",
    message: "Hello world",
    ...overrides,
  };
}

describe("quietMode - displayMessages", () => {
  it("in quiet mode, only prints message bodies (no headers)", () => {
    setQuiet(true);
    const msgs = [makeMsg({ message: "body one" }), makeMsg({ message: "body two" })];
    const output = captureStdout(() => displayMessages(msgs, "test-topic"));
    // Should contain message text
    expect(output).toContain("body one");
    expect(output).toContain("body two");
    // Should NOT contain topic label or separators
    expect(output).not.toContain("test-topic");
    expect(output).not.toContain("─");
  });

  it("in normal mode, includes topic header and separators", () => {
    setNoColor(true); // suppress ANSI for easier assertion
    setQuiet(false);
    const msgs = [makeMsg({ message: "hello" })];
    const output = captureStdout(() => displayMessages(msgs, "my-topic"));
    expect(output).toContain("my-topic");
    expect(output).toContain("─");
  });

  it("in quiet mode with no messages, produces no output", () => {
    setQuiet(true);
    const output = captureStdout(() => displayMessages([], "empty-topic"));
    expect(output).toBe("");
  });
});

describe("quietMode - displayUnreadSummary", () => {
  it("in quiet mode, only prints the total count line", () => {
    setQuiet(true);
    const results = [
      { topic: "FAST-all", messages: [makeMsg(), makeMsg()] },
      { topic: "FAST-infra", messages: [makeMsg()] },
    ];
    const output = captureStdout(() => displayUnreadSummary(results, "1h"));
    const trimmed = output.trim();
    expect(trimmed).toBe("3");
  });

  it("in normal mode, includes full unread header and topic lines", () => {
    setNoColor(true);
    setQuiet(false);
    const results = [
      { topic: "FAST-all", messages: [makeMsg()] },
    ];
    const output = captureStdout(() => displayUnreadSummary(results, "1h"));
    expect(output).toContain("Unread messages");
    expect(output).toContain("FAST-all");
  });

  it("in quiet mode with zero unread, prints 0", () => {
    setQuiet(true);
    const results = [{ topic: "FAST-all", messages: [] }];
    const output = captureStdout(() => displayUnreadSummary(results, "1h"));
    expect(output.trim()).toBe("0");
  });
});
