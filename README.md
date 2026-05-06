# opencode-studio

OpenCode plugin for remote development. File syncing, SSH tunnel management, and dev workflow tools. Inspired by VS Code Remote but built for AI agents.

## Quick Start

Add `opencode-studio` to your `opencode.json` plugins:

```json
{
  "plugins": ["opencode-studio"]
}
```

Then ask your AI agent to check status:

```
studio_status
```

Or start syncing a project:

```
studio_sync_start { "project": "myapp" }
```

On Windows, SSH is handled internally by `ssh2`. No WSL or system OpenSSH client required.

## Features

- **Real-time File Sync** - Pure JS sync engine. Uses chokidar for file watching, tar for bulk transfers, and SSH streams for incremental sync. No rsync needed.
- **SSH Tunnel Manager** - Auto-reconnecting SSH tunnel. Port conflict detection with automatic fallback. Replaces systemd/autossh setups.
- **8 MCP Tools** - All prefixed with `studio_` for easy discovery.
- **8 Bundled Dev Rules** - git-worktree, code-quality, security, communication, and more for consistent agent behavior.
- **Config System** - Zod-validated JSON config at `~/.config/opencode-studio/config.json`.
- **Cross-platform** - Works on Linux, macOS, and Windows (WSL). No system package dependencies beyond SSH and tar.

## Available Tools

| Tool | Description |
|------|-------------|
| `studio_status` | Show overall health: tunnel, SSH config, and configured projects |
| `studio_list_projects` | List all configured projects with local/remote paths |
| `studio_sync_start` | Start real-time file sync for a project |
| `studio_sync_stop` | Stop file sync for a project |
| `studio_tunnel_status` | Check SSH tunnel status (port, host, uptime, errors) |
| `studio_tunnel_restart` | Restart the SSH tunnel (stops existing, starts new) |
| `studio_add_project` | Configure a new project for remote sync |
| `studio_remove_project` | Remove a project configuration |

## Configuration

Config file: `~/.config/opencode-studio/config.json`

```json
{
  "ssh": {
    "user": "your-username",
    "host": "your-server",
    "identityFile": "/home/you/.ssh/id_ed25519",
    "port": 22
  },
  "tunnel": {
    "localPort": 8443,
    "remotePort": 8443,
    "host": "your-server"
  },
  "projects": {},
  "defaultExcludes": [
    ".git/",
    "node_modules/",
    "__pycache__/",
    "*.pyc",
    ".env*",
    ".venv/",
    ".mypy_cache/",
    ".pytest_cache/"
  ]
}
```

The file is created automatically on first use with sensible defaults. Use `studio_add_project` to add projects through MCP instead of editing the file by hand.

## Architecture

```
src/
  config/     Config system with Zod validation (schema, loader, defaults)
  ssh/        SSH session manager with ControlMaster multiplexing
  sync/       File watcher (chokidar) + transfer engine (tar bulk, SSH incremental)
  tunnel/     SSH tunnel manager with auto-reconnect and heartbeat monitoring
  tools/      MCP tools exposed to the AI agent
rules/        Bundled OpenCode rules and SKILL.md files for agent behavior
scripts/      Utility scripts (coexistence verification)
```

### Sync Engine

- **File watching**: chokidar with 2-second debounce, deduplicates rapid events
- **Bulk sync**: tar piped over SSH on first start (no rsync, pure Unix pipes)
- **Incremental sync**: SSH stream with atomic writes (`.tmp` + `mv` pattern)
- **Sync direction**: one-way, local to remote only
- **Exclusions**: configurable per-project, sensible defaults included

### Tunnel Manager

- **Auto-reconnect**: restarts tunnel 10 seconds after unexpected exit
- **Port conflict detection**: scans for available ports, falls back to next
- **Heartbeat monitoring**: checks tunnel liveness every 15 seconds
- **Graceful shutdown**: SIGTERM first, SIGKILL after 5 seconds

## Requirements

- **Node.js >= 20** (for chokidar native file watching)
- **SSH** with key-based authentication configured
- **tar** available on both local and remote systems (every Unix system has this)
- **OpenCode** (any recent version with plugin support)

## Windows Compatibility

Works on Windows without WSL. Uses `ssh2` (pure Node.js SSH client) - no system SSH binary needed. Bulk file sync falls back from `tar` pipe to streaming SSH SFTP on Windows.

Requirements on Windows:
- Node.js >= 20
- OpenCode (any recent version)

## FAQ

**How is this different from VS Code Remote?**
It is an OpenCode plugin. Your AI agent uses these tools directly instead of requiring a GUI editor. The agent can start sync, check tunnels, and manage projects autonomously.

**Does it work with opencode-ssh-session?**
Yes. Studio handles file sync and tunnels. The ssh-session plugin handles interactive SSH sessions. They compose naturally.

**Cross-platform?**
Yes. chokidar and SSH work on Linux, macOS, and Windows (WSL). tar is available on all of them.

**No rsync?**
Correct. Uses tar for bulk sync (available on every Unix system). Incremental sync uses SSH streams. No system packages to install.

**Is sync bidirectional?**
No. Sync is one-way from local to remote. Remote changes are not synced back. This prevents conflicts during AI agent editing sessions.

**What if the tunnel port is in use?**
The tunnel manager detects this automatically and tries the next port. It will try up to 5 ports before giving up.

## License

MIT
