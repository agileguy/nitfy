/**
 * ntfy REST API client.
 * Zero external dependencies - uses the global fetch available in Bun.
 */

export interface NtfyMessage {
  id: string;
  time: number;
  event: string;
  topic: string;
  message?: string;
  title?: string;
  priority?: number;
  tags?: string[];
  click?: string;
  expires?: number;
}

export interface NtfySendOptions {
  title?: string;
  priority?: number;
  tags?: string;
  delay?: string;
  click?: string;
  attach?: string;
  markdown?: boolean;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Build a Basic Authorization header value from credentials.
 * Returns an empty string for anonymous access (both args empty/undefined).
 */
export function authHeader(user: string, password: string): string {
  if (!user && !password) return "";
  const encoded = Buffer.from(`${user}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a server URL: trim trailing slashes.
 */
function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Build request headers shared by all authenticated requests.
 */
function buildHeaders(user: string, password: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth = authHeader(user, password);
  if (auth) {
    headers["Authorization"] = auth;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * Fetch messages from an ntfy topic using long-poll (poll=1).
 *
 * The server returns NDJSON (one JSON object per line, NOT an array).
 * Only objects where event === "message" are returned.
 *
 * @param url      - ntfy server base URL (e.g. "https://ntfy.sh")
 * @param user     - Username (empty string for anonymous)
 * @param password - Password (empty string for anonymous)
 * @param topic    - Topic name
 * @param since    - How far back to fetch: "all", ISO 8601 time, Unix timestamp,
 *                   or duration like "10m"
 */
export async function fetchMessages(
  url: string,
  user: string,
  password: string,
  topic: string,
  since: string
): Promise<NtfyMessage[]> {
  const base = normaliseUrl(url);
  const endpoint = `${base}/${encodeURIComponent(topic)}/json?poll=1&since=${encodeURIComponent(since)}`;

  const response = await fetch(endpoint, {
    headers: buildHeaders(user, password),
  });

  if (!response.ok) {
    throw new Error(
      `ntfy fetch failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const body = await response.text();

  // NDJSON: one JSON object per line
  const messages: NtfyMessage[] = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as NtfyMessage;
      } catch {
        // Skip malformed lines silently
        return null;
      }
    })
    .filter((obj): obj is NtfyMessage => obj !== null && obj.event === "message");

  return messages;
}

/**
 * Send a message to an ntfy topic.
 *
 * Supports all ntfy publish headers: title, priority, tags, delay, click,
 * attach, and markdown.
 *
 * @returns The published message object as returned by the server.
 */
export async function sendMessage(
  url: string,
  user: string,
  password: string,
  topic: string,
  message: string,
  options: NtfySendOptions = {}
): Promise<NtfyMessage> {
  const base = normaliseUrl(url);
  const endpoint = `${base}/${encodeURIComponent(topic)}`;

  const headers: Record<string, string> = {
    ...buildHeaders(user, password),
    "Content-Type": "text/plain",
  };

  if (options.title) {
    headers["Title"] = options.title;
  }
  if (options.priority !== undefined) {
    headers["Priority"] = String(options.priority);
  }
  if (options.tags) {
    headers["Tags"] = options.tags;
  }
  if (options.delay) {
    headers["X-Delay"] = options.delay;
  }
  if (options.click) {
    headers["X-Click"] = options.click;
  }
  if (options.attach) {
    headers["X-Attach"] = options.attach;
  }
  if (options.markdown) {
    headers["Content-Type"] = "text/markdown";
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: message,
  });

  if (!response.ok) {
    throw new Error(
      `ntfy send failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const result = (await response.json()) as NtfyMessage;
  return result;
}

/**
 * Delete a message by its globally-unique message ID.
 *
 * The ntfy API requires DELETE /v1/messages/<id>. Message IDs are globally
 * unique, so no topic is needed in the URL.
 *
 * @param url       - ntfy server base URL (e.g. "https://ntfy.sh")
 * @param user      - Username (empty string for anonymous)
 * @param password  - Password (empty string for anonymous)
 * @param messageId - The globally-unique message ID to delete
 */
export async function deleteMessage(
  url: string,
  user: string,
  password: string,
  messageId: string
): Promise<void> {
  const base = normaliseUrl(url);
  const endpoint = `${base}/v1/messages/${encodeURIComponent(messageId)}`;

  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: buildHeaders(user, password),
  });

  if (!response.ok) {
    throw new Error(
      `ntfy delete failed: HTTP ${response.status} ${response.statusText}`
    );
  }
}

/**
 * Check the health of an ntfy server.
 *
 * @returns Object with `healthy: boolean` and optional `version` string.
 */
export async function checkHealth(
  url: string,
  user: string,
  password: string
): Promise<{ healthy: boolean; version?: string }> {
  const base = normaliseUrl(url);
  const endpoint = `${base}/v1/health`;

  try {
    const response = await fetch(endpoint, {
      headers: buildHeaders(user, password),
    });

    if (!response.ok) {
      return { healthy: false };
    }

    const data = (await response.json()) as { healthy?: boolean; version?: string };

    return {
      healthy: data.healthy === true,
      version: data.version,
    };
  } catch {
    return { healthy: false };
  }
}
