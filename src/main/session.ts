import { DatabaseSync } from 'node:sqlite'
import type { Favourite, HistoryEntry, LaterItem, TabState } from '../shared/ipc'
import { restoreSplitTree, type SplitTree } from '../shared/split-tree.ts'

export interface SavedTab { id: string; url: string; pinned: boolean; groupId?: string | null; favicon?: string }
export interface SavedSession { tabs: SavedTab[]; activeId: string | null; closed: SavedTab[] }

function validHistoryURL(url: string): boolean {
  if (url.length > 8192 || /[\u0000-\u001f\u007f]/.test(url)) return false
  try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
}

function validTab(row: Record<string, unknown>): SavedTab | null {
  if (typeof row.id !== 'string' || !row.id || row.id.length > 128 || typeof row.url !== 'string' || row.url.length > 8192) return null
  if (row.url) { try { const url = new URL(row.url); if (url.protocol !== 'http:' && url.protocol !== 'https:') return null } catch { return null } }
  if (row.pinned !== 0 && row.pinned !== 1) return null
  const favicon = typeof row.favicon === 'string' && row.favicon.length <= 8192 ? row.favicon : ''
  const base = { id: row.id, url: row.url, pinned: row.pinned === 1, ...(favicon ? { favicon } : {}) }
  return typeof row.group_id === 'string' ? { ...base, groupId: row.group_id } : base
}

export class SessionStore {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    try {
      const check = this.db.prepare('PRAGMA quick_check').get()
      if (!check || Object.values(check)[0] !== 'ok') throw new Error('SQLite integrity check failed')
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
      if (version !== 0 && version !== 11) throw new Error('Unsupported pre-release session database')
      if (version === 0) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE windows (id TEXT PRIMARY KEY, active_tab TEXT);
        CREATE TABLE tabs (id TEXT PRIMARY KEY, window_id TEXT NOT NULL, position INTEGER NOT NULL, url TEXT NOT NULL, pinned INTEGER NOT NULL, group_id TEXT, favicon TEXT NOT NULL DEFAULT '', theme_color TEXT NOT NULL DEFAULT '');
        CREATE TABLE recently_closed (id TEXT PRIMARY KEY, window_id TEXT NOT NULL, position INTEGER NOT NULL, url TEXT NOT NULL, pinned INTEGER NOT NULL);
        CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, emoji TEXT NOT NULL DEFAULT '🌐');
        CREATE TABLE workspace_selection (window_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
        INSERT INTO workspaces VALUES ('main', 'Default', 0, '🌐');
        INSERT INTO workspace_selection VALUES ('main', 'main');
        CREATE TABLE later (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, saved_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX later_workspace ON later (workspace_id, saved_at DESC);
        CREATE TABLE favourites (id TEXT PRIMARY KEY, workspace_id TEXT, url TEXT NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL);
        CREATE UNIQUE INDEX favourite_url_scope ON favourites (COALESCE(workspace_id, ''), url);
        CREATE TABLE history (url TEXT NOT NULL, workspace_id TEXT NOT NULL, title TEXT NOT NULL, visited_at INTEGER NOT NULL, PRIMARY KEY(url, workspace_id));
        CREATE TABLE tab_navigation (tab_id TEXT PRIMARY KEY, entries TEXT NOT NULL, active_index INTEGER NOT NULL);
        CREATE TABLE split_layouts (workspace_id TEXT PRIMARY KEY, tree TEXT NOT NULL);
        CREATE TABLE tab_groups (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL);
        PRAGMA user_version = 11; COMMIT;`)
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    } catch (error) { this.db.close(); throw error }
  }
  load(windowId: string): SavedSession | null {
    const window = this.db.prepare('SELECT active_tab FROM windows WHERE id = ?').get(windowId)
    if (!window) return null
    const read = (table: 'tabs' | 'recently_closed') => this.db.prepare(`SELECT id, url, pinned${table === 'tabs' ? ', group_id, favicon, theme_color' : ''} FROM ${table} WHERE window_id = ? ORDER BY position`).all(windowId).map(validTab).filter((tab): tab is SavedTab => tab !== null)
    const tabs = read('tabs'); const closed = read('recently_closed')
    const activeId = typeof window.active_tab === 'string' && tabs.some((tab) => tab.id === window.active_tab) ? window.active_tab : tabs[0]?.id ?? null
    return { tabs, activeId, closed }
  }
  save(windowId: string, tabs: TabState[], activeId: string | null, closed: SavedTab[], splitTree?: SplitTree | null): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO windows (id, active_tab) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET active_tab = excluded.active_tab').run(windowId, activeId)
      this.db.prepare('DELETE FROM tabs WHERE window_id = ?').run(windowId)
      this.db.prepare('DELETE FROM recently_closed WHERE window_id = ?').run(windowId)
      const insert = this.db.prepare('INSERT INTO tabs (id, window_id, position, url, pinned, group_id, favicon, theme_color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      tabs.forEach((tab, index) => insert.run(tab.id, windowId, index, tab.url, tab.pinned ? 1 : 0, tab.groupId ?? null, tab.favicon ?? '', ''))
      const insertClosed = this.db.prepare('INSERT INTO recently_closed (id, window_id, position, url, pinned) VALUES (?, ?, ?, ?, ?)')
      closed.slice(0, 25).forEach((tab, index) => insertClosed.run(tab.id, windowId, index, tab.url, tab.pinned ? 1 : 0))
      if (splitTree !== undefined) {
        const valid = restoreSplitTree(splitTree, new Set(tabs.map((tab) => tab.id)))
        if (valid && valid.type === 'split') this.db.prepare('INSERT INTO split_layouts VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET tree = excluded.tree').run(windowId, JSON.stringify(valid))
        else this.db.prepare('DELETE FROM split_layouts WHERE workspace_id = ?').run(windowId)
      }
      this.db.prepare('DELETE FROM tab_navigation WHERE tab_id NOT IN (SELECT id FROM tabs)').run()
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  groups(workspaceId: string) {
    const rows = this.db.prepare('SELECT id, workspace_id, name, color, collapsed, position FROM tab_groups WHERE workspace_id = ? ORDER BY position').all(workspaceId)
    const tabIds = new Map<string, string[]>()
    if (rows.length) for (const tab of this.db.prepare('SELECT id, group_id FROM tabs WHERE window_id = ? ORDER BY position').all(workspaceId)) {
      if (typeof tab.id !== 'string' || typeof tab.group_id !== 'string') continue
      const group = tabIds.get(tab.group_id) ?? []
      group.push(tab.id); tabIds.set(tab.group_id, group)
    }
    return rows.filter((row) => typeof row.id === 'string' && typeof row.name === 'string' && typeof row.color === 'string').map((row) => ({ id: row.id as string, workspaceId, name: row.name as string, color: row.color as string, collapsed: row.collapsed === 1, position: Number(row.position), tabIds: tabIds.get(row.id as string) ?? [] }))
  }
  createGroup(workspaceId: string, id: string, name: string, color: string) { this.db.prepare('INSERT INTO tab_groups (id, workspace_id, name, color, position) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM tab_groups WHERE workspace_id = ?))').run(id, workspaceId, name, color, workspaceId) }
  updateGroup(id: string, action: 'rename' | 'color' | 'toggle' | 'delete', value = '') { if (action === 'rename') this.db.prepare('UPDATE tab_groups SET name = ? WHERE id = ?').run(value, id); else if (action === 'color') this.db.prepare('UPDATE tab_groups SET color = ? WHERE id = ?').run(value, id); else if (action === 'toggle') this.db.prepare('UPDATE tab_groups SET collapsed = 1 - collapsed WHERE id = ?').run(id); else { this.db.prepare('UPDATE tabs SET group_id = NULL WHERE group_id = ?').run(id); this.db.prepare('DELETE FROM tab_groups WHERE id = ?').run(id) } }
  setTabGroup(tabId: string, groupId: string | null, workspaceId: string) { this.db.prepare('UPDATE tabs SET group_id = ? WHERE id = ? AND window_id = ? AND pinned = 0').run(groupId, tabId, workspaceId) }
  loadSplitTree(workspaceId: string, tabIds: ReadonlySet<string>): SplitTree | null {
    const row = this.db.prepare('SELECT tree FROM split_layouts WHERE workspace_id = ?').get(workspaceId)
    if (typeof row?.tree !== 'string' || row.tree.length > 10000) return null
    try { return restoreSplitTree(JSON.parse(row.tree) as unknown, tabIds) } catch { return null }
  }
  saveNavigation(tabId: string, entries: { url: string; title: string }[], index: number): boolean {
    if (!entries.length || entries.length > 100 || !Number.isInteger(index) || index < 0 || index >= entries.length) return false
    if (entries.some((entry) => !validHistoryURL(entry.url))) return false
    return this.db.prepare('INSERT INTO tab_navigation (tab_id, entries, active_index) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM tabs WHERE id = ?) ON CONFLICT(tab_id) DO UPDATE SET entries = excluded.entries, active_index = excluded.active_index').run(tabId, JSON.stringify(entries.map(({ url, title }) => ({ url, title: title.slice(0, 1000) }))), index, tabId).changes > 0
  }
  loadNavigation(tabId: string): { entries: { url: string; title: string }[]; index: number } | null {
    const row = this.db.prepare('SELECT entries, active_index FROM tab_navigation WHERE tab_id = ?').get(tabId)
    if (!row || typeof row.entries !== 'string' || row.entries.length > 1000000 || typeof row.active_index !== 'number') return null
    try {
      const entries: unknown = JSON.parse(row.entries)
      if (!Array.isArray(entries) || !entries.length || entries.length > 100 || !Number.isInteger(row.active_index) || row.active_index < 0 || row.active_index >= entries.length) return null
      if (!entries.every((entry) => entry && typeof entry.url === 'string' && entry.url.length <= 8192 && typeof entry.title === 'string' && entry.title.length <= 1000 && validHistoryURL(entry.url))) return null
      return { entries: entries.map((entry) => ({ url: entry.url, title: entry.title })), index: row.active_index }
    } catch { return null }
  }
  moveTab(id: string, source: string, destination: string, nextActiveId: string | null): void {
    if (source === destination) throw new Error('Workspace must be different')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const target = this.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(destination)
      const tab = this.db.prepare('SELECT pinned FROM tabs WHERE id = ? AND window_id = ?').get(id, source)
      if (!target || !tab) throw new Error('Tab or Workspace no longer exists')
      const position = tab.pinned === 1
        ? Number(this.db.prepare('SELECT COALESCE(MIN(position), (SELECT COALESCE(MAX(position), -1) + 1 FROM tabs WHERE window_id = ?)) AS position FROM tabs WHERE window_id = ? AND pinned = 0').get(destination, destination)?.position)
        : Number(this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tabs WHERE window_id = ?').get(destination)?.position)
      this.db.prepare('UPDATE tabs SET position = position + 1 WHERE window_id = ? AND position >= ?').run(destination, position)
      this.db.prepare('UPDATE tabs SET window_id = ?, position = ?, group_id = NULL WHERE id = ? AND window_id = ?').run(destination, position, id, source)
      this.db.prepare('UPDATE windows SET active_tab = ? WHERE id = ?').run(nextActiveId, source)
      this.db.prepare('INSERT INTO windows (id, active_tab) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET active_tab = COALESCE(windows.active_tab, excluded.active_tab)').run(destination, id)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  later(workspaceId: string): LaterItem[] {
    return this.db.prepare('SELECT id, workspace_id, url, title, saved_at, note, done FROM later WHERE workspace_id = ? ORDER BY saved_at DESC, rowid DESC').all(workspaceId).flatMap((row) => {
      if (typeof row.id !== 'string' || typeof row.workspace_id !== 'string' || typeof row.url !== 'string' || typeof row.title !== 'string' || (typeof row.saved_at !== 'number' || !Number.isSafeInteger(row.saved_at) || row.saved_at < 0 || row.saved_at > 8640000000000000) || typeof row.note !== 'string' || (row.done !== 0 && row.done !== 1)) return []
      try { if (!['http:', 'https:'].includes(new URL(row.url).protocol)) return [] } catch { return [] }
      return [{ id: row.id, workspaceId: row.workspace_id, url: row.url, title: row.title, savedAt: row.saved_at, note: row.note, done: row.done === 1 }]
    })
  }
  saveForLater(item: LaterItem, tabId: string, activeId: string | null): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const removed = this.db.prepare('DELETE FROM tabs WHERE id = ? AND window_id = ?').run(tabId, item.workspaceId)
      if (removed.changes !== 1) throw new Error('Tab was not saved in the session')
      this.db.prepare('DELETE FROM tab_navigation WHERE tab_id = ?').run(tabId)
      this.db.prepare('INSERT INTO later (id, workspace_id, url, title, saved_at, note, done) VALUES (?, ?, ?, ?, ?, ?, ?)').run(item.id, item.workspaceId, item.url, item.title, item.savedAt, item.note, item.done ? 1 : 0)
      this.db.prepare('UPDATE windows SET active_tab = ? WHERE id = ?').run(activeId, item.workspaceId)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  updateLater(workspaceId: string, id: string, action: 'remove' | 'toggle' | 'note', note = ''): void {
    if (action === 'remove') this.db.prepare('DELETE FROM later WHERE id = ? AND workspace_id = ?').run(id, workspaceId)
    else if (action === 'toggle') this.db.prepare('UPDATE later SET done = 1 - done WHERE id = ? AND workspace_id = ?').run(id, workspaceId)
    else this.db.prepare('UPDATE later SET note = ? WHERE id = ? AND workspace_id = ?').run(note, id, workspaceId)
  }
  favourites(): Favourite[] {
    return this.db.prepare('SELECT id, workspace_id, url, title FROM favourites ORDER BY position, rowid').all().flatMap((row) => {
      if (typeof row.id !== 'string' || !(row.workspace_id === null || typeof row.workspace_id === 'string') || typeof row.url !== 'string' || typeof row.title !== 'string') return []
      try { if (!['http:', 'https:'].includes(new URL(row.url).protocol)) return [] } catch { return [] }
      return [{ id: row.id, workspaceId: row.workspace_id, url: row.url, title: row.title }]
    })
  }
  toggleFavourite(item: Favourite): void {
    const found = this.db.prepare('SELECT id FROM favourites WHERE workspace_id IS ? AND url = ?').get(item.workspaceId, item.url)
    if (found) this.db.prepare('DELETE FROM favourites WHERE id = ?').run(found.id as string)
    else this.db.prepare('INSERT INTO favourites VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM favourites WHERE workspace_id IS ?))').run(item.id, item.workspaceId, item.url, item.title, item.workspaceId)
  }
  removeFavourite(id: string): void { this.db.prepare('DELETE FROM favourites WHERE id = ?').run(id) }
  moveFavourite(id: string, direction: 'up' | 'down'): void {
    const item = this.favourites().find((entry) => entry.id === id)
    if (!item) return
    const group = this.favourites().filter((entry) => entry.workspaceId === item.workspaceId)
    const index = group.findIndex((entry) => entry.id === id); const target = index + (direction === 'up' ? -1 : 1)
    if (target < 0 || target >= group.length) return
    const current = group[index]; const other = group[target]
    if (!current || !other) return
    group[index] = other; group[target] = current
    this.db.exec('BEGIN IMMEDIATE')
    try { const update = this.db.prepare('UPDATE favourites SET position = ? WHERE id = ?'); group.forEach((entry, position) => update.run(position, entry.id)); this.db.exec('COMMIT') } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  recordHistory(workspaceId: string, url: string, title: string): void {
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) return } catch { return }
    this.db.prepare('INSERT INTO history VALUES (?, ?, ?, ?) ON CONFLICT(url, workspace_id) DO UPDATE SET title = excluded.title, visited_at = excluded.visited_at').run(url, workspaceId, title.slice(0, 1000), Date.now())
  }
  history(): HistoryEntry[] {
    return this.db.prepare('SELECT url, workspace_id, title, visited_at FROM history ORDER BY visited_at DESC LIMIT 200').all().flatMap((row) => {
      if (typeof row.url !== 'string' || typeof row.workspace_id !== 'string' || typeof row.title !== 'string' || typeof row.visited_at !== 'number') return []
      try { if (!['http:', 'https:'].includes(new URL(row.url).protocol)) return [] } catch { return [] }
      return [{ url: row.url, workspaceId: row.workspace_id, title: row.title, visitedAt: row.visited_at }]
    })
  }
  workspaces(): { id: string; name: string }[] {
    return this.db.prepare('SELECT id, name FROM workspaces ORDER BY position').all().filter((row) => typeof row.id === 'string' && typeof row.name === 'string' && row.id.length > 0 && row.name.trim().length > 0).map((row) => ({ id: row.id as string, name: row.name as string }))
  }
  workspaceSummaries(): { id: string; name: string; emoji: string }[] {
    return this.db.prepare('SELECT id, name, emoji FROM workspaces ORDER BY position').all().filter((row) => typeof row.id === 'string' && typeof row.name === 'string' && row.id.length > 0 && row.name.trim().length > 0).map((row) => ({ id: row.id as string, name: row.name as string, emoji: typeof row.emoji === 'string' && row.emoji ? row.emoji : '🌐' }))
  }
  activeWorkspace(windowId: string): string {
    const workspaces = this.workspaces()
    const selection = this.db.prepare('SELECT workspace_id FROM workspace_selection WHERE window_id = ?').get(windowId)?.workspace_id
    return workspaces.find((workspace) => workspace.id === selection)?.id ?? workspaces[0]?.id ?? 'main'
  }
  createWorkspace(id: string, name: string): void {
    this.db.prepare('INSERT INTO workspaces (id, name, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM workspaces))').run(id, name)
  }
  moveWorkspace(id: string, direction: 'up' | 'down'): void {
    const workspaces = this.workspaces(); const index = workspaces.findIndex((workspace) => workspace.id === id)
    const target = index + (direction === 'up' ? -1 : 1)
    if (index < 0 || target < 0 || target >= workspaces.length) return
    const current = workspaces[index]!; workspaces[index] = workspaces[target]!; workspaces[target] = current
    this.db.exec('BEGIN IMMEDIATE')
    try { const update = this.db.prepare('UPDATE workspaces SET position = ? WHERE id = ?'); workspaces.forEach((workspace, position) => update.run(position, workspace.id)); this.db.exec('COMMIT') } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  renameWorkspace(id: string, name: string): void { this.db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id) }
  setWorkspaceEmoji(id: string, emoji: string): void { this.db.prepare('UPDATE workspaces SET emoji = ? WHERE id = ?').run(emoji, id) }
  selectWorkspace(windowId: string, id: string): void {
    this.db.prepare('INSERT INTO workspace_selection VALUES (?, ?) ON CONFLICT(window_id) DO UPDATE SET workspace_id = excluded.workspace_id').run(windowId, id)
  }
  deleteWorkspace(windowId: string, id: string, selected: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM split_layouts WHERE workspace_id = ?').run(id)
      this.db.prepare('DELETE FROM tab_groups WHERE workspace_id = ?').run(id)
      this.db.prepare('DELETE FROM history WHERE workspace_id = ?').run(id)
      this.db.prepare('DELETE FROM favourites WHERE workspace_id = ?').run(id)
      this.db.prepare('DELETE FROM later WHERE workspace_id = ?').run(id)
      this.db.prepare('DELETE FROM tab_navigation WHERE tab_id IN (SELECT id FROM tabs WHERE window_id = ?)').run(id)
      this.db.prepare('DELETE FROM tabs WHERE window_id = ?').run(id)
      this.db.prepare('DELETE FROM recently_closed WHERE window_id = ?').run(id)
      this.db.prepare('DELETE FROM windows WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
      this.selectWorkspace(windowId, selected)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  close(): void { this.db.close() }
}
