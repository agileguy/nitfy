# Changelog

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
