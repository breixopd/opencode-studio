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
│    full autonomy requires risk acceptance   │
│    remote: risk accept OR confirm:true      │
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

When allowlists are empty and autonomy is `full`, unrestricted remote exec is allowed if:

1. **User risk accepted** (`accept_autonomy_risk` / say "I accept the risk"), **or**
2. **`confirm:true`** on the tool call

`confirm` is **agent-supplied** (not host HITL). User risk acceptance is the real acknowledgment. Studio always emits a warning when unrestricted.

### Tunnel / sync

Tunnel auto-starts when SSH is bound (watchdog with backoff). File sync maps local → remote. Do not treat sync as a security boundary — treat remote shell as trusted-ops only.

## Layer 3 — Budget & autonomy

- **Budget exceeded** blocks many tools (cost control, not ACLs) — see [Budget](./budget.md)
- **Autonomy `full`** requires explicit risk acceptance first (`accept_risk:true`, `accept_autonomy_risk`, or NL). Increases unattended action; use `suggest` or `off` on untrusted repos
- Say `don't scout` or `studio_preferences set_autonomy off`
- Revoke risk with `clear_autonomy_risk` or say `revoke autonomy risk` (acceptance is kept when leaving full until cleared)

## Data locations

| Path | Contents |
|------|----------|
| `.studio/studio.db` | Index, plans, tasks, cost events, diagnostics |
| `~/.config/opencode-studio/` | Global prefs / brief |
| `.studio/plans/` | Exported plan markdown |

Keep `.studio/` gitignored unless you explicitly allow commits via preferences.

**Web tools:** `studio_fetch` / crawl are SSRF-aware. Optional `TAVILY_API_KEY` sends queries to Tavily.

**GitHub auth:** `studio_code_search`, `studio_git` push/PR, and `studio_ci` use (in order) `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` from your system `gh auth login`. No separate Studio-only credential.

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
- **Compress cache** — large tool outputs are redacted for AWS keys (`AKIA…`), OpenAI `sk-…`, GitHub `ghp_…`, PEM private keys, and `Bearer` tokens before writing `.studio/cache/`

## Browser verify (`studio_browser`)

- Only `127.0.0.1` / `localhost` URLs (not `0.0.0.0`)
- CDP uses an ephemeral free port on loopback (not fixed 9333)
- Chrome launch tries sandboxed first; falls back to `--no-sandbox` only if needed

## Verify shell

- `bun` / `npm` / `pnpm` / `yarn` / `deno` commands spawn with `shell:false` (argv) first
- Other ecosystems still use `shell:true`

## Incident: unwanted agent action

1. Check OpenCode permission history
2. Check whether it was `studio_remote` (policy message in tool output)
3. Check autonomy mode and scout injection
4. Tighten bash/edit permissions and remote allowlists
5. Review `studio_cost` / git history for blast radius
