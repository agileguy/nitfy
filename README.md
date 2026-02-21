# nitfy

A fast, zero-dependency CLI client for [ntfy](https://ntfy.sh) - the simple HTTP push notification service.

Works with self-hosted ntfy servers and ntfy.sh. Supports named profiles, topic groups, watch mode with audio alerts, and shell completions.

## Installation

### Run with Bun (no build step)

```bash
git clone https://github.com/agileguy/nitfy
cd nitfy
bun install
bun run ntfy.ts messages
```

Add a shell alias for convenience:

```bash
alias ntfy='bun run /path/to/nitfy/ntfy.ts'
```

### Compile to a standalone binary

Requires Bun 1.0+. The compiled binary runs without Bun installed.

```bash
bun run build
# produces: ./ntfy
cp ntfy /usr/local/bin/
```

The `ntfy` binary is excluded from version control via `.gitignore`.

## Quick Start

### Option A: Environment variables (simplest)

Set these in your shell profile or `~/.claude/.env`:

```bash
export NTFY_URL=https://ntfy.sh
export NTFY_TOPIC=my-alerts
export NTFY_USER=alice          # optional for private topics
export NTFY_PASSWORD=secret     # optional for private topics
```

Then use the CLI immediately:

```bash
ntfy messages
ntfy send "Hello from ntfy"
ntfy health
```

### Option B: Named profiles (recommended)

Create a named profile for persistent, multi-server configuration:

```bash
ntfy config add home \
  --url https://ntfy.example.com \
  --user alice \
  --password secret \
  --topic alerts
```

The first profile added becomes the active profile automatically.

## Configuration

Configuration is stored at `~/.config/ntfy-cli/config.json` (mode 0600). State (last-read timestamps) is stored at `~/.config/ntfy-cli/state.json`.

### Profile commands

```bash
# Add a profile
ntfy config add <name> --url <url> [--user <user>] [--password <pass>] --topic <topic>

# List all profiles
ntfy config list

# Switch active profile
ntfy config use <name>

# Show active profile (password masked)
ntfy config show

# Remove a profile
ntfy config remove <name>
```

### Example: multiple servers

```bash
ntfy config add home \
  --url https://ntfy.home.example.com \
  --user dan \
  --password s3cr3t \
  --topic alerts

ntfy config add work \
  --url https://ntfy.sh \
  --user work-user \
  --password work-pass \
  --topic work-alerts

ntfy config add public --url https://ntfy.sh --topic public-announcements

# Use work by default
ntfy config use work

# Override per-command
ntfy messages --server home
ntfy send "Deploy done" --server work
```

## Commands Reference

All commands support `--server <name>` to override the active profile, `--json` for machine-readable output, `--no-color` to strip ANSI codes, and `--quiet` / `-q` to suppress decorative output.

### messages / msg

Fetch and display messages for a topic.

```bash
ntfy messages
ntfy messages --topic alerts
ntfy messages --since 6h
ntfy messages --since 24h --priority high
ntfy messages --limit 10
ntfy messages --json
ntfy msg --topic alerts --since 1h --limit 5
```

Flags:
- `--topic / -t <topic>` - Topic to fetch (defaults to profile defaultTopic)
- `--since / -s <duration>` - How far back to fetch: `1h`, `6h`, `24h`, `2d`, `7d`, `all` (default: `12h`)
- `--priority <level>` - Filter to messages at or above priority level (1-5 or min/low/default/high/urgent)
- `--limit <n>` - Show only the most recent N messages

### all

Alias that fetches the `FAST-all` topic if present in the profile, otherwise the first configured topic.

```bash
ntfy all
ntfy all --since 2h
```

### unread

Show messages received since the last time `ntfy read` was run, across all watched topics.

```bash
ntfy unread
ntfy unread --topic alerts
ntfy unread --since 6h
ntfy unread --json
ntfy unread --count          # print integer count for single topic
ntfy unread --total          # print total count across all topics
```

Flags:
- `--topic <topic>` - Check only this topic
- `--since <duration>` - Override since period (ignores last-read timestamp)
- `--count` - Print count as plain integer (per topic or total)
- `--total` - Print total count across all topics as integer

### send

Send a notification message to a topic.

```bash
ntfy send "Backup completed"
ntfy send "Deploy failed" --title "CI Alert" --priority urgent
ntfy send "Weekly report" --topic reports --tags "report,weekly"
ntfy send "Reminder" --delay 30m
ntfy send "Click me" --click https://example.com
ntfy send "**Bold** text" --markdown
```

Flags:
- `--topic / -t <topic>` - Destination topic (defaults to profile defaultTopic)
- `--title <title>` - Notification title
- `--priority / -p <level>` - Priority: `1`-`5` or `min`, `low`, `default`, `high`, `urgent`
- `--tags <tags>` - Comma-separated tags (displayed as emoji on mobile)
- `--delay <duration>` - Schedule delivery: `30s`, `1m`, `5m`, `30m`, `1h`, `3h`, `12h`
- `--click <url>` - URL to open when notification is tapped
- `--attach <url>` - URL of an attachment
- `--markdown / --md` - Render message body as Markdown

### read

Mark topic(s) as read by updating the last-read timestamp. Affects what `ntfy unread` shows next time.

```bash
ntfy read                    # mark all profile topics as read
ntfy read --topic alerts     # mark only one topic
ntfy read --all              # mark all topics on all profiles
```

### unread workflow example

```bash
ntfy unread         # see what's new
ntfy read           # mark all as read
ntfy unread         # now shows 0
```

### watch

Poll topics for new messages in real time and play an audio alert on arrival. Press Ctrl+C to stop and see a session summary.

```bash
ntfy watch
ntfy watch --topic alerts
ntfy watch --group critical       # watch a named topic group
ntfy watch --interval 30          # poll every 30 seconds (default: 60)
ntfy watch --no-sound             # disable audio
ntfy watch --sound /path/to/ping.wav
ntfy watch --device "Built-in Output"   # macOS audio device
ntfy watch --priority high        # only play sound for high+ priority
```

Flags:
- `--topic / -t <topic>` - Watch a specific topic
- `--group <name>` - Watch a named topic group
- `--interval <seconds>` - Polling interval in seconds (default: 60)
- `--no-sound` - Disable audio notifications
- `--sound <path>` - Path to a custom sound file
- `--device <name>` - Audio output device (macOS `afplay -d`)
- `--priority <level>` - Minimum priority to trigger audio (default: all)

Audio playback uses `afplay` on macOS and tries `play` (sox) then `paplay` on Linux. Audio failures are non-fatal.

### health

Check server health and version.

```bash
ntfy health
ntfy health --json
ntfy health --all          # check all configured profiles in parallel
```

Exit code 1 if the server is unhealthy.

### delete

Delete a message by its globally-unique message ID.

```bash
ntfy delete abc12345
ntfy delete abc12345 --topic alerts
```

Message IDs are shown in `--json` output. The `--topic` flag is accepted for compatibility but not required (IDs are globally unique).

### version

```bash
ntfy version
```

### topics

Manage the list of watched topics for the active profile.

```bash
ntfy topics list                           # show topics and groups
ntfy topics list --json
ntfy topics add work-alerts                # add to watch list
ntfy topics remove old-alerts              # remove from watch list
ntfy topics group add critical alerts ops  # create group "critical" with two topics
ntfy topics group remove critical
```

### completions

Generate shell completion scripts.

## Shell Completions

Shell completions are dynamically populated with your current profile names and topic names.

### Bash

```bash
ntfy completions bash >> ~/.bash_completion
# or system-wide:
ntfy completions bash > /etc/bash_completion.d/ntfy
```

### Zsh

```bash
ntfy completions zsh > "${fpath[1]}/_ntfy"
# then reload:
autoload -U compinit && compinit
```

### Fish

```bash
ntfy completions fish > ~/.config/fish/completions/ntfy.fish
```

## Watch Mode

Watch mode is designed for ambient awareness. It polls configured topics on a set interval and plays a sound when new messages arrive.

```bash
# Watch all topics in the active profile, poll every minute
ntfy watch

# Watch a topic group with faster polling
ntfy watch --group critical --interval 10

# Silence audio but still display messages
ntfy watch --no-sound

# Play a custom sound file
ntfy watch --sound ~/sounds/chime.aiff
```

Watch mode updates the last-read state just like `ntfy read` does, so `ntfy unread` will correctly exclude messages you saw in a watch session.

## Migrating from Environment Variables

The original prototype used only environment variables:

```bash
# Old approach (env-var only)
export NTFY_URL=https://ntfy.sh
export NTFY_USER=alice
export NTFY_PASSWORD=s3cr3t
export NTFY_TOPIC=my-alerts
ntfy messages
```

This still works as a fallback. But named profiles offer several advantages:

- Multiple servers with one command switch (`--server work`)
- Multiple topics per profile with unread tracking
- Named topic groups for batch monitoring
- Config stored securely at mode 0600

### Migration steps

1. Create a named profile with your existing values:

```bash
ntfy config add home \
  --url "$NTFY_URL" \
  --user "$NTFY_USER" \
  --password "$NTFY_PASSWORD" \
  --topic "$NTFY_TOPIC"
```

2. Verify the profile is active:

```bash
ntfy config list
ntfy health
```

3. Remove the env vars from your shell profile. The named profile takes precedence.

4. Add more topics and profiles as needed:

```bash
ntfy topics add secondary-topic
ntfy config add work --url https://ntfy.work.example.com --user bob --password ... --topic work-alerts
```

### Precedence order

When resolving which profile to use, nitfy follows this order:

1. `--server <name>` flag (explicit override per command)
2. Active profile from `~/.config/ntfy-cli/config.json`
3. `NTFY_URL` / `NTFY_USER` / `NTFY_PASSWORD` / `NTFY_TOPIC` environment variables

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NTFY_URL` | Server base URL (fallback when no config) |
| `NTFY_USER` | Username (fallback) |
| `NTFY_PASSWORD` | Password (fallback) |
| `NTFY_TOPIC` | Default topic (fallback) |
| `NTFY_CONFIG_DIR` | Override config directory (useful for testing) |
| `NO_COLOR` | Disable ANSI colors when set |

nitfy also reads `NTFY_*` variables from `~/.claude/.env` if that file exists, for integration with the PAI environment.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error (network, auth, server error) |
| 2 | Usage error (bad arguments, missing required argument) |

## Development

```bash
# Run tests
bun test

# Run in dev mode (no build)
bun run dev -- messages

# Build binary
bun run build
```

Tests use Bun's built-in test runner with mocked fetch. Integration tests are opt-in:

```bash
bun test tests/integration/ \
  --env NTFY_URL=... NTFY_USER=... NTFY_PASSWORD=... NTFY_TOPIC=...
```

## License

MIT
