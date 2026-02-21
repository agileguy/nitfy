/**
 * Per-topic read state management for ntfy-cli.
 * Tracks the last-read timestamp per profile+topic pair.
 * State file lives at ~/.config/ntfy-cli/state.json
 */

import { readFileSync, writeFileSync, chmodSync, existsSync } from "fs";
import { join } from "path";
import { ensureConfigDir } from "./config.js";

export interface TopicState {
  lastReadTime: number;
  lastReadId?: string;
}

export interface State {
  topics: Record<string, TopicState>;
}

function statePath(): string {
  return join(ensureConfigDir(), "state.json");
}

/**
 * Reads state from disk. Returns an empty state object if the file does
 * not exist or cannot be parsed.
 * Prints a warning to stderr for JSON parse errors (vs silent for missing file).
 */
export function loadState(): State {
  const path = statePath();
  if (!existsSync(path)) {
    return { topics: {} };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { topics: {} };
  }
  try {
    return JSON.parse(raw) as State;
  } catch {
    console.error(`Warning: state.json is corrupted and could not be parsed. Path: ${path}`);
    return { topics: {} };
  }
}

/**
 * Writes state to disk with mode 0600.
 */
export function saveState(state: State): void {
  const path = statePath();
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
  chmodSync(path, 0o600);
}

/**
 * Returns the compound key used to identify a topic within a profile.
 * Format: "profileName/topicName"
 */
export function getStateKey(profileName: string, topic: string): string {
  return `${profileName}/${topic}`;
}

/**
 * Returns the last-read unix timestamp for the given profile+topic.
 * Returns 0 if no entry exists.
 */
export function getLastReadTime(
  state: State,
  profileName: string,
  topic: string
): number {
  const key = getStateKey(profileName, topic);
  return state.topics[key]?.lastReadTime ?? 0;
}

/**
 * Updates the last-read time for a given profile+topic.
 * Uses the current time if `time` is not provided.
 * Returns the updated state (immutably - the original is not mutated).
 */
export function setLastReadTime(
  state: State,
  profileName: string,
  topic: string,
  time?: number
): State {
  const key = getStateKey(profileName, topic);
  const timestamp = time ?? Math.floor(Date.now() / 1000);
  return {
    ...state,
    topics: {
      ...state.topics,
      [key]: { lastReadTime: timestamp },
    },
  };
}
