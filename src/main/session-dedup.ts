import type { TabState } from '../shared/ipc'
import type { SplitTree } from '../shared/split-tree'
import type { SavedTab } from './session'

// Only fields written by SessionStore.save belong in this key.
export function sessionSaveKey(tabs: TabState[], activeId: string | null, closed: SavedTab[], splitTree?: SplitTree | null): string {
  return JSON.stringify([tabs.map(({ id, url, pinned, groupId, favicon }) => [id, url, pinned, groupId ?? null, favicon ?? '']), activeId, closed.slice(0, 25).map(({ id, url, pinned }) => [id, url, pinned]), splitTree])
}
