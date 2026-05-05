# Changelog

## v0.1.0 (2026-05-05)

### Added

- File sync engine using chokidar for file watching with 2-second debounce and event deduplication
- Bulk sync via tar piped over SSH on first connection (no rsync dependency)
- Incremental file sync via SSH stream with atomic writes (`.tmp` + `mv` pattern)
- Remote file deletion support through SSH
- SSH tunnel manager with auto-reconnect on unexpected exit (10-second delay)
- Port conflict detection with automatic fallback across up to 5 ports
- Tunnel heartbeat monitoring every 15 seconds
- Graceful tunnel shutdown (SIGTERM then SIGKILL after 5 seconds)
- 8 MCP tools: `studio_status`, `studio_list_projects`, `studio_sync_start`, `studio_sync_stop`, `studio_tunnel_status`, `studio_tunnel_restart`, `studio_add_project`, `studio_remove_project`
- Config system with Zod validation (SSH config, tunnel config, project mappings)
- Automatic config file creation on first use at `~/.config/opencode-studio/config.json`
- Sensible default exclude patterns (`.git/`, `node_modules/`, `__pycache__/`, `.env*`, and more)
- SSH session manager with ControlMaster multiplexing for connection reuse
- Remote command execution through multiplexed SSH sessions
- File upload with atomic write pattern
- 8 bundled OpenCode dev rules (git-worktree, code-quality, security, communication, project-context, agent-files, remote-sync, git-vps-safety)
- 2 auto-discoverable SKILL.md files (remote-dev, remote-sync) for AI agent guidance
- Coexistence verification script for testing alongside legacy tunnel setups
- GitHub Actions CI workflow (build, typecheck, test on push/PR to main)
- GitHub Actions Release workflow (auto-publish to npm on version tags)
- Full test suite: tunnel manager (297 lines), sync watcher (366 lines), sync transfers (300 lines), SSH manager (158 lines), config system (277 lines), sync tool (141 lines), tunnel tool (149 lines)
