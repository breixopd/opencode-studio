interface ReminderTracking {
  commit: boolean
  sync: boolean
  "git-add": boolean
}

export function createChatMessageHook() {
  const reminded = new Map<string, Set<string>>()

  return async (input: any, output: any) => {
    const sessionID = input.sessionID
    if (!reminded.has(sessionID)) reminded.set(sessionID, new Set())
    const seen = reminded.get(sessionID)!

    const parts: any[] = output.parts || []
    const text = parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join(" ")
      .toLowerCase()

    if ((text.includes("commit") || text.includes("push")) && !seen.has("commit")) {
      seen.add("commit")
      console.log(
        "[opencode-studio] Reminder: never commit VPS configs (opencode-studio.json) or agent files (.sisyphus/, AGENTS.md)"
      )
    }

    if (text.includes("sync") && !seen.has("sync")) {
      seen.add("sync")
      console.log(
        "[opencode-studio] Reminder: use studio_sync_start / studio_sync_stop to manage file sync"
      )
    }

    if (text.includes("git add") && !seen.has("git-add")) {
      seen.add("git-add")
      console.log(
        "[opencode-studio] Reminder: check for VPS configs and agent files before git add"
      )
    }

    return output
  }
}
