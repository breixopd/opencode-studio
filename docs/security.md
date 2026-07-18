# Security

Studio does **not** replace OpenCode’s permission system — it layers on top.

## Three layers

```
┌─────────────────────────────────────────────┐
│ 1. OpenCode permissions (host)              │
│    allow / ask / deny on edit, bash, web…   │
├─────────────────────────────────────────────┤
│ 2. Studio remote exec policy                │
│    blocklist + optional host/prefix lists   │
├─────────────────────────────────────────────┤
│ 3. Studio budget / autonomy gates           │
│    tool blocks when over budget             │
│    confirm:true on remote when autonomy=full│
└─────────────────────────────────────────────┘
```

If something is denied, check **which layer** failed.

## Layer 1 — OpenCode permissions

Studio injects subagents with coarse `edit` / `bash` settings:

| Agents | edit | bash |
|--------|------|------|
| explore, research, architect, security, review, scout | deny | deny |
| verify | deny | allow |
| implement, remote | allow | allow |

Further restrict tools globally or per agent in `opencode.json` using OpenCode permission keys. See [OpenCode Agents — Permissions](https://opencode.ai/docs/agents/).

Prefer ask/allowlist over bypass on the host.

## Layer 2 — Remote SSH exec (`studio_remote`)

### Always blocked (substring blocklist)

From `src/tools/remote.ts`:

- `rm -rf`
- `dd `
- `mkfs`
- `shutdown`
- `reboot`
- `> /dev/`

### Optional allowlists

```text
studio_preferences set_remote_policy \
  allowed_hosts=devbox,gpu \
  allowed_command_prefixes=npm ,bun ,pytest
```

Empty allowlists = unrestricted hosts/prefixes (still subject to the blocklist).

### Autonomy = full

When allowlists are empty and autonomy is `full`, remote exec expects `confirm:true` on the tool call.

### Tunnel / sync

Tunnel auto-starts when SSH is bound (watchdog with backoff). File sync maps local → remote. Do not treat sync as a security boundary — treat remote shell as trusted-ops only.

## Layer 3 — Budget & autonomy

- **Budget exceeded** blocks many tools (cost control, not ACLs) — see [Budget](./budget.md)
- **Autonomy `full`** increases unattended action; use `suggest` or `off` on untrusted repos
- Say `don't scout` or `studio_preferences set_autonomy off`

## Data locations

| Path | Contents |
|------|----------|
| `.studio/studio.db` | Index, plans, tasks, cost events, diagnostics |
| `~/.config/opencode-studio/` | Global prefs / brief |
| `.studio/plans/` | Exported plan markdown |

Keep `.studio/` gitignored unless you explicitly allow commits via preferences.

**Web tools:** `studio_fetch` / crawl are SSRF-aware. Optional `TAVILY_API_KEY` sends queries to Tavily.

**Plugins:** OpenCode plugins run with your user privileges — audit third-party plugins before install.

## Hardening checklist

1. OpenCode: deny edit when only researching
2. Bind SSH only to intended hosts; set `allowed_hosts`
3. Set `allowed_command_prefixes` to your verify/test runners
4. Keep autonomy at `suggest` until you trust the repo
5. Set a session budget on shared machines
6. Run `studio_doctor` after config changes
7. Prefer local models for read-only subagents on sensitive code

## Dependency & secret scanning

- `studio_deps audit` — OSV.dev (keyless)
- `/security` or `@studio-security` — review pass
- `studio_constitution` — project standards injection
- Scout may surface security/deps findings when autonomy ≠ `off`

## Incident: unwanted agent action

1. Check OpenCode permission history
2. Check whether it was `studio_remote` (policy message in tool output)
3. Check autonomy mode and scout injection
4. Tighten bash/edit permissions and remote allowlists
5. Review `studio_cost` / git history for blast radius
