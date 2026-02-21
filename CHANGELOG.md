# Changelog

## [1.0.0] - 2026-02-21

### Added
- Distribution: compiled binary via `bun build --compile`
- Comprehensive README.md with full command reference and migration guide
- JSDoc on all 30+ exported functions
- `send --json` returns full server response object
- Phase 4A test suite (23 tests for exit codes, error output, ID truncation)

### Fixed
- All error messages routed to stderr
- JSON error output `{"error":"..."}` on stdout when `--json` is active
- Message IDs truncated to 8 chars in display (full ID in `--json`)
- Consistent exit code 2 for all usage errors
- `health --all` with no config now errors properly

## [0.3.0] - 2026-02-21

### Added
- Watch mode: `ntfy watch` with real-time polling, audio notifications, SIGINT session summary
- Shell completions: `ntfy completions bash|zsh|fish` with dynamic profile/topic names
- Enhanced send: `--delay`, `--click`, `--attach`, `--markdown`/`--md` flags
- Enhanced health: `--all` flag for parallel multi-profile health checks
- `--sound <path>` flag for custom watch notification sound
- Default notification sound (`sounds/ping.aiff`)
- Watch persists read state to state.json after displaying messages

### Fixed
- Default watch interval set to 60s per SRD (was 10s)
- SIGINT handler uses `process.once` to prevent listener accumulation
- Abort-aware sleep for clean watch loop teardown
- `health --all` with no config file now errors properly
- Correct ntfy headers: `X-Delay`, `X-Click`, `X-Attach`, `Content-Type: text/markdown`

## [0.2.0] - 2026-02-21

### Added
- Topic management: `topics list`, `topics add`, `topics remove`
- Topic groups: `topics group add`, `topics group remove`
- Enhanced messages: `--priority` filter, `--limit` flag
- `delete` command for message removal via `/v1/messages/<id>`
- `version` command
- Enhanced `unread` with `--topic`, `--count`, `--total`, `--json` schema
- Enhanced `read` with `--topic` and `--all` flags
- `--quiet` / `-q` global flag for scriptable output
- `config list --json` support
- `displayConfigList` formatted output in display module
- Exit code 2 for usage errors (SRD §8.3)
- Priority aliases: `minimum`, `normal`, `maximum`

### Fixed
- DELETE endpoint now uses correct `/v1/messages/<id>` path
- `deleteMessage` uses shared `authHeader` from api module (DRY)
- Quiet mode applied to all topics management commands

## [0.1.0] - 2026-02-21

### Added
- Initial CLI with `messages`, `all`, `unread`, `send`, `read`, `health` commands
- Multi-server profile management (`config add/remove/list/use/show`)
- Per-topic read state tracking
- ANSI color output with `--no-color` and auto-TTY detection
- `--json` output for all data commands
- Env var fallback (NTFY_URL, NTFY_USER, NTFY_PASSWORD, NTFY_TOPIC)
- 93 unit tests across 5 test files
