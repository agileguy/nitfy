/**
 * Smoke tests for shell completions (src/completions.ts).
 *
 * We validate that:
 *  - Each generator returns a non-empty string
 *  - Key patterns expected by the respective shell are present
 *  - Profile names and topic names from config appear in the output
 */

import { describe, it, expect } from "bun:test";
import {
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
} from "../src/completions";
import type { Config } from "../src/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    activeProfile: "home",
    profiles: {
      home: {
        url: "https://ntfy.home.arpa",
        user: "alice",
        password: "secret",
        defaultTopic: "alerts",
        topics: ["alerts", "builds", "deployments"],
        topicGroups: { devops: ["builds", "deployments"] },
      },
      work: {
        url: "https://ntfy.work.example.com",
        user: "alice",
        password: "workpass",
        defaultTopic: "ci",
        topics: ["ci", "security"],
        topicGroups: {},
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bash completions
// ---------------------------------------------------------------------------

describe("generateBashCompletions", () => {
  it("returns a non-empty string", () => {
    const output = generateBashCompletions(null);
    expect(output.length).toBeGreaterThan(0);
  });

  it("includes the complete function declaration", () => {
    const output = generateBashCompletions(null);
    expect(output).toContain("_ntfy_completions()");
  });

  it("registers with the complete builtin", () => {
    const output = generateBashCompletions(null);
    expect(output).toContain("complete -F _ntfy_completions ntfy");
  });

  it("lists top-level commands", () => {
    const output = generateBashCompletions(null);
    expect(output).toContain("messages");
    expect(output).toContain("unread");
    expect(output).toContain("send");
    expect(output).toContain("health");
    expect(output).toContain("topics");
    expect(output).toContain("config");
    expect(output).toContain("completions");
    expect(output).toContain("watch");
  });

  it("includes send flags", () => {
    const output = generateBashCompletions(null);
    expect(output).toContain("--delay");
    expect(output).toContain("--click");
    expect(output).toContain("--attach");
    expect(output).toContain("--markdown");
  });

  it("includes global flags", () => {
    const output = generateBashCompletions(null);
    expect(output).toContain("--server");
    expect(output).toContain("--json");
    expect(output).toContain("--no-color");
    expect(output).toContain("--quiet");
  });

  it("embeds profile names from config", () => {
    const output = generateBashCompletions(makeConfig());
    expect(output).toContain("home");
    expect(output).toContain("work");
  });

  it("embeds topic names from config", () => {
    const output = generateBashCompletions(makeConfig());
    expect(output).toContain("alerts");
    expect(output).toContain("builds");
    expect(output).toContain("deployments");
    expect(output).toContain("ci");
    expect(output).toContain("security");
  });

  it("handles null config gracefully (no profiles or topics)", () => {
    const output = generateBashCompletions(null);
    // Should still produce a valid completion script
    expect(output).toContain("_ntfy_completions()");
    expect(output).toContain("complete -F _ntfy_completions ntfy");
  });

  it("covers completions subcommand shell choices", () => {
    const output = generateBashCompletions(null);
    expect(output).toContain("bash");
    expect(output).toContain("zsh");
    expect(output).toContain("fish");
  });

  it("includes config subcommands", () => {
    const output = generateBashCompletions(null);
    expect(output).toContain("add remove rm list ls use show");
  });

  it("includes topics subcommands", () => {
    const output = generateBashCompletions(null);
    expect(output).toContain("list ls add remove rm group");
  });

  it("includes priority level completions", () => {
    const output = generateBashCompletions(null);
    expect(output).toContain("urgent");
    expect(output).toContain("min low default high urgent max");
  });
});

// ---------------------------------------------------------------------------
// Zsh completions
// ---------------------------------------------------------------------------

describe("generateZshCompletions", () => {
  it("returns a non-empty string", () => {
    const output = generateZshCompletions(null);
    expect(output.length).toBeGreaterThan(0);
  });

  it("starts with #compdef directive", () => {
    const output = generateZshCompletions(null);
    expect(output.startsWith("#compdef ntfy")).toBe(true);
  });

  it("defines the _ntfy function", () => {
    const output = generateZshCompletions(null);
    expect(output).toContain("_ntfy()");
  });

  it("ends with _ntfy invocation", () => {
    const output = generateZshCompletions(null);
    expect(output.trimEnd()).toContain('_ntfy "$@"');
  });

  it("lists top-level commands with descriptions", () => {
    const output = generateZshCompletions(null);
    expect(output).toContain("messages:Fetch and display messages");
    expect(output).toContain("unread:Show unread messages");
    expect(output).toContain("send:Send a notification message");
    expect(output).toContain("completions:Generate shell completion scripts");
    expect(output).toContain("watch:Watch topics for new messages");
  });

  it("includes send command flags", () => {
    const output = generateZshCompletions(null);
    expect(output).toContain("--delay");
    expect(output).toContain("--click");
    expect(output).toContain("--attach");
    expect(output).toContain("--markdown");
    expect(output).toContain("--md");
  });

  it("embeds profile names from config in completions", () => {
    const output = generateZshCompletions(makeConfig());
    expect(output).toContain("'home'");
    expect(output).toContain("'work'");
  });

  it("embeds topic names from config in completions", () => {
    const output = generateZshCompletions(makeConfig());
    expect(output).toContain("'alerts'");
    expect(output).toContain("'builds'");
    expect(output).toContain("'ci'");
  });

  it("handles null config gracefully", () => {
    const output = generateZshCompletions(null);
    expect(output).toContain("_ntfy()");
    expect(output).toContain("#compdef ntfy");
  });

  it("includes completions shell type completion", () => {
    const output = generateZshCompletions(null);
    // zsh uses :shell:(bash zsh fish) style for argument completion
    expect(output).toContain("(bash zsh fish)");
  });

  it("includes config subcommand handling", () => {
    const output = generateZshCompletions(null);
    expect(output).toContain("add:Add a new server profile");
    expect(output).toContain("use:Set the active profile");
  });

  it("includes topics subcommand handling", () => {
    const output = generateZshCompletions(null);
    expect(output).toContain("list:List watched topics and groups");
    expect(output).toContain("group:Manage topic groups");
  });

  it("has priority levels for priority flags", () => {
    const output = generateZshCompletions(null);
    expect(output).toContain("min low default high urgent max");
  });
});

// ---------------------------------------------------------------------------
// Fish completions
// ---------------------------------------------------------------------------

describe("generateFishCompletions", () => {
  it("returns a non-empty string", () => {
    const output = generateFishCompletions(null);
    expect(output.length).toBeGreaterThan(0);
  });

  it("disables file completions", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("complete -c ntfy -f");
  });

  it("defines __ntfy_using_command function", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("function __ntfy_using_command");
  });

  it("defines __ntfy_using_subcommand function", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("function __ntfy_using_subcommand");
  });

  it("registers top-level command completions", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("-a 'messages'");
    expect(output).toContain("-a 'unread'");
    expect(output).toContain("-a 'send'");
    expect(output).toContain("-a 'health'");
    expect(output).toContain("-a 'completions'");
    expect(output).toContain("-a 'watch'");
  });

  it("includes send-specific flags", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("-l delay");
    expect(output).toContain("-l click");
    expect(output).toContain("-l attach");
    expect(output).toContain("-l markdown");
    expect(output).toContain("-l md");
  });

  it("includes global flags", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("-l server");
    expect(output).toContain("-l json");
    expect(output).toContain("-l no-color");
    expect(output).toContain("-l quiet");
    expect(output).toContain("-l help");
  });

  it("embeds profile names from config", () => {
    const output = generateFishCompletions(makeConfig());
    expect(output).toContain("home");
    expect(output).toContain("work");
  });

  it("embeds topic names from config", () => {
    const output = generateFishCompletions(makeConfig());
    expect(output).toContain("alerts");
    expect(output).toContain("builds");
    expect(output).toContain("ci");
    expect(output).toContain("security");
  });

  it("handles null config gracefully", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("complete -c ntfy -f");
    expect(output).toContain("function __ntfy_using_command");
  });

  it("includes completions shell choices", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("-a 'bash zsh fish'");
  });

  it("includes topics subcommand completions", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("-a 'list ls add remove rm group'");
  });

  it("includes config subcommand completions", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("-a 'add remove rm list ls use show'");
  });

  it("includes priority levels for watch and messages", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("1 2 3 4 5 min low default high urgent max");
  });

  it("uses __ntfy_using_command guards for subcommand flags", () => {
    const output = generateFishCompletions(null);
    expect(output).toContain("'__ntfy_using_command send'");
    expect(output).toContain("'__ntfy_using_command unread'");
    expect(output).toContain("'__ntfy_using_command watch'");
  });
});

// ---------------------------------------------------------------------------
// Cross-shell consistency
// ---------------------------------------------------------------------------

describe("completions cross-shell consistency", () => {
  const shells = [
    { name: "bash", fn: generateBashCompletions },
    { name: "zsh", fn: generateZshCompletions },
    { name: "fish", fn: generateFishCompletions },
  ] as const;

  for (const { name, fn } of shells) {
    it(`${name}: output is non-empty with populated config`, () => {
      const output = fn(makeConfig());
      expect(output.length).toBeGreaterThan(100);
    });

    it(`${name}: output is non-empty with null config`, () => {
      const output = fn(null);
      expect(output.length).toBeGreaterThan(100);
    });

    it(`${name}: 'send' appears in output`, () => {
      expect(fn(null)).toContain("send");
    });

    it(`${name}: 'completions' appears in output`, () => {
      expect(fn(null)).toContain("completions");
    });
  }
});
