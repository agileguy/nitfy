/**
 * Tests for src/watch.ts
 *
 * Tests cover:
 * - defaultSoundPath: returns a string path ending in ping.aiff
 * - playSound: mocked Bun.spawn calls for macOS and Linux
 * - filterNewMessages: pure new-message detection logic
 * - shouldTriggerSound: pure priority threshold logic
 * - watchLoop: integration via AbortController
 */

import { describe, it, expect, spyOn, afterEach, mock } from "bun:test";
import {
  playSound,
  defaultSoundPath,
  filterNewMessages,
  shouldTriggerSound,
  watchLoop,
} from "../src/watch.js";
import type { NtfyMessage } from "../src/api.js";
import type { ServerProfile } from "../src/config.js";

// ---------------------------------------------------------------------------
// defaultSoundPath
// ---------------------------------------------------------------------------

describe("defaultSoundPath", () => {
  it("returns a string path ending with ping.aiff", () => {
    const p = defaultSoundPath();
    expect(typeof p).toBe("string");
    expect(p.endsWith("ping.aiff")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// playSound
// ---------------------------------------------------------------------------

describe("playSound", () => {
  afterEach(() => {
    mock.restore();
  });

  it("does nothing when noSound is true", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as unknown as ReturnType<typeof Bun.spawn>);

    await playSound("/tmp/ping.aiff", { noSound: true });

    expect(spawnSpy.mock.calls.length).toBe(0);

    spawnSpy.mockRestore();
  });

  it("calls afplay on macOS with sound path", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as unknown as ReturnType<typeof Bun.spawn>);

    await playSound("/tmp/test.aiff");

    expect(spawnSpy.mock.calls.length).toBe(1);
    const [cmd] = spawnSpy.mock.calls[0] as [string[]];
    expect(cmd[0]).toBe("afplay");
    expect(cmd[cmd.length - 1]).toBe("/tmp/test.aiff");

    spawnSpy.mockRestore();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("passes -d <device> to afplay when device is specified", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as unknown as ReturnType<typeof Bun.spawn>);

    await playSound("/tmp/test.aiff", { device: "MacBook Pro Speakers" });

    const [cmd] = spawnSpy.mock.calls[0] as [string[]];
    expect(cmd).toContain("-d");
    expect(cmd).toContain("MacBook Pro Speakers");

    spawnSpy.mockRestore();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("tries play then paplay on Linux", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    let callCount = 0;
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      callCount++;
      return {
        exited: Promise.resolve(callCount === 1 ? 1 : 0),
      } as unknown as ReturnType<typeof Bun.spawn>;
    });

    await playSound("/tmp/test.wav");

    expect(spawnSpy.mock.calls.length).toBe(2);
    const [firstCmd] = spawnSpy.mock.calls[0] as [string[]];
    const [secondCmd] = spawnSpy.mock.calls[1] as [string[]];
    expect(firstCmd[0]).toBe("play");
    expect(secondCmd[0]).toBe("paplay");

    spawnSpy.mockRestore();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("warns when no Linux player succeeds", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => ({
      exited: Promise.resolve(1),
    } as unknown as ReturnType<typeof Bun.spawn>));

    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);

    await playSound("/tmp/test.wav");

    const warned = stderrSpy.mock.calls.some((args) => {
      const str = args[0];
      return typeof str === "string" && str.includes("Warning");
    });
    expect(warned).toBe(true);

    spawnSpy.mockRestore();
    stderrSpy.mockRestore();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("gracefully handles spawn throwing (player not installed)", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("ENOENT: afplay not found");
    });

    await expect(playSound("/tmp/test.aiff")).resolves.toBeUndefined();

    spawnSpy.mockRestore();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });
});

// ---------------------------------------------------------------------------
// filterNewMessages - pure new-message detection logic
// ---------------------------------------------------------------------------

describe("filterNewMessages", () => {
  function makeMsg(id: string, time: number, priority?: number): NtfyMessage {
    return { id, time, event: "message", topic: "test", message: `msg ${id}`, priority };
  }

  it("returns empty array when no messages are newer than lastSeenTime", () => {
    const msgs = [makeMsg("a", 100), makeMsg("b", 200)];
    const result = filterNewMessages(msgs, 300);
    expect(result).toHaveLength(0);
  });

  it("returns messages strictly newer than lastSeenTime", () => {
    const msgs = [makeMsg("a", 100), makeMsg("b", 200), makeMsg("c", 300)];
    const result = filterNewMessages(msgs, 200);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("c");
  });

  it("excludes the message AT lastSeenTime (strict greater-than)", () => {
    const msgs = [makeMsg("a", 200), makeMsg("b", 201)];
    const result = filterNewMessages(msgs, 200);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("b");
  });

  it("returns all messages when lastSeenTime is 0", () => {
    const msgs = [makeMsg("a", 100), makeMsg("b", 200)];
    const result = filterNewMessages(msgs, 0);
    expect(result).toHaveLength(2);
  });

  it("returns messages sorted by time ascending", () => {
    // Supply them out of order
    const msgs = [makeMsg("b", 300), makeMsg("a", 200), makeMsg("c", 400)];
    const result = filterNewMessages(msgs, 100);
    expect(result[0]!.id).toBe("a");
    expect(result[1]!.id).toBe("b");
    expect(result[2]!.id).toBe("c");
  });

  it("returns empty array for empty input", () => {
    const result = filterNewMessages([], 0);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// shouldTriggerSound - pure priority threshold logic
// ---------------------------------------------------------------------------

describe("shouldTriggerSound", () => {
  function makeMsg(priority?: number): NtfyMessage {
    return { id: "x", time: 1000, event: "message", topic: "test", priority };
  }

  it("returns true when message priority meets threshold", () => {
    const msgs = [makeMsg(4)]; // high
    expect(shouldTriggerSound(msgs, 4)).toBe(true);
  });

  it("returns true when message priority exceeds threshold", () => {
    const msgs = [makeMsg(5)]; // urgent
    expect(shouldTriggerSound(msgs, 4)).toBe(true); // threshold: high
  });

  it("returns false when message priority is below threshold", () => {
    const msgs = [makeMsg(2)]; // low
    expect(shouldTriggerSound(msgs, 4)).toBe(false); // threshold: high
  });

  it("defaults to priority 3 when message has no priority field", () => {
    const msgs = [makeMsg(undefined)]; // defaults to 3
    expect(shouldTriggerSound(msgs, 3)).toBe(true);
    expect(shouldTriggerSound(msgs, 4)).toBe(false);
  });

  it("returns true if ANY message meets the threshold (mixed batch)", () => {
    const msgs = [makeMsg(2), makeMsg(5)]; // low and urgent
    expect(shouldTriggerSound(msgs, 4)).toBe(true);
  });

  it("returns false for empty message array", () => {
    expect(shouldTriggerSound([], 1)).toBe(false);
  });

  it("threshold 1 matches all messages (minimum priority)", () => {
    const msgs = [makeMsg(1), makeMsg(2), makeMsg(3)];
    expect(shouldTriggerSound(msgs, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// watchLoop integration test (uses AbortController to stop the loop)
// ---------------------------------------------------------------------------

describe("watchLoop integration", () => {
  afterEach(() => {
    mock.restore();
  });

  function makeProfile(): ServerProfile {
    return {
      url: "https://ntfy.example.com",
      user: "",
      password: "",
      defaultTopic: "alerts",
      topics: ["alerts"],
      topicGroups: {},
    };
  }

  function makeNdjsonResponse(messages: object[]): Response {
    const body = messages.map((m) => JSON.stringify(m)).join("\n");
    return new Response(body, { status: 200 });
  }

  it("displays new messages and stops when signal is aborted", async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    const newMsg = {
      id: "new1",
      time: nowSec + 1,
      event: "message",
      topic: "alerts",
      message: "Hello from watch",
    };

    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeNdjsonResponse([newMsg])
    );

    const outputLines: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        if (typeof chunk === "string") outputLines.push(chunk);
        return true;
      }
    );

    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as unknown as ReturnType<typeof Bun.spawn>);

    const onceSpy = spyOn(process, "once").mockReturnValue(process);

    const controller = new AbortController();
    const profile = makeProfile();

    // Start loop with long interval (won't repoll) and abort signal
    const loopPromise = watchLoop(profile, ["alerts"], {
      intervalSeconds: 3600,
      noSound: true,
      signal: controller.signal,
    });

    // Give the first poll time to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the new message was displayed
    const allOutput = outputLines.join("");
    expect(allOutput).toContain("Hello from watch");

    // Abort the loop - the abort-aware sleep will resolve immediately,
    // allowing the loop to exit on the next signal check.
    controller.abort();

    // Now the sleep is abort-aware, so we can await the loop to completion.
    await loopPromise;

    fetchSpy.mockRestore();
    stdoutSpy.mockRestore();
    spawnSpy.mockRestore();
    onceSpy.mockRestore();
  });

  it("does not call Bun.spawn when noSound is true", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const newMsg = {
      id: "snd1",
      time: nowSec + 1,
      event: "message",
      topic: "alerts",
      message: "Sound test",
    };

    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeNdjsonResponse([newMsg])
    );

    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as unknown as ReturnType<typeof Bun.spawn>);

    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    const onceSpy = spyOn(process, "once").mockReturnValue(process);

    const controller = new AbortController();
    const profile = makeProfile();

    const loopPromise = watchLoop(profile, ["alerts"], {
      intervalSeconds: 3600,
      noSound: true,
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // No audio player should have been invoked
    expect(spawnSpy.mock.calls.length).toBe(0);

    controller.abort();
    await loopPromise;

    fetchSpy.mockRestore();
    spawnSpy.mockRestore();
    stdoutSpy.mockRestore();
    onceSpy.mockRestore();
  });
});
