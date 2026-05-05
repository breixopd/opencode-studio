---
name: remote-dev
description: Remote development best practices using opencode-studio
---

# Remote Development

This skill teaches the AI how to use opencode-studio for remote development workflows.

## Key Tools

- `studio_sync_start` / `studio_sync_stop` — manage file sync
- `studio_tunnel_status` / `studio_tunnel_restart` — manage SSH tunnel
- `studio_add_project` — configure new projects
- `studio_status` — check all status

## Workflow

1. **Before starting work**: Check tunnel: `studio_tunnel_status`
2. **Before editing files**: Start sync: `studio_sync_start`
3. **While working**: Files auto-sync to remote
4. **When done**: Stop sync: `studio_sync_stop`
5. **Network issues**: Use `studio_tunnel_restart` to reset

## Notes

- Sync is real-time with 2-second debounce
- Tar-based bulk sync on first start (no rsync needed)
- Cross-platform: works on Linux, macOS, Windows
