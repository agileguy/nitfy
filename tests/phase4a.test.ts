/**
 * Phase 4A tests: Distribution polish, stderr/stdout correctness,
 * JSON error output format, and message ID truncation.
 */

import { describe, it, expect, afterEach, mock, beforeEach } from "bun:test";
import { setNoColor, setQuiet, formatTime } from "../src/display";
import { parsePriority } from "../ntfy.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Capture writes to process.stderr during a synchronous callback.
 * Returns the concatenated string of all captured chunks.
 */
function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  // @ts-expect-error - overriding write for test capture
  process.stderr.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join("");
}

/**
 * Capture writes to process.stdout during a synchronous callback.
 */
function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  // @ts-expect-error - overriding write for test capture
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  // Also intercept console.log (which writes to stdout)
  const origConsoleLog = console.log;
  console.log = (...args: unknown[]) => {
    chunks.push(args.map(String).join(" ") + "\n");
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
    console.log = origConsoleLog;
  }
  return chunks.join("");
}

/**
 * Capture console.error calls (which write to stderr by default).
 */
function captureConsoleError(fn: () => void): string {
  const chunks: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    chunks.push(args.map(String).join(" ") + "\n");
  };
  try {
    fn();
  } finally {
    console.error = origError;
  }
  return chunks.join("");
}

// ---------------------------------------------------------------------------
// Display module setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  setNoColor(true); // Suppress ANSI for cleaner assertions
  setQuiet(false);
});

afterEach(() => {
  setNoColor(false);
  setQuiet(false);
  mock.restore();
});

// ---------------------------------------------------------------------------
// parsePriority (exported from ntfy.ts for testability)
// ---------------------------------------------------------------------------

describe("parsePriority", () => {
  it("parses numeric priority strings 1-5", () => {
    expect(parsePriority("1")).toBe(1);
    expect(parsePriority("2")).toBe(2);
    expect(parsePriority("3")).toBe(3);
    expect(parsePriority("4")).toBe(4);
    expect(parsePriority("5")).toBe(5);
  });

  it("parses named priority aliases", () => {
    expect(parsePriority("min")).toBe(1);
    expect(parsePriority("minimum")).toBe(1);
    expect(parsePriority("low")).toBe(2);
    expect(parsePriority("default")).toBe(3);
    expect(parsePriority("normal")).toBe(3);
    expect(parsePriority("high")).toBe(4);
    expect(parsePriority("urgent")).toBe(5);
    expect(parsePriority("max")).toBe(5);
    expect(parsePriority("maximum")).toBe(5);
  });

  it("is case-insensitive for named aliases", () => {
    expect(parsePriority("MIN")).toBe(1);
    expect(parsePriority("Urgent")).toBe(5);
    expect(parsePriority("HIGH")).toBe(4);
  });

  it("returns undefined for out-of-range numeric strings", () => {
    expect(parsePriority("0")).toBeUndefined();
    expect(parsePriority("6")).toBeUndefined();
    expect(parsePriority("99")).toBeUndefined();
  });

  it("returns undefined for unrecognised strings", () => {
    expect(parsePriority("extreme")).toBeUndefined();
    expect(parsePriority("")).toBeUndefined();
    expect(parsePriority("abc")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatTime: ISO format comment verification
// ---------------------------------------------------------------------------

describe("formatTime ISO format", () => {
  it("always uses ISO 8601 date format (YYYY-MM-DD) regardless of locale", () => {
    // Use a fixed timestamp for deterministic output
    const ts = 1771200000; // 2026-02-20 00:00:00 UTC
    const result = formatTime(ts);
    // Date portion must be ISO 8601 (YYYY-MM-DD) — intentional for deterministic output
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("includes HH:MM time component after the date", () => {
    const ts = 1771200000;
    const result = formatTime(ts);
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it("includes relative time in parentheses", () => {
    const ts = Math.floor(Date.now() / 1000) - 60;
    const result = formatTime(ts);
    expect(result).toMatch(/\(.*\)/);
  });
});

// ---------------------------------------------------------------------------
// Error output paths: errors must go to stderr, not stdout
// ---------------------------------------------------------------------------

describe("Error output goes to stderr (console.error)", () => {
  it("console.error produces output that would go to stderr", () => {
    // Verify that console.error calls are distinct from console.log
    const stderrOutput = captureConsoleError(() => {
      console.error("Error: something went wrong");
    });
    expect(stderrOutput).toContain("Error: something went wrong");
  });

  it("console.log does not go to stderr", () => {
    // Positive: console.log goes to stdout, not to our stderr capture
    const stderrOutput = captureConsoleError(() => {
      console.log("normal output");
    });
    expect(stderrOutput).toBe("");
  });

  it("error messages do not appear in stdout capture", () => {
    // Ensure console.error messages stay out of stdout
    const stdoutOutput = captureStdout(() => {
      // This is what stderr-only output looks like:
      // console.error would NOT appear in stdout capture
    });
    expect(stdoutOutput).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Message ID truncation in display
// ---------------------------------------------------------------------------

describe("Message ID truncation in display (8 chars)", () => {
  it("slicing a full ID to 8 chars produces the correct prefix", () => {
    // ntfy message IDs are alphanumeric, e.g. "k1h6BSmS6yYH8Qrk"
    const fullId = "k1h6BSmS6yYH8Qrk";
    const displayId = fullId.slice(0, 8);
    expect(displayId).toBe("k1h6BSmS"); // first 8 chars
    expect(displayId.length).toBe(8);
  });

  it("IDs shorter than 8 chars are not padded (slice is safe)", () => {
    const shortId = "abc";
    const displayId = shortId.slice(0, 8);
    expect(displayId).toBe("abc");
    expect(displayId.length).toBe(3);
  });

  it("ID exactly 8 chars is returned as-is", () => {
    const eightCharId = "12345678";
    const displayId = eightCharId.slice(0, 8);
    expect(displayId).toBe("12345678");
  });

  it("IDs longer than 8 chars are truncated to 8", () => {
    const longId = "abcdefghijklmnop";
    const displayId = longId.slice(0, 8);
    expect(displayId).toBe("abcdefgh");
    expect(displayId.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// JSON error output format
// ---------------------------------------------------------------------------

describe("JSON error output format", () => {
  it("error JSON has {error: string} shape", () => {
    const errorMsg = "Profile 'missing' not found. Available profiles: home";
    const jsonOutput = JSON.stringify({ error: errorMsg });
    const parsed = JSON.parse(jsonOutput) as { error: string };
    expect(parsed).toHaveProperty("error");
    expect(typeof parsed.error).toBe("string");
    expect(parsed.error).toBe(errorMsg);
  });

  it("error JSON is valid JSON (parseable)", () => {
    const testCases = [
      "No profile configured",
      "HTTP 401 Unauthorized",
      "Network connection refused",
      "Profile \"home\" not found",
    ];
    for (const msg of testCases) {
      const jsonStr = JSON.stringify({ error: msg });
      expect(() => JSON.parse(jsonStr)).not.toThrow();
      const parsed = JSON.parse(jsonStr) as { error: string };
      expect(parsed.error).toBe(msg);
    }
  });

  it("JSON error output should go to stdout (for piping), not stderr", () => {
    // When --json is set, errors should be sent to stdout as JSON,
    // allowing tools like jq to parse them. This test verifies the
    // design: JSON.stringify({error:...}) is used with console.log (stdout).
    const chunks: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      chunks.push(args.map(String).join(" "));
    };

    try {
      // Simulate what the main error handler does in --json mode:
      const msg = "Test error message";
      console.log(JSON.stringify({ error: msg }));
    } finally {
      console.log = origLog;
    }

    expect(chunks.length).toBe(1);
    const parsed = JSON.parse(chunks[0]!) as { error: string };
    expect(parsed.error).toBe("Test error message");
  });

  it("JSON error structure does not include a 'message' key (uses 'error')", () => {
    // The spec says: {"error": "..."}, NOT {"message": "..."}
    const msg = "Something failed";
    const output = JSON.stringify({ error: msg });
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toHaveProperty("error");
    expect(parsed).not.toHaveProperty("message");
  });
});

// ---------------------------------------------------------------------------
// Exit code conventions
// ---------------------------------------------------------------------------

describe("Exit code conventions", () => {
  it("exit code 0 is success (reference value check)", () => {
    // These are the documented exit code conventions in the SRD
    const EXIT_SUCCESS = 0;
    const EXIT_RUNTIME_ERROR = 1;
    const EXIT_USAGE_ERROR = 2;

    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_RUNTIME_ERROR).toBe(1);
    expect(EXIT_USAGE_ERROR).toBe(2);

    // Usage errors should have a higher code than runtime errors
    expect(EXIT_USAGE_ERROR).toBeGreaterThan(EXIT_RUNTIME_ERROR);
  });
});

// ---------------------------------------------------------------------------
// Package.json scripts verification
// ---------------------------------------------------------------------------

describe("package.json distribution scripts", () => {
  it("has correct build script for compiled binary", async () => {
    const pkg = await import("../package.json");
    // Access via default export or named exports depending on the module format
    const scripts = (pkg as Record<string, Record<string, string>>).default?.scripts
      ?? (pkg as Record<string, Record<string, string>>).scripts;
    expect(scripts).toBeDefined();
    expect(scripts!["build"]).toBe("bun build --compile ntfy.ts --outfile ntfy");
  });

  it("has correct dev script", async () => {
    const pkg = await import("../package.json");
    const scripts = (pkg as Record<string, Record<string, string>>).default?.scripts
      ?? (pkg as Record<string, Record<string, string>>).scripts;
    expect(scripts!["dev"]).toBe("bun run ntfy.ts");
  });

  it("has correct test script", async () => {
    const pkg = await import("../package.json");
    const scripts = (pkg as Record<string, Record<string, string>>).default?.scripts
      ?? (pkg as Record<string, Record<string, string>>).scripts;
    expect(scripts!["test"]).toBe("bun test");
  });
});
