# opencode-studio

One plugin for remote dev, orchestration, search, tasks, and quality — **no extra MCPs required**.

```json
{ "plugins": ["opencode-studio"] }
```

## Automatic (zero config)

| On session start | What happens |
|------------------|--------------|
| SSH | Auto-detected from `~/.ssh/config` |
| Project | Git repo → mapped to `/home/{user}/{project-name}` on VPS |
| Sync | Starts for current repo |
| Tunnel | Starts if SSH configured |
| Subagents | 6 specialists injected |
| Compression | Large tool outputs shrunk + cached |
| `.gitignore` | `.studio/` added automatically (not committed unless you ask) |

## How agents should work

1. **Research first** — official docs + real examples (`studio_search`, `@studio-research`)
2. **Plan** — `studio_plan` with research notes, edge cases, tests
3. **Track** — `studio_task` boulder (finish all before stopping)
4. **Verify** — `studio_verify` before done
5. **Ask** — built-in `question` tool when a decision is needed (unless you said not to)
6. **Remember** — `studio_remember` when you say "remember …" (persisted rules)

Say **`start-work`** or **`/start-work`** for the full workflow.

## Native tools (replace MCPs)

| Tool | Replaces |
|------|----------|
| `studio_search` | DuckDuckGo / search MCPs |
| `studio_fetch` | fetch MCP |
| `studio_code_search` | grep.app MCP |
| `studio_retrieve` | Headroom-style full retrieval |
| `studio_task` | Boulder / todo tracking |
| `studio_plan` | Structured plans in `.studio/plans/` |
| `studio_verify` | CI runner (test/lint/build) |
| `studio_handoff` | Completion reports |
| `studio_diagram` | Mermaid architecture diagrams |
| `studio_preferences` | Remote path & `.studio/` git policy |
| `studio_remember` | Persistent rules when you say "remember …" |
| `studio_sync_*` / `studio_tunnel_*` | Remote dev |

Built-in **`question`** tool is enabled for structured user decisions.

## Subagents

`@studio-explore` `@studio-implement` `@studio-review` `@studio-research` `@studio-remote` `@studio-verify`

Use OpenCode's **task** tool for parallel background work. Say `ultrawork` to trigger parallel mode.

## Slash commands

`/start-work` `/research` `/deep-dive` `/verify` `/plan` `/handoff`

## Preferences

| Setting | Default | Change |
|---------|---------|--------|
| Remote path | `/home/{ssh.user}/{project-name}` | `studio_preferences` action `set_remote_path` |
| Commit `.studio/` | No (gitignored) | `studio_preferences` action `allow_studio_commit` only when you want it in git |

## `.studio/` directory (per project, local only by default)

```
.studio/
  tasks/      # boulder task JSON
  plans/      # markdown plans
  cache/      # compressed tool output
  handoffs/   # completion reports
  diagrams/   # mermaid files
  remember.md # user rules ("remember …")
  architecture.md  # active plan structure (auto-synced from plan)
  boulder.json
```

Excluded from sync and git by default. Ask explicitly if you want plans/handoffs committed.

## Development

```bash
bun test && bun run build
```

MIT
