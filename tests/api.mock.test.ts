import { describe, it, expect, spyOn, afterEach, mock } from "bun:test";
import { fetchMessages, sendMessage, authHeader, checkHealth } from "../src/api";

// ---------------------------------------------------------------------------
// Helper to create a minimal fake Response
// ---------------------------------------------------------------------------

function makeResponse(body: string, status = 200): Response {
  return new Response(body, { status, statusText: status === 200 ? "OK" : "Error" });
}

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// authHeader
// ---------------------------------------------------------------------------

describe("authHeader", () => {
  it("produces correct Basic base64 for user:password", () => {
    const header = authHeader("alice", "secret");
    const expected = "Basic " + Buffer.from("alice:secret").toString("base64");
    expect(header).toBe(expected);
  });

  it("returns empty string for anonymous (both empty)", () => {
    expect(authHeader("", "")).toBe("");
  });

  it("still encodes when only user provided", () => {
    const header = authHeader("alice", "");
    expect(header).toBe("Basic " + Buffer.from("alice:").toString("base64"));
  });
});

// ---------------------------------------------------------------------------
// fetchMessages
// ---------------------------------------------------------------------------

describe("fetchMessages", () => {
  afterEach(() => {
    // Restore any mocked fetch
    mock.restore();
  });

  it("parses NDJSON correctly and returns message events", async () => {
    const ndjson = [
      JSON.stringify({ id: "1", time: 1700000000, event: "message", topic: "alerts", message: "hello" }),
      JSON.stringify({ id: "2", time: 1700000001, event: "message", topic: "alerts", message: "world", title: "Test" }),
    ].join("\n");

    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeResponse(ndjson));

    const messages = await fetchMessages("https://ntfy.sh", "", "", "alerts", "all");

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("1");
    expect(messages[0].message).toBe("hello");
    expect(messages[1].title).toBe("Test");

    spy.mockRestore();
  });

  it("filters out non-message events (keepalive, open)", async () => {
    const ndjson = [
      JSON.stringify({ id: "k1", time: 1700000000, event: "keepalive", topic: "alerts" }),
      JSON.stringify({ id: "m1", time: 1700000001, event: "message", topic: "alerts", message: "real" }),
      JSON.stringify({ id: "o1", time: 1700000002, event: "open", topic: "alerts" }),
    ].join("\n");

    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeResponse(ndjson));

    const messages = await fetchMessages("https://ntfy.sh", "", "", "alerts", "all");

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("m1");
    expect(messages[0].message).toBe("real");

    spy.mockRestore();
  });

  it("returns empty array for empty response body", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeResponse(""));

    const messages = await fetchMessages("https://ntfy.sh", "", "", "alerts", "all");

    expect(messages).toHaveLength(0);

    spy.mockRestore();
  });

  it("returns empty array when all lines are whitespace", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeResponse("   \n\n  "));

    const messages = await fetchMessages("https://ntfy.sh", "", "", "alerts", "all");

    expect(messages).toHaveLength(0);

    spy.mockRestore();
  });

  it("throws on non-200 HTTP status", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeResponse("Unauthorized", 401));

    await expect(
      fetchMessages("https://ntfy.sh", "bad", "creds", "alerts", "all")
    ).rejects.toThrow("401");

    spy.mockRestore();
  });

  it("passes Authorization header when credentials provided", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeResponse(""));

    await fetchMessages("https://ntfy.sh", "alice", "secret", "alerts", "all");

    const [_url, init] = spy.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    const expected = "Basic " + Buffer.from("alice:secret").toString("base64");
    expect(headers["Authorization"]).toBe(expected);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

describe("sendMessage", () => {
  afterEach(() => {
    mock.restore();
  });

  it("POSTs to the correct URL", async () => {
    const returned: import("../src/api").NtfyMessage = {
      id: "abc", time: 1700000000, event: "message", topic: "alerts", message: "hi",
    };
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeJsonResponse(returned));

    await sendMessage("https://ntfy.sh", "", "", "alerts", "hi");

    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.sh/alerts");

    spy.mockRestore();
  });

  it("sends Title header when title option is set", async () => {
    const returned: import("../src/api").NtfyMessage = {
      id: "abc", time: 1700000000, event: "message", topic: "alerts",
    };
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeJsonResponse(returned));

    await sendMessage("https://ntfy.sh", "", "", "alerts", "body", { title: "My Alert" });

    const [_url, init] = spy.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Title"]).toBe("My Alert");

    spy.mockRestore();
  });

  it("sends Priority header when priority option is set", async () => {
    const returned: import("../src/api").NtfyMessage = {
      id: "abc", time: 1700000000, event: "message", topic: "alerts",
    };
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeJsonResponse(returned));

    await sendMessage("https://ntfy.sh", "", "", "alerts", "body", { priority: 5 });

    const [_url, init] = spy.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Priority"]).toBe("5");

    spy.mockRestore();
  });

  it("sends Tags header when tags option is set", async () => {
    const returned: import("../src/api").NtfyMessage = {
      id: "abc", time: 1700000000, event: "message", topic: "alerts",
    };
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeJsonResponse(returned));

    await sendMessage("https://ntfy.sh", "", "", "alerts", "body", { tags: "warning,critical" });

    const [_url, init] = spy.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Tags"]).toBe("warning,critical");

    spy.mockRestore();
  });

  it("returns the NtfyMessage from the server response", async () => {
    const returned: import("../src/api").NtfyMessage = {
      id: "xyz", time: 1700000000, event: "message", topic: "alerts", message: "hi",
    };
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeJsonResponse(returned));

    const result = await sendMessage("https://ntfy.sh", "", "", "alerts", "hi");

    expect(result.id).toBe("xyz");
    expect(result.message).toBe("hi");

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// checkHealth
// ---------------------------------------------------------------------------

describe("checkHealth", () => {
  afterEach(() => {
    mock.restore();
  });

  it("returns healthy: true when server reports healthy", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse({ healthy: true, version: "2.8.0" })
    );

    const result = await checkHealth("https://ntfy.sh", "", "");

    expect(result.healthy).toBe(true);
    expect(result.version).toBe("2.8.0");

    spy.mockRestore();
  });

  it("returns healthy: false on non-200 response", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(makeResponse("", 500));

    const result = await checkHealth("https://ntfy.sh", "", "");

    expect(result.healthy).toBe(false);

    spy.mockRestore();
  });

  it("returns healthy: false when fetch throws (network error)", async () => {
    const spy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const result = await checkHealth("https://ntfy.sh", "", "");

    expect(result.healthy).toBe(false);

    spy.mockRestore();
  });

  it("returns healthy: false when server says healthy: false", async () => {
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse({ healthy: false })
    );

    const result = await checkHealth("https://ntfy.sh", "", "");

    expect(result.healthy).toBe(false);

    spy.mockRestore();
  });
});
