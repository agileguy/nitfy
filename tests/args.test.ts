import { describe, it, expect } from "bun:test";
import { getFlag, hasFlag, getPositionals, joinPositionals } from "../src/args";

// ---------------------------------------------------------------------------
// getFlag
// ---------------------------------------------------------------------------

describe("getFlag", () => {
  it("returns value for --flag value form", () => {
    const args = ["--server", "https://ntfy.sh", "--topic", "alerts"];
    expect(getFlag(args, "--server")).toBe("https://ntfy.sh");
    expect(getFlag(args, "--topic")).toBe("alerts");
  });

  it("returns value for --flag=value form", () => {
    const args = ["--server=https://ntfy.sh", "--topic=alerts"];
    expect(getFlag(args, "--server")).toBe("https://ntfy.sh");
    expect(getFlag(args, "--topic")).toBe("alerts");
  });

  it("returns value for alias -f value form", () => {
    const args = ["-s", "https://ntfy.sh"];
    expect(getFlag(args, "--server", "-s")).toBe("https://ntfy.sh");
  });

  it("returns value for alias -f=value form", () => {
    const args = ["-s=https://ntfy.sh"];
    expect(getFlag(args, "--server", "-s")).toBe("https://ntfy.sh");
  });

  it("returns undefined when flag is not present", () => {
    const args = ["--topic", "alerts"];
    expect(getFlag(args, "--server")).toBeUndefined();
  });

  it("returns undefined when flag is present but next arg is also a flag", () => {
    const args = ["--server", "--topic"];
    expect(getFlag(args, "--server")).toBeUndefined();
  });

  it("returns undefined when flag is at end of args with no value", () => {
    const args = ["--server"];
    expect(getFlag(args, "--server")).toBeUndefined();
  });

  it("returns first occurrence when flag appears multiple times", () => {
    const args = ["--topic", "first", "--topic", "second"];
    expect(getFlag(args, "--topic")).toBe("first");
  });
});

// ---------------------------------------------------------------------------
// hasFlag
// ---------------------------------------------------------------------------

describe("hasFlag", () => {
  it("returns true when flag exists", () => {
    const args = ["--json", "send", "hello"];
    expect(hasFlag(args, "--json")).toBe(true);
  });

  it("returns false when flag does not exist", () => {
    const args = ["send", "hello"];
    expect(hasFlag(args, "--json")).toBe(false);
  });

  it("returns true when alias matches", () => {
    const args = ["-j"];
    expect(hasFlag(args, "--json", "-j")).toBe(true);
  });

  it("returns false for alias when neither flag nor alias is present", () => {
    const args = ["--topic", "alerts"];
    expect(hasFlag(args, "--json", "-j")).toBe(false);
  });

  it("returns true for --flag=value form (strips the =value part)", () => {
    const args = ["--server=https://ntfy.sh"];
    expect(hasFlag(args, "--server")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPositionals
// ---------------------------------------------------------------------------

describe("getPositionals", () => {
  it("returns plain words that are not flags", () => {
    const args = ["send", "hello world"];
    expect(getPositionals(args, [])).toEqual(["send", "hello world"]);
  });

  it("skips flags and their values", () => {
    const args = ["send", "--topic", "alerts", "hello"];
    expect(getPositionals(args, ["--topic"])).toEqual(["send", "hello"]);
  });

  it("skips --flag=value form", () => {
    const args = ["--topic=alerts", "send", "hello"];
    expect(getPositionals(args, ["--topic"])).toEqual(["send", "hello"]);
  });

  it("skips boolean flags with no value", () => {
    const args = ["--json", "send", "hello"];
    expect(getPositionals(args, [])).toEqual(["send", "hello"]);
  });

  it("returns empty array when all args are flags", () => {
    const args = ["--server", "https://ntfy.sh", "--topic", "alerts"];
    expect(getPositionals(args, ["--server", "--topic"])).toEqual([]);
  });

  it("handles mixed flags and positionals correctly", () => {
    const args = ["-s", "https://ntfy.sh", "send", "--json", "my message"];
    expect(getPositionals(args, ["-s"])).toEqual(["send", "my message"]);
  });
});

// ---------------------------------------------------------------------------
// joinPositionals
// ---------------------------------------------------------------------------

describe("joinPositionals", () => {
  it("joins positionals with a space", () => {
    const args = ["--topic", "alerts", "hello", "world"];
    expect(joinPositionals(args, ["--topic"])).toBe("hello world");
  });

  it("returns empty string when no positionals", () => {
    const args = ["--topic", "alerts"];
    expect(joinPositionals(args, ["--topic"])).toBe("");
  });
});
