export type SyncEventType = "add" | "change" | "unlink" | "addDir" | "unlinkDir"

export interface SyncEvent {
  type: SyncEventType
  path: string
  timestamp: number
}

export interface BatchEvents {
  project: string
  events: SyncEvent[]
  firstSeen: number
}
