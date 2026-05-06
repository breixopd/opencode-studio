## Implementation Notes — UX Hooks

### SDK Type Adaptation
- `chat.message` hook receives `output.message: UserMessage` which has **no `content` field** in the SDK.
  - Workaround: extract text from `output.parts` by filtering `type === "text"` and joining `.text` fields.
  - The plan used `output.message?.content` as a conceptual placeholder — adapted to SDK reality.
- `event` hook uses `input: { event: Event }` — destructured as `({ event }) => ...` matches SDK.
- `config` hook receives `(input: Config)` — fires at startup, not per-message.

### Per-Session Dedup
- Used `Map<sessionID, Set<ruleKey>>` for per-session tracking.
- Each rule reminder fires at most once per session.

### Reminder Keywords & Rules
| Keyword | Rule Referenced |
|---------|----------------|
| commit/push | git-vps-safety.mdc + agent-files.mdc |
| sync | remote-sync.mdc |
| git add | git-vps-safety.mdc |

### Build & Test
- `bun build` bundles 21 modules successfully (incl. new hooks).
- `tsc --noEmit` passes with zero errors.
- All 179 existing tests pass (0 failures across 15 files).
