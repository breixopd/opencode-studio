# Budget & cost

Session spend control and the cost ledger. Implementation: `src/core/budget.ts`, `budget-intent.ts`, `studio_cost`, `studio_preferences`.

## Soft default vs confirmed

| State | Meaning |
|-------|---------|
| Soft $5 (unconfirmed) | Cap applies until you set, change, or disable |
| Explicit budget | Set via onboard / `/budget` / preferences / NL |
| Disabled (`0` / clear) | Unlimited — no tool blocking from budget |

First session: Studio prompts once — keep $5, set a custom cap, or disable.

## Set or clear

### Slash

```text
/budget 5
/budget 10
/budget off
/budget status
```

`/onboard` also walks budget + local setup.

### Preferences

```text
studio_preferences set_session_budget 5
studio_preferences set_session_budget 0    # disable
studio_preferences show
```

### Natural language

Handled by `detectBudgetIntent`:

- Set: `budget $5`, `session budget 10`, `set spend cap to 3`
- Clear: `disable budget`, `clear budget`, `unlimited budget`, `budget off`, `no spend cap`

### Setup tool

```text
studio_setup({ action: "onboard", budget_usd: 5 })
studio_setup({ action: "onboard", disable_budget: true })
```

## When the cap is exceeded

- **Tool gate** — non-allowlisted tools throw “budget exceeded”
- **Routing** — force free/local-friendly routing
- **Not yet** — hard abort of the LLM turn mid-generation (deferred; needs stronger OpenCode hooks — see [roadmap notes](./roadmap-notes.md))

Still allowed when over budget: `studio_cost`, `studio_preferences`, `studio_help`, `studio_doctor`, `studio_status`, `studio_models`, `studio_verify`, `studio_handoff`, `studio_retrieve`, `studio_memory`.

Raise with `studio_preferences set_session_budget <usd>`, or `set_session_budget 0` to clear.

**Tip:** before large exploratory loops, use `studio_preferences set_model_mode free` and/or `set_prefer_local true`.

## Cost ledger (`studio_cost`)

Captures per-message usage from OpenCode `message.updated` (idempotent on message id). Stored in `.studio/studio.db` (`cost_events`).

| Query | Call |
|-------|------|
| This session | `studio_cost` |
| All time | `studio_cost this_session=false` |
| Last 24h | `studio_cost since_hours=24` |
| Prune old rows | `studio_cost prune=true` |

Attribution includes session, agent, model, branch, and task when available.

## Model modes (related)

| Mode | Behavior |
|------|----------|
| `balanced` (default) | Cheap/local for read-only subagents; main model for implement |
| `free` | Cheapest tier everywhere |
| `quality` | Main model for all subagents |

```text
studio_preferences set_model_mode free|balanced|quality
```

## Troubleshooting

- `studio_doctor` reports whether budget was explicitly confirmed
- Empty ledger → no billed messages yet, or events not flowing
- Unexpected blocks → `studio_preferences show`, then raise or clear the budget

In-session: `studio_help topic=cost` · `topic=models`.
