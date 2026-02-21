# Software Requirements Document: ntfy-cli

**Version:** 1.0
**Date:** 2026-02-20
**Author:** PAI Architect
**Status:** Draft

---

## Table of Contents

1. [Overview and Goals](#1-overview-and-goals)
2. [Architecture Decision](#2-architecture-decision)
3. [Configuration Schema](#3-configuration-schema)
4. [Complete Command Reference](#4-complete-command-reference)
5. [Implementation Phases](#5-implementation-phases)
6. [Implementation Checklists](#6-implementation-checklists)
7. [Testing Strategy](#7-testing-strategy)
8. [Error Handling Patterns](#8-error-handling-patterns)
9. [API Reference Summary](#9-api-reference-summary)

---

## 1. Overview and Goals

### 1.1 Purpose

`ntfy-cli` is a production-quality, distributable command-line tool for interacting with ntfy push notification servers. It is the successor to a working single-file prototype (`ntfy.ts`) and is designed to be robust, ergonomic, and useful in personal automation workflows, scripting pipelines, status bars, and day-to-day SRE operations.

### 1.2 Background

The prototype (`~/.claude/Tools/ntfy/ntfy.ts`) established that the core pattern works: poll the ntfy REST API for messages, track read state with a timestamp file, and send notifications via HTTP. The production tool builds on this foundation to support multiple servers, multiple topics, proper config management, and a richer feature set.

### 1.3 Goals

**Primary Goals**

- Manage notifications across multiple named ntfy server profiles without switching environment variables.
- Track unread state per-topic, per-server, independently.
- Provide scripting-friendly output modes (`--json`, `--count`) for use in status bars and CI pipelines.
- Support long-running watch mode with audio alerts for real-time notification monitoring.

**Secondary Goals**

- Zero framework dependencies for argument parsing (manual parsing only).
- Shell completion support for bash, zsh, and fish.
- Full backward compatibility with `NTFY_*` environment variables from the prototype.
- Corporate proxy compatibility (SSL verification bypass option).

**Non-Goals**

- Web UI or browser-based interface.
- ntfy server administration (user management, access control lists, server config).
- Persistent webhook listener as a daemon/service (out of scope for CLI; `ntfy watch` is a foreground process only).
- Windows support (macOS is primary; Linux is secondary).

### 1.4 Success Criteria

- All prototype commands work identically after migration, using `NTFY_*` env vars.
- Multiple server profiles can be added, removed, listed, and switched with no manual file editing.
- `ntfy unread --count` returns a plain integer, suitable for use in Raycast, tmux status, or shell prompts.
- `ntfy watch` triggers `afplay` on macOS when new messages arrive.
- `ntfy completions zsh` emits valid zsh completion script.

---

## 2. Architecture Decision

### 2.1 Single-File vs Modular

**Decision: Modular multi-file layout compiled/run via Bun.**

Rationale:

| Factor | Single-File | Modular |
|--------|-------------|---------|
| Discoverability | Hard to navigate past ~400 lines | Each concern in its own file |
| Testability | Functions must be exported awkwardly | Modules import cleanly |
| Maintainability | Monolith grows unwieldy | Clear separation |
| Distribution | One file to copy anywhere | Requires Bun bundler step |
| Prototype parity | Matches prototype | Needs migration |

The distribution concern is resolved by using `bun build --compile` to produce a single self-contained binary. The source remains modular. During development, `bun run ntfy.ts` works because Bun resolves local imports natively.

### 2.2 Directory Layout

```
~/.claude/Tools/ntfy/
├── ntfy.ts                  # Entry point (main function, command dispatch)
├── docs/
│   └── SRD-ntfy-cli.md      # This document
├── src/
│   ├── args.ts              # Argument parsing utilities
│   ├── api.ts               # ntfy REST API client
│   ├── config.ts            # Config file loading/saving/validation
│   ├── state.ts             # Per-topic read-state tracking
│   ├── display.ts           # Terminal output formatters
│   ├── completions.ts       # Shell completion generators
│   └── watch.ts             # Long-running watch mode + audio
├── tests/
│   ├── args.test.ts
│   ├── config.test.ts
│   ├── state.test.ts
│   ├── display.test.ts
│   └── api.mock.test.ts
└── package.json
```

### 2.3 Runtime Requirements

- **Runtime:** Bun >= 1.0.0 (uses `Bun.file`, `Bun.write`, native `fetch`)
- **Language:** TypeScript, strict mode (`"strict": true` in tsconfig)
- **Node compatibility:** Not required; Bun APIs used directly
- **Distribution:** `bun build --compile ntfy.ts --outfile ntfy` produces a standalone binary

### 2.4 Key Design Constraints

- **Zero external dependencies** for core functionality (no commander, yargs, chalk, etc.)
- **ANSI color codes** implemented inline (as in prototype)
- **HTTP Basic Auth** only (no token/bearer auth implementation required in phase 1, though the API supports it)
- **JSON polling** (`?poll=1&since=<timestamp>`) — no persistent SSE/WebSocket connections except in `ntfy watch`

---

## 3. Configuration Schema

### 3.1 Config File Location

```
~/.config/ntfy-cli/config.json
```

State files (per-topic last-read timestamps) are stored alongside config:

```
~/.config/ntfy-cli/state.json
```

### 3.2 Config JSON Schema

```typescript
interface ServerProfile {
  url: string;             // e.g. "https://ntfy.example.com"
  user: string;            // Basic auth username
  password: string;        // Basic auth password (stored plaintext; file is user-owned)
  defaultTopic: string;    // Topic used when --topic not specified
  topics: string[];        // Watched topics list for this server
  topicGroups: Record<string, string[]>; // Named groups: { "alerts": ["FAST-all", "FAST-daniel"] }
  skipSSLVerification?: boolean; // Default: false
}

interface Config {
  activeProfile: string;   // Name of the currently active server profile
  profiles: Record<string, ServerProfile>; // Map of profile name -> profile
}
```

**Example config.json:**

```json
{
  "activeProfile": "home",
  "profiles": {
    "home": {
      "url": "https://ntfy.example.com",
      "user": "dan",
      "password": "hunter2",
      "defaultTopic": "FAST-daniel_elliot",
      "topics": ["FAST-daniel_elliot", "FAST-all", "homelab-alerts"],
      "topicGroups": {
        "alerts": ["FAST-all", "FAST-daniel_elliot"]
      },
      "skipSSLVerification": false
    },
    "personal": {
      "url": "https://ntfy.sh",
      "user": "",
      "password": "",
      "defaultTopic": "myrandomprivatetopic",
      "topics": ["myrandomprivatetopic"],
      "topicGroups": {}
    }
  }
}
```

### 3.3 State JSON Schema

```typescript
interface TopicState {
  lastReadTime: number;    // Unix timestamp (seconds)
  lastReadId?: string;     // Optional: last read message ID for precision
}

interface State {
  // Key format: "<profileName>/<topicName>"
  topics: Record<string, TopicState>;
}
```

**Example state.json:**

```json
{
  "topics": {
    "home/FAST-daniel_elliot": {
      "lastReadTime": 1708432800,
      "lastReadId": "k1s2t3u4v5w6"
    },
    "home/FAST-all": {
      "lastReadTime": 1708432800
    }
  }
}
```

### 3.4 Environment Variable Fallback

When no config file exists or `NTFY_URL` is set in the environment, the tool synthesizes a temporary profile from environment variables. This ensures zero-friction backward compatibility.

| Env Var | Maps To |
|---------|---------|
| `NTFY_URL` | `profile.url` |
| `NTFY_USER` | `profile.user` |
| `NTFY_PASSWORD` | `profile.password` |
| `NTFY_TOPIC` | `profile.defaultTopic` |

Env var profile is named `"env"` internally and is never written to disk.

### 3.5 Config Validation Rules

- `url` must start with `http://` or `https://`
- `url` must not have a trailing slash (normalise on save)
- `defaultTopic` must not be empty
- `user` and `password` may both be empty (anonymous access)
- `topics` list must contain at least `defaultTopic` (auto-added if missing)
- `activeProfile` must be a key that exists in `profiles`

---

## 4. Complete Command Reference

### 4.1 Global Flags

These flags are valid on any command:

| Flag | Description |
|------|-------------|
| `--server <name>` | Override active server profile for this invocation |
| `--json` | Output raw JSON instead of formatted text |
| `--no-color` | Disable ANSI color codes (auto-detected if not a TTY) |
| `--quiet`, `-q` | Minimal output (counts only, no decorations) |
| `--help`, `-h` | Show help for the current command |

### 4.2 Config Commands

#### `ntfy config add <name>`

Add or update a named server profile. Prompts interactively for missing fields.

```
ntfy config add home
ntfy config add work --url https://ntfy.company.com --user alice --password secret --topic alerts
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--url <url>` | Server URL |
| `--user <username>` | Basic auth username |
| `--password <password>` | Basic auth password |
| `--topic <topic>` | Default topic |
| `--skip-ssl` | Disable SSL certificate verification |

**Behavior:**
- If the profile already exists, merges provided flags and prompts for any not provided.
- If no flags are provided, enters interactive prompts for all fields.
- After saving, prints confirmation: `Profile "home" saved. Run: ntfy config use home`

#### `ntfy config remove <name>`

Remove a named server profile.

```
ntfy config remove personal
```

**Behavior:**
- Confirms with user before deletion: `Remove profile "personal"? [y/N]`
- If `<name>` is the active profile, also clears `activeProfile` (user must `config use` again).
- Removes associated state entries from `state.json`.

#### `ntfy config list`

List all configured server profiles.

```
ntfy config list
```

**Example output:**

```
Server Profiles:
  * home      https://ntfy.example.com  (dan)  topics: 3
    personal  https://ntfy.sh           (anon) topics: 1
    work      https://ntfy.company.com  (alice) topics: 2

Active: home
```

(`*` marks the active profile)

**With `--json`:**

```json
{
  "active": "home",
  "profiles": [
    { "name": "home", "url": "https://ntfy.example.com", "user": "dan", "topicCount": 3 },
    ...
  ]
}
```

Passwords are never included in JSON output.

#### `ntfy config use <name>`

Set the default active server profile.

```
ntfy config use work
```

**Behavior:**
- Writes updated `activeProfile` to config file.
- Prints: `Now using profile "work" (https://ntfy.company.com)`

#### `ntfy config show`

Display the current active profile's full details (without password).

```
ntfy config show
ntfy config show --server work
```

---

### 4.3 Topic Commands

#### `ntfy topics list`

List all watched topics for the current server profile.

```
ntfy topics list
ntfy topics list --server home
```

**Example output:**

```
Topics for home (https://ntfy.example.com):
  FAST-daniel_elliot  [default]
  FAST-all
  homelab-alerts

Groups:
  alerts  -> FAST-all, FAST-daniel_elliot
```

#### `ntfy topics add <topic>`

Add a topic to the watched list for the current server.

```
ntfy topics add homelab-alerts
ntfy topics add deploy-notifications --server work
```

**Behavior:**
- Appends to `topics` array in the active profile.
- Prints: `Topic "homelab-alerts" added to profile "home"`

#### `ntfy topics remove <topic>`

Remove a topic from the watched list.

```
ntfy topics remove homelab-alerts
```

**Behavior:**
- Cannot remove `defaultTopic` (prints error with suggestion to change default first).
- Removes associated state entry from `state.json`.
- Prints: `Topic "homelab-alerts" removed from profile "home"`

#### `ntfy topics group add <group-name> <topic1> [topic2...]`

Create or update a named topic group.

```
ntfy topics group add alerts FAST-all FAST-daniel_elliot
```

#### `ntfy topics group remove <group-name>`

Delete a named topic group.

```
ntfy topics group remove alerts
```

---

### 4.4 Message Commands

#### `ntfy messages` / `ntfy msg`

Show recent messages on the default (or specified) topic.

```
ntfy messages
ntfy msg
ntfy messages --topic FAST-all
ntfy messages --topic FAST-all --since 24h
ntfy messages --since 2h --priority 4
ntfy messages --json
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--topic <t>`, `-t` | profile default | Topic to fetch messages from |
| `--since <duration>`, `-s` | `12h` | Time window (e.g. `1h`, `30m`, `24h`, `2d`) or Unix timestamp |
| `--priority <level>` | none | Minimum priority filter (1-5 or name: min, low, default, high, urgent) |
| `--limit <n>` | none | Maximum number of messages to show |
| `--json` | false | Raw JSON output |

**Duration formats accepted:**
- `30s`, `5m`, `2h`, `1d`, `12h`
- Plain integers are treated as Unix timestamps (seconds)
- `all` fetches entire server cache

**Example terminal output:**

```
FAST-daniel_elliot  (3 messages)
────────────────────────────────────────────────────────────
  2026-02-20 14:32 (2m ago)  [high]
  Build Completed
  Phase 3 tests passed. Artifact uploaded.

  2026-02-20 13:45 (49m ago)
  Deploy started for v2.4.1

  2026-02-20 11:00 (3h ago)  [low]  #tag1 #tag2
  Routine health check passed
```

#### `ntfy send <message>`

Send a notification to a topic.

```
ntfy send "Deploy complete"
ntfy send "Disk full on prod-db-01" --priority urgent --title "ALERT"
ntfy send "Done" --topic FAST-all --title "Build" --tags tada,rocket
ntfy send "Retry build" --delay 10m
```

**Positional arguments:**
- All non-flag arguments are joined as the message body.

**Flags:**

| Flag | Alias | Description |
|------|-------|-------------|
| `--topic <t>` | `-t` | Override target topic |
| `--title <text>` | | Notification title |
| `--priority <level>` | `-p` | 1-5 or name (min/low/default/high/urgent) |
| `--tags <t1,t2>` | | Comma-separated tags (emoji shortcodes supported) |
| `--delay <duration>` | | Schedule delivery (e.g. `30m`, `1h`, `tomorrow, 9am`) |
| `--click <url>` | | URL to open on notification tap |
| `--attach <url>` | | External file URL to attach |
| `--markdown` | `--md` | Treat message body as Markdown |

**Success output:**

```
Sent to FAST-daniel_elliot
  Message:  Deploy complete
  ID:       k1s2t3u4v5w6
```

**With `--json`:**

```json
{
  "id": "k1s2t3u4v5w6",
  "topic": "FAST-daniel_elliot",
  "time": 1708449200,
  "event": "message",
  "message": "Deploy complete"
}
```

#### `ntfy delete <message-id>`

Delete a specific message from the server (if the server supports message deletion).

```
ntfy delete k1s2t3u4v5w6
ntfy delete k1s2t3u4v5w6 --topic FAST-all
```

**Behavior:**
- Sends a `DELETE /v1/messages/<id>` request if supported by server.
- If server returns 404 or method not allowed, prints a clear error.

---

### 4.5 Unread Commands

#### `ntfy unread`

Show unread message counts and previews across all watched topics for the current profile.

```
ntfy unread
ntfy unread --topic FAST-all
ntfy unread --count
ntfy unread --total
ntfy unread --json
ntfy unread --server home
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--topic <t>`, `-t` | Show unread only for this specific topic |
| `--count` | Print only the count for the specified topic (integer, newline-terminated) |
| `--total` | Print only the sum across all watched topics (integer, newline-terminated) |
| `--since <duration>` | Override last-read timestamp with a fixed lookback window |
| `--json` | Raw JSON output |

**Default behavior (no flags):** Polls all watched topics in the active profile in parallel, shows count per topic plus a 3-line preview of the most recent unread messages.

**Example terminal output:**

```
5 unread messages  (since last read 14:30)

  FAST-daniel_elliot: 3
    14:32 [high]  Build Completed
    14:15         Deploy started for v2.4.1
    13:45 [low]   Routine health check passed

  FAST-all: 2
    14:30 [urgent]  PROD-DB01 disk 95% full
    14:28           Scheduled maintenance window starting
```

**`--count` output (for scripting):**

```
3
```

**`--total` output:**

```
5
```

**`--json` output:**

```json
{
  "profileName": "home",
  "sinceTimestamp": 1708432800,
  "total": 5,
  "topics": [
    {
      "topic": "FAST-daniel_elliot",
      "count": 3,
      "messages": [ ... ]
    },
    {
      "topic": "FAST-all",
      "count": 2,
      "messages": [ ... ]
    }
  ]
}
```

#### `ntfy read`

Mark messages as read (update last-read timestamp).

```
ntfy read
ntfy read --topic FAST-all
ntfy read --topic FAST-all --server work
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--topic <t>` | Mark only this topic as read (all topics if omitted) |
| `--all` | Mark all watched topics on all profiles as read |

**Behavior:**
- Sets `lastReadTime` to current Unix time (seconds) in `state.json`.
- Prints: `Marked FAST-daniel_elliot as read` or `Marked 3 topics as read`

---

### 4.6 Watch Command

#### `ntfy watch`

Long-running mode that polls for new messages and triggers audio/visual alerts.

```
ntfy watch
ntfy watch --topic FAST-all
ntfy watch --topic alerts              # Topic group name
ntfy watch --interval 30
ntfy watch --sound ~/.config/ntfy-cli/sounds/ping.aiff
ntfy watch --device "External Headphones"
ntfy watch --no-sound
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--topic <t>`, `-t` | all watched topics | Topic or group name to watch |
| `--interval <seconds>` | `60` | Polling interval in seconds |
| `--sound <path>` | built-in ping | Path to audio file (aiff, mp3, wav) |
| `--device <name>` | system default | Audio output device name for `afplay` |
| `--no-sound` | false | Disable audio, display-only |
| `--priority <level>` | `1` | Minimum priority to trigger alert |

**Behavior:**
- Polls all watched topics (or specified topic/group) at the given interval.
- On new messages: prints formatted message to terminal, plays sound via `afplay` (macOS) or `sox`/`paplay` (Linux).
- Marks messages as read after display.
- Handles `SIGINT` (Ctrl-C) gracefully: prints summary of session, exits cleanly.
- Does NOT daemonize or run in background — foreground process only.

**Audio implementation:**

```
macOS:  afplay [-d <device>] <soundfile>
Linux:  sox <soundfile> -d    (via sox package)
        paplay <soundfile>    (fallback)
```

**Watch session output:**

```
Watching: FAST-daniel_elliot, FAST-all  (interval: 60s)
Press Ctrl-C to stop.

[14:32:01] FAST-daniel_elliot  [high]  Build Completed
[14:33:01] No new messages
[14:34:01] FAST-all  [urgent]  PROD-DB01 disk 95% full  *ALERT*
```

---

### 4.7 Health Command

#### `ntfy health`

Check server health for the current or all configured profiles.

```
ntfy health
ntfy health --all
ntfy health --server work
ntfy health --json
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--all` | Check all configured server profiles |
| `--json` | JSON output |

**Uses:** `GET /v1/health` endpoint.

**Example output:**

```
home  https://ntfy.example.com  healthy  v2.11.0
work  https://ntfy.company.com  healthy  v2.10.3
```

**`--all` with a failure:**

```
home      https://ntfy.example.com  healthy   v2.11.0
personal  https://ntfy.sh           healthy   v2.11.0
work      https://ntfy.company.com  UNHEALTHY (connection refused)
```

Exit code is non-zero if any checked server is unhealthy.

---

### 4.8 Version Command

#### `ntfy version`

Print the CLI version.

```
ntfy version
```

**Output:**

```
ntfy-cli v1.0.0
```

Version is baked into the source as a constant `CLI_VERSION = "1.0.0"`.

---

### 4.9 Completions Command

#### `ntfy completions <shell>`

Emit shell completion script to stdout.

```
ntfy completions bash
ntfy completions zsh
ntfy completions fish
```

**Installation instructions printed after the script:**

```
# To install:
# bash:  ntfy completions bash >> ~/.bash_completion
# zsh:   ntfy completions zsh > ~/.zsh/completion/_ntfy
# fish:  ntfy completions fish > ~/.config/fish/completions/ntfy.fish
```

Completions cover: all top-level commands, subcommands (config, topics), all flags, profile names (dynamically read from config), topic names (dynamically read from config per active profile).

---

### 4.10 Help System

- `ntfy --help` / `ntfy -h`: Top-level command listing
- `ntfy <command> --help`: Per-command detailed help
- Unknown command: prints error + "Run `ntfy --help` for usage."
- No arguments: prints top-level help (same as `--help`)

---

## 5. Implementation Phases

### Phase 1: Prototype Migration and Config Foundation

**Scope:** Migrate existing prototype to modular structure. Implement config file management. Maintain full backward compatibility.

**Duration estimate:** 3-4 hours

**Deliverables:**
- Modular file structure (`src/` layout as defined in §2.2)
- `src/config.ts` with full schema, load/save/validate
- `src/state.ts` with per-profile/per-topic read state
- `src/args.ts` with `getFlag`, `hasFlag`, positional argument extraction
- `src/api.ts` with `fetchMessages`, `sendMessage`, `checkHealth`
- `src/display.ts` with all terminal formatting helpers
- `ntfy.ts` entry point with command dispatch
- All existing commands working: `messages`, `msg`, `all`, `unread`, `send`, `read`, `health`
- Config commands: `config add`, `config remove`, `config list`, `config use`, `config show`
- `--server` global flag working
- Env var fallback working identically to prototype

**Does not include:** `topics` commands, `watch`, `completions`, `delete`, `version`

---

### Phase 2: Topic Management and Enhanced Unread

**Scope:** Full topic management. Enhanced unread with per-topic state. Filtered message fetching.

**Duration estimate:** 2-3 hours

**Deliverables:**
- `ntfy topics list`
- `ntfy topics add <topic>`
- `ntfy topics remove <topic>`
- `ntfy topics group add/remove`
- Enhanced `ntfy unread` with `--count`, `--total`, `--topic` flags
- Per-topic last-read state (reads/writes from `state.json`, not a flat timestamp file)
- `ntfy read --topic <t>` - mark specific topic as read
- `ntfy messages --priority <level>` - priority filter
- `ntfy messages --limit <n>` - result limiting
- `ntfy delete <id>` command
- `ntfy version` command
- `--no-color` global flag (auto-detect TTY)
- `--quiet` global flag

---

### Phase 3: Watch Mode and Completions

**Scope:** Long-running watch mode with audio. Shell completions.

**Duration estimate:** 2-3 hours

**Deliverables:**
- `src/watch.ts` - polling loop, new message detection, audio playback
- `ntfy watch` with all documented flags
- macOS `afplay` integration (with `--device` support)
- Linux `sox`/`paplay` fallback
- `--no-sound` option
- `src/completions.ts` - bash, zsh, fish completion generators
- `ntfy completions bash|zsh|fish`
- `ntfy health --all` (multi-server health check)
- `ntfy send --delay`, `--click`, `--attach`, `--markdown` flags

---

### Phase 4: Distribution and Polish

**Scope:** Binary distribution, documentation, quality improvements.

**Duration estimate:** 1-2 hours

**Deliverables:**
- `package.json` with `build` script: `bun build --compile ntfy.ts --outfile ntfy`
- `ntfy send --json` output (returns the server response object)
- Consistent JSON output mode across all commands
- Config validation with clear error messages
- Symlink or PATH installation instructions in README
- Migration guide from prototype (env var-only) to profile-based config
- Final polish: consistent spacing, message alignment, exit codes

---

## 6. Implementation Checklists

### Phase 1 Checklist

**Setup and Structure**
- [ ] Create `src/` directory under `~/.claude/Tools/ntfy/`
- [ ] Create `tests/` directory
- [ ] Create `package.json` with `"type": "module"` and dev scripts
- [ ] Create `tsconfig.json` with `"strict": true`, `"target": "ESNext"`, `"moduleResolution": "bundler"`

**`src/args.ts`**
- [ ] `getFlag(args, flag, alias)` - returns string value or undefined
- [ ] `hasFlag(args, flag, alias)` - returns boolean
- [ ] `getPositionals(args)` - returns non-flag arguments as string[]
- [ ] `joinPositionals(args)` - joins non-flag args as space-separated string
- [ ] Handle `--flag=value` syntax
- [ ] Handle `-f value` short-flag syntax

**`src/config.ts`**
- [ ] Define `ServerProfile` TypeScript interface
- [ ] Define `Config` TypeScript interface
- [ ] `loadConfig()` - reads `~/.config/ntfy-cli/config.json`, returns Config or null
- [ ] `saveConfig(config)` - writes config with proper file permissions (0600)
- [ ] `getActiveProfile(config)` - returns active ServerProfile or throws
- [ ] `validateProfile(profile)` - returns array of validation error strings
- [ ] `getProfileFromEnv()` - synthesizes profile from NTFY_* env vars
- [ ] `resolveProfile(config, serverOverride?)` - applies `--server` override
- [ ] `ensureConfigDir()` - creates `~/.config/ntfy-cli/` if not exists

**`src/state.ts`**
- [ ] Define `TopicState` and `State` TypeScript interfaces
- [ ] `loadState()` - reads `~/.config/ntfy-cli/state.json`
- [ ] `saveState(state)` - writes state atomically
- [ ] `getLastReadTime(state, profileName, topic)` - returns Unix timestamp or 0
- [ ] `setLastReadTime(state, profileName, topic, time?)` - updates timestamp to now or given time
- [ ] `getStateKey(profileName, topic)` - returns `"profileName/topic"` key
- [ ] Backward-compat: read `.last-read` file from old prototype location if state.json absent

**`src/api.ts`**
- [ ] Define `NtfyMessage` interface (complete: id, time, event, topic, message, title, priority, tags, click, expires, attachment)
- [ ] Define `NtfySendOptions` interface (topic, title, priority, tags, delay, click, attach, markdown)
- [ ] `authHeader(user, password)` - returns `"Basic ..."` string
- [ ] `fetchMessages(profile, topic, since, filters?)` - polls topic, returns NtfyMessage[]
- [ ] `sendMessage(profile, topic, message, options)` - POST to topic, returns NtfyMessage
- [ ] `checkHealth(profile)` - GET /v1/health, returns `{healthy, version}`
- [ ] Handle NDJSON response format (one JSON object per line)
- [ ] Filter messages where `event !== "message"`
- [ ] `skipSSLVerification` support (Bun: `{ tls: { rejectUnauthorized: false } }` in fetch options)
- [ ] Throw typed errors with HTTP status code included

**`src/display.ts`**
- [ ] Define all ANSI color constants (preserve from prototype)
- [ ] `formatTime(unix)` - relative + absolute time string
- [ ] `formatTimeShort(unix)` - HH:MM only
- [ ] `priorityBadge(priority)` - colored `[urgent]` style badge
- [ ] `formatTags(tags)` - dim `#tag1 #tag2` string
- [ ] `displayMessages(messages, topicLabel)` - full message list
- [ ] `displayUnreadSummary(topicResults)` - grouped unread summary
- [ ] `colorEnabled()` - returns false if `--no-color` set or stdout not a TTY

**`ntfy.ts` Entry Point**
- [ ] `loadEnv()` from `~/.claude/.env` (preserve from prototype)
- [ ] Top-level command dispatch switch
- [ ] `cmdMessages`, `cmdUnread`, `cmdSend`, `cmdRead`, `cmdHealth` functions
- [ ] `cmdConfigAdd`, `cmdConfigRemove`, `cmdConfigList`, `cmdConfigUse`, `cmdConfigShow`
- [ ] `showHelp()` - top-level help
- [ ] Per-command help triggered by `--help` on subcommand
- [ ] Global `--server` flag resolved before command dispatch
- [ ] Exit code 0 on success, 1 on error, 2 on usage error

**Testing - Phase 1**
- [ ] `tests/args.test.ts` - unit tests for all arg parsing functions
- [ ] `tests/config.test.ts` - unit tests for load/save/validate/env-fallback
- [ ] `tests/state.test.ts` - unit tests for read-state tracking
- [ ] `tests/display.test.ts` - unit tests for format functions (no color codes in test output)
- [ ] All prototype commands smoke-tested with real NTFY_* env vars

---

### Phase 2 Checklist

**Topic Management**
- [ ] `cmdTopicsList(profile)` - reads and displays `profile.topics` and `profile.topicGroups`
- [ ] `cmdTopicsAdd(profile, topicName)` - adds to `topics` array, saves config
- [ ] `cmdTopicsRemove(profile, topicName)` - removes from `topics`, guards against defaultTopic removal
- [ ] `cmdTopicsGroupAdd(profile, groupName, topicNames[])` - creates/updates group
- [ ] `cmdTopicsGroupRemove(profile, groupName)` - deletes group

**Enhanced Unread**
- [ ] `cmdUnread` reads state per-topic (not flat timestamp)
- [ ] `--count` flag: prints integer for specified topic only
- [ ] `--total` flag: prints sum across all watched topics
- [ ] `--topic` flag: filters to single topic
- [ ] `--since` flag: overrides last-read with fixed lookback
- [ ] Parallel fetch across all watched topics using `Promise.all`
- [ ] JSON output format as documented in §4.5

**Enhanced Read**
- [ ] `cmdRead --topic <t>` marks specific topic
- [ ] `cmdRead` with no topic marks all watched topics
- [ ] `cmdRead --all` marks all topics on all profiles

**Enhanced Messages**
- [ ] `--priority` filter applied client-side after fetch (ntfy `?filter.priority=` also exists server-side)
- [ ] `--limit <n>` slices result array after sorting by time descending
- [ ] Alias `ntfy msg` remains functional

**New Commands**
- [ ] `cmdDelete(profile, messageId, topic)` - sends DELETE request
- [ ] `cmdVersion()` - prints `ntfy-cli vX.Y.Z`
- [ ] `--quiet` global flag: suppresses decorative output
- [ ] `--no-color` global flag: disables ANSI codes, auto-detected from TTY

**Testing - Phase 2**
- [ ] `tests/api.mock.test.ts` - mock fetch, test filtering, NDJSON parsing, error handling
- [ ] Integration test: `ntfy unread --total` returns integer
- [ ] Integration test: `ntfy read --topic X` only updates X's timestamp
- [ ] Integration test: `ntfy topics add` persists to config file

---

### Phase 3 Checklist

**`src/watch.ts`**
- [ ] `watchLoop(profile, topics, options)` - main polling loop
- [ ] Track last-seen message timestamps per topic to detect new messages
- [ ] Format and print new messages to terminal with timestamp prefix
- [ ] `playSound(soundPath, device?)` - calls `afplay` on macOS
- [ ] Detect macOS vs Linux at runtime (`process.platform`)
- [ ] Linux fallback: try `sox`, then `paplay`, then warn and skip
- [ ] `--device` flag passes `-d <device>` to `afplay`
- [ ] Graceful `SIGINT` handler: print session summary (topics watched, messages seen, duration)
- [ ] `--no-sound` skips audio entirely
- [ ] `--priority` filter: skip audio for messages below threshold
- [ ] Default sound: use bundled `sounds/ping.aiff` (relative to script)

**`src/completions.ts`**
- [ ] `generateBashCompletions(config)` - emit bash completion script
- [ ] `generateZshCompletions(config)` - emit zsh `_ntfy` completion function
- [ ] `generateFishCompletions(config)` - emit fish completions
- [ ] Profile names included dynamically (read from config at generation time)
- [ ] Topic names included dynamically for `--topic` flag completions
- [ ] All commands and subcommands covered
- [ ] All flags covered

**Enhanced health**
- [ ] `cmdHealth --all` fetches all profiles in parallel
- [ ] Non-zero exit code if any profile unhealthy
- [ ] JSON output: array of `{profile, url, healthy, version, error?}`

**Enhanced send**
- [ ] `--delay <duration>` sets `X-Delay` header
- [ ] `--click <url>` sets `X-Click` header
- [ ] `--attach <url>` sets `X-Attach` header
- [ ] `--markdown` / `--md` sets `Content-Type: text/markdown`

**Testing - Phase 3**
- [ ] Unit test `playSound` with mocked `Bun.spawn`
- [ ] Unit test watch loop new-message detection logic
- [ ] Smoke test completions: validate output is parseable by bash/zsh
- [ ] Test `--delay` sets correct header in sendMessage

---

### Phase 4 Checklist

**Distribution**
- [ ] `package.json` `"build"` script: `bun build --compile ntfy.ts --outfile ntfy`
- [ ] `package.json` `"dev"` script: `bun run ntfy.ts`
- [ ] `package.json` `"test"` script: `bun test`
- [ ] Verify compiled binary works without Bun installed
- [ ] Add `ntfy` binary to `.gitignore` (built artifact)

**Polish**
- [ ] Consistent exit codes across all commands (0=ok, 1=error, 2=usage error)
- [ ] All error messages go to stderr
- [ ] All user-facing output goes to stdout
- [ ] `--json` output always goes to stdout even on error (with `{error: "..."}` structure)
- [ ] Message IDs truncated to 8 chars in display (full ID in `--json`)
- [ ] Timestamps use locale-appropriate format (configurable via locale)

**Documentation**
- [ ] Inline JSDoc on all exported functions
- [ ] README.md in `~/.claude/Tools/ntfy/` covering installation, config setup, usage examples
- [ ] Migration guide from prototype (env-var only) to named profiles

---

## 7. Testing Strategy

### 7.1 Test Framework

Use Bun's built-in test runner (`bun test`). No external test framework required.

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
```

### 7.2 Unit Tests

**`src/args.ts` tests** (`tests/args.test.ts`)

Cover all combinations of:
- `--flag value` (space-separated)
- `--flag=value` (equals-separated)
- `-f value` (short flag)
- Flag not present returns `undefined`
- `hasFlag` returns boolean correctly
- Positionals exclude all flag arguments and their values
- Empty args array returns undefined/false/empty

**`src/config.ts` tests** (`tests/config.test.ts`)

- `validateProfile` returns empty array for valid profile
- `validateProfile` catches missing URL, empty defaultTopic
- `validateProfile` normalises trailing slash from URL
- `getProfileFromEnv` returns expected profile shape when all NTFY_* vars set
- `getProfileFromEnv` returns null when NTFY_URL missing
- `loadConfig` returns null when file does not exist
- `saveConfig` writes valid JSON
- `resolveProfile` picks active profile when no override
- `resolveProfile` applies `--server` override

**`src/state.ts` tests** (`tests/state.test.ts`)

- `getLastReadTime` returns 0 for unknown key
- `setLastReadTime` updates correct key without affecting others
- `getStateKey` produces `"profile/topic"` format
- State round-trips correctly through save/load

**`src/display.ts` tests** (`tests/display.test.ts`)

- `formatTime` returns "just now" for very recent timestamps
- `formatTime` returns "Xm ago" for recent messages
- `priorityBadge` returns empty string for priority 3
- `priorityBadge` returns `[urgent]` for priority 5
- `formatTags` returns empty string for undefined/empty array
- `formatTags` returns `#tag1 #tag2` for two tags
- Test with color disabled to avoid ANSI in assertions

**`src/api.ts` tests** (`tests/api.mock.test.ts`)

Mock `fetch` globally:

```typescript
const mockFetch = mock((url: string, init?: RequestInit) => {
  return Promise.resolve(new Response(mockNdjson, { status: 200 }));
});
globalThis.fetch = mockFetch;
```

- `fetchMessages` parses NDJSON correctly
- `fetchMessages` ignores `event !== "message"` lines
- `fetchMessages` returns empty array for empty response
- `fetchMessages` throws on non-200 status
- `sendMessage` sends correct headers (Title, Priority, Tags)
- `sendMessage` sends Authorization header
- `authHeader` produces correct Base64-encoded value
- `checkHealth` returns `{healthy: false}` on non-200

### 7.3 Integration Tests

Run against a real ntfy server (using NTFY_* env vars):

```bash
bun test tests/integration/ --env NTFY_URL=... NTFY_USER=... NTFY_PASSWORD=... NTFY_TOPIC=...
```

Integration tests are opt-in and skipped when NTFY_URL is not set.

- Send a message and verify it appears in `fetchMessages`
- Verify `checkHealth` returns true against a live server
- Verify `unread` count changes after `send` and resets after `read`

### 7.4 Smoke Tests

Manual smoke tests to run before each phase completion:

```bash
# Phase 1 smoke test script
ntfy health
ntfy messages
ntfy msg --since 1h
ntfy unread
ntfy send "Test $(date)" --title "Smoke test"
ntfy unread --json
ntfy read
ntfy unread
# Should show 0 after read
```

### 7.5 Test Conventions

- Tests must not write to `~/.config/ntfy-cli/` — use temp directories (`Bun.file(tmpdir)`)
- Tests must not make real network requests — mock `fetch` in all unit tests
- Test files named `<module>.test.ts` mirroring source files
- Use `describe`/`it` blocks for organization
- Assertion style: `expect(x).toBe(y)` / `expect(x).toEqual(y)`

---

## 8. Error Handling Patterns

### 8.1 Error Categories

| Category | Handling |
|----------|----------|
| Config missing | Offer to run `ntfy config add <name>` or suggest env vars |
| Network errors | Retry once after 2s; print clear message with server URL |
| HTTP 401/403 | Print "Authentication failed" + profile name |
| HTTP 404 | Print "Topic not found" + topic name |
| HTTP 500+ | Print server error with status code |
| Invalid args | Print usage hint for the specific command, exit 2 |
| Invalid priority | List valid values (1-5 or min/low/default/high/urgent) |
| Invalid topic | List watched topics for current profile |
| Audio playback failure | Warn and continue (non-fatal) |

### 8.2 Error Output Format

All errors go to stderr. Format:

```
Error: <message>
  <optional detail line>
  <optional suggestion>
```

Example:

```
Error: Authentication failed for profile "home"
  Server returned HTTP 401
  Run: ntfy config add home --password <new-password>
```

### 8.3 Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Runtime error (network, auth, server error) |
| `2` | Usage error (bad args, missing required arg) |

`ntfy health` uses exit code `1` when server is unhealthy (non-2xx from health endpoint).
`ntfy unread` always exits `0` even when unread count is zero (count=0 is not an error).

### 8.4 Typed Error Class

```typescript
class NtfyError extends Error {
  constructor(
    message: string,
    public readonly code: "AUTH" | "NOT_FOUND" | "SERVER_ERROR" | "NETWORK" | "CONFIG" | "USAGE",
    public readonly detail?: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = "NtfyError";
  }
}
```

All API functions throw `NtfyError`. The main dispatch catches `NtfyError` and formats the error message using the `code`, `detail`, and `suggestion` fields.

### 8.5 Network Retry Logic

For transient network errors (connection refused, ETIMEDOUT):

```typescript
async function fetchWithRetry(url: string, options: RequestInit, retries = 1): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (retries > 0 && isTransientError(err)) {
      await sleep(2000);
      return fetchWithRetry(url, options, retries - 1);
    }
    throw new NtfyError(`Network error connecting to ${url}`, "NETWORK", String(err));
  }
}
```

### 8.6 Config-Not-Found Guidance

When no config file exists and no NTFY_* env vars are set:

```
Error: No server configuration found.

To get started, either:
  1. Add a server profile:
       ntfy config add home

  2. Set environment variables:
       export NTFY_URL=https://ntfy.example.com
       export NTFY_USER=myuser
       export NTFY_PASSWORD=mypassword
       export NTFY_TOPIC=mytopic
```

---

## 9. API Reference Summary

### 9.1 Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /<topic>/json?poll=1&since=<time>` | GET | Fetch messages (NDJSON) |
| `POST /<topic>` | POST | Send a message |
| `GET /v1/health` | GET | Server health check |
| `DELETE /v1/messages/<id>` | DELETE | Delete a message |

### 9.2 Authentication

HTTP Basic Auth via `Authorization: Basic <base64(user:password)>` header on all requests.

For anonymous servers, omit the Authorization header entirely.

### 9.3 NDJSON Polling Response

Each line is a JSON object. Only process lines where `event === "message"`. Other event types (`open`, `keepalive`) are silently ignored.

```
{"id":"abc123","time":1708449200,"event":"open","topic":"mytopic"}
{"id":"def456","time":1708449201,"event":"message","topic":"mytopic","message":"Hello","priority":3}
{"id":"ghi789","time":1708449260,"event":"keepalive","topic":"mytopic"}
```

### 9.4 Since Parameter Formats

| Value | Meaning |
|-------|---------|
| `10m` | Last 10 minutes |
| `2h` | Last 2 hours |
| `1d` | Last 1 day |
| `1708449200` | Since Unix timestamp |
| `all` | All cached messages |
| `latest` | Most recent message only |

### 9.5 Priority Name Aliases

| Number | Names accepted |
|--------|---------------|
| 1 | `1`, `min`, `minimum` |
| 2 | `2`, `low` |
| 3 | `3`, `default`, `normal` |
| 4 | `4`, `high` |
| 5 | `5`, `urgent`, `max`, `maximum` |

Normalise priority input to integer in `parsePriority(input: string): number`.

### 9.6 Send Request Headers

| Header | Type | Example |
|--------|------|---------|
| `Authorization` | string | `Basic YWxpY2U6aHVudGVyMg==` |
| `Title` | string | `Build Complete` |
| `Priority` | string or number | `4` or `high` |
| `Tags` | CSV string | `tada,rocket` |
| `X-Delay` | duration string | `30m` |
| `X-Click` | URL | `https://example.com` |
| `X-Attach` | URL | `https://example.com/file.pdf` |
| `Content-Type` | MIME type | `text/markdown` (for `--markdown` flag) |

Request body: plain text message string.

---

*End of SRD*
