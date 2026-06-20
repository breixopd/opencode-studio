const active = new Set<string>()

export function getActiveSyncProjects(): string[] {
  return [...active]
}

export function markSyncActive(name: string): void {
  active.add(name)
}

export function clearSyncActive(name: string): void {
  active.delete(name)
}

export function _resetActiveSyncForTests(): void {
  active.clear()
}
