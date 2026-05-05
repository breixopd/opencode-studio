---
name: remote-sync
description: Real-time file synchronization for remote development via opencode-studio
---

# Remote Sync

This skill guides the AI through using studio_* tools for remote file synchronization.

## Workflow

1. **List projects**: `studio_list_projects` — see what's configured
2. **Start sync**: `studio_sync_start({ project: "name" })` — begin syncing
3. **Monitor**: `studio_status` — check sync and tunnel health
4. **Stop sync**: `studio_sync_stop({ project: "name" })` — stop when done

## Best Practices

- Sync is ONE-WAY (local → remote). Remote changes are NOT synced back.
- Excluded patterns: .git, node_modules, __pycache__, .env*, .chunkhound, .venv
- Use studio_tunnel_status to check SSH connectivity before syncing
