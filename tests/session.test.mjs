import { test } from 'node:test'
import { browserShortcut } from '../src/main/shortcuts.ts'
import { spawnSync } from 'node:child_process'
import { groupPinnedTabs, reorderTabs } from '../src/shared/tab-order.ts'
import { isTabCommand, isViewBounds, isWebURL } from '../src/main/security.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { searchSavedPages } from '../src/shared/search.ts'
import { ProfileRegistry } from '../src/main/profiles.ts'
import { SessionStore } from '../src/main/session.ts'
import { sessionSaveKey } from '../src/main/session-dedup.ts'
import { peekBounds } from '../src/shared/peek-layout.ts'
import { PeekNavigationGuard } from '../src/main/peek-navigation.ts'
import { popupRoute } from '../src/main/popup-policy.ts'

test('Workspace order persists and rejects invalid moves', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-workspace-order-'))
  try {
    const path = join(dir, 'session.sqlite'); let store = new SessionStore(path)
    store.createWorkspace('second', 'Second'); store.createWorkspace('third', 'Third')
    store.setWorkspaceEmoji('third', '🌱'); store.moveWorkspace('third', 'up'); store.moveWorkspace('missing', 'up')
    assert.equal(isTabCommand({ type: 'workspace-move', id: 'third', direction: 'up' }), true)
    assert.equal(isTabCommand({ type: 'workspace-move', id: 'third', direction: 'sideways' }), false)
    store.close(); store = new SessionStore(path)
    assert.deepEqual(store.workspaceSummaries().map(({ id }) => id), ['main', 'third', 'second'])
    assert.equal(store.workspaceSummaries().find(({ id }) => id === 'third')?.emoji, '🌱')
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('group membership and Workspace summaries retain order and isolation', () => {
  const store = new SessionStore(':memory:')
  try {
    store.createWorkspace('other', 'Other')
    store.setWorkspaceEmoji('other', '🌱')
    store.createGroup('main', 'first', 'First', '#55766b')
    store.createGroup('main', 'second', 'Second', '#55766b')
    store.createGroup('other', 'third', 'Third', '#55766b')
    store.save('main', [
      { id: 'a', url: 'https://example.com/a', pinned: false, groupId: 'second' },
      { id: 'b', url: 'https://example.com/b', pinned: false, groupId: 'first' },
      { id: 'c', url: 'https://example.com/c', pinned: false, groupId: 'second' },
      { id: 'd', url: 'https://example.com/d', pinned: false }
    ], 'a', [])
    store.save('other', [{ id: 'e', url: 'https://example.com/e', pinned: false, groupId: 'third' }], 'e', [])
    assert.deepEqual(store.groups('main').map(({ id, tabIds }) => ({ id, tabIds })), [{ id: 'first', tabIds: ['b'] }, { id: 'second', tabIds: ['a', 'c'] }])
    assert.deepEqual(store.groups('other').map(({ tabIds }) => tabIds), [['e']])
    assert.equal(store.workspaceSummaries().find(({ id }) => id === 'other')?.emoji, '🌱')
    assert.deepEqual(store.workspaceSummaries().map(({ id, name }) => ({ id, name })), store.workspaces())
  } finally { store.close() }
})

test('popup routing keeps tab gestures separate from opener-dependent windows', () => {
  assert.equal(popupRoute('https://example.com/', 'foreground-tab', false), 'tab')
  assert.equal(popupRoute('https://example.com/', 'background-tab', false), 'tab')
  assert.equal(popupRoute('https://example.com/', 'default', false), 'window')
  assert.equal(popupRoute('about:blank', 'default', false), 'window')
  assert.equal(popupRoute('https://example.com/', 'foreground-tab', true), 'window')
  assert.equal(popupRoute('mailto:user@example.com', 'default', false), 'external')
})

test('Peek navigation guard cancels only the matching source and destination once', () => {
  const guard = new PeekNavigationGuard()
  guard.arm('source', 'https://example.com/', 1000)
  assert.equal(guard.consume('other', 'https://example.com/', 1001), false)
  assert.equal(guard.consume('source', 'https://other.example/', 1001), false)
  assert.equal(guard.consume('source', 'https://example.com/', 1001), true)
  assert.equal(guard.consume('source', 'https://example.com/', 1002), false)
  guard.arm('source', 'https://example.com/', 1000)
  assert.equal(guard.consume('source', 'https://example.com/', 2501), false)
})
import { isCrossSiteLink, shouldPeekLink } from '../src/shared/peek-link.ts'

test('Peek modes choose normal or Alt clicks without changing same-site automatic navigation', () => {
  const source = 'https://en.wikipedia.org/'
  assert.equal(shouldPeekLink('automatic', false, source, 'https://google.com/'), true)
  assert.equal(shouldPeekLink('automatic', true, source, 'https://google.com/'), false)
  assert.equal(shouldPeekLink('automatic', false, source, 'https://fr.wikipedia.org/'), false)
  assert.equal(shouldPeekLink('manual', false, source, 'https://google.com/'), false)
  assert.equal(shouldPeekLink('manual', true, source, 'https://fr.wikipedia.org/'), true)
  assert.equal(shouldPeekLink('manual', true, source, 'javascript:alert(1)'), false)
})

test('Peek mode is saved separately per Profile', () => {
  const registry = new ProfileRegistry(':memory:')
  try {
    const ids = registry.list().map((profile) => profile.id)
    assert.equal(registry.peekMode(ids[0]), 'automatic')
    registry.setPeekMode(ids[0], 'manual')
    assert.equal(registry.peekMode(ids[0]), 'manual')
    assert.equal(registry.peekMode(ids[1]), 'automatic')
  } finally { registry.close() }
})

test('Peek site comparison respects public and private suffixes', () => {
  assert.equal(isCrossSiteLink('https://en.wikipedia.org/wiki/A', 'https://www.google.com/'), true)
  assert.equal(isCrossSiteLink('https://en.wikipedia.org/', 'https://fr.wikipedia.org/'), false)
  assert.equal(isCrossSiteLink('https://a.example.co.uk/', 'https://b.example.co.uk/'), false)
  assert.equal(isCrossSiteLink('https://a.github.io/', 'https://b.github.io/'), true)
  assert.equal(isCrossSiteLink('https://example.com/', 'mailto:test@example.com'), false)
  assert.equal(isCrossSiteLink('https://localhost/', 'https://example.com/'), false)
})

test('Peek toolbar and webpage fit inside their source pane without overlap', () => {
  for (const area of [{ x: 100, y: 80, width: 800, height: 600 }, { x: 30, y: 40, width: 180, height: 100 }, { x: 0, y: 0, width: 8, height: 8 }]) {
    const { toolbar, page } = peekBounds(area)
    assert.equal(page.y, toolbar.y + toolbar.height)
    assert.equal(page.x, toolbar.x)
    assert.ok(toolbar.width <= page.width)
    assert.ok(page.x >= area.x && page.y + page.height <= area.y + area.height)
    assert.ok(page.x + page.width <= area.x + area.width)
  }
})

test('Peek commands accept only bounded web addresses and valid source IDs', () => {
  assert.equal(isTabCommand({ type: 'peek-open', id: 'tab-1', url: 'https://example.com/' }), true)
  assert.equal(isTabCommand({ type: 'peek-open', id: 'tab-1', url: 'file:///secret' }), false)
  assert.equal(isTabCommand({ type: 'peek-open', id: '', url: 'https://example.com/' }), false)
  assert.equal(isTabCommand({ type: 'peek-close', id: 'tab-1' }), true)
  assert.equal(isTabCommand({ type: 'peek-close', id: '' }), false)
  assert.equal(isTabCommand({ type: 'peek-expand' }), true)
})

const tab = (id, url, pinned = false) => ({ id, url, pinned, title: id, favicon: '', loading: false, canGoBack: false, canGoForward: false, error: '' })

test('session dedup ignores transient UI metadata but detects persisted changes', () => {
  const original = tab('a', 'https://example.com/')
  const key = sessionSaveKey([original], 'a', [], null)
  assert.equal(sessionSaveKey([{ ...original, loading: true, title: 'Updated', canGoBack: true }], 'a', [], null), key)
  assert.notEqual(sessionSaveKey([{ ...original, url: 'https://example.org/' }], 'a', [], null), key)
  assert.notEqual(sessionSaveKey([{ ...original, favicon: 'https://example.com/icon.png' }], 'a', [], null), key)
  assert.notEqual(sessionSaveKey([original], null, [], null), key)
})

test('migrates the old session and restores separate workspaces after reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-session-'))
  try {
    const path = join(dir, 'session.sqlite')
    const old = new DatabaseSync(path)
    old.exec(`CREATE TABLE windows (id TEXT PRIMARY KEY, active_tab TEXT);
      CREATE TABLE tabs (id TEXT PRIMARY KEY, window_id TEXT NOT NULL, position INTEGER NOT NULL, url TEXT NOT NULL, pinned INTEGER NOT NULL);
      CREATE TABLE recently_closed (id TEXT PRIMARY KEY, window_id TEXT NOT NULL, position INTEGER NOT NULL, url TEXT NOT NULL, pinned INTEGER NOT NULL);
      INSERT INTO windows VALUES ('main', 'a');
      INSERT INTO tabs VALUES ('a', 'main', 0, 'https://example.com', 1);
      PRAGMA user_version = 1;`)
    old.close()
    let store = new SessionStore(path)
    assert.equal(store.activeWorkspace('main'), 'main')
    assert.deepEqual(store.workspaces(), [{ id: 'main', name: 'Default' }])
    assert.deepEqual(store.load('main')?.tabs, [{ id: 'a', url: 'https://example.com', pinned: true }])
    store.createWorkspace('second', 'Research')
    store.save('second', [tab('b', 'https://example.org')], 'b', [])
    store.selectWorkspace('main', 'second')
    store.close()
    store = new SessionStore(path)
    assert.equal(store.activeWorkspace('main'), 'second')
    assert.equal(store.load('main')?.activeId, 'a')
    assert.equal(store.load('second')?.tabs[0]?.url, 'https://example.org')
    store.renameWorkspace('second', 'Work')
    assert.equal(store.workspaces()[1]?.name, 'Work')
    store.deleteWorkspace('main', 'second', 'main')
    assert.equal(store.activeWorkspace('main'), 'main')
    assert.equal(store.load('second'), null)
    assert.equal(store.load('main')?.tabs[0]?.id, 'a')
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('Later save and tab removal commit together and survive reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-later-'))
  try {
    const path = join(dir, 'session.sqlite')
    let store = new SessionStore(path)
    store.save('main', [tab('a', 'https://example.com'), tab('b', 'https://example.org')], 'a', [])
    const item = { id: 'later-a', workspaceId: 'main', url: 'https://example.com', title: 'Example', savedAt: 1700000000000, note: 'Read this', done: false }
    store.saveForLater(item, 'a', 'b')
    assert.equal(store.load('main')?.activeId, 'b')
    assert.deepEqual(store.load('main')?.tabs.map((entry) => entry.id), ['b'])
    assert.throws(() => store.saveForLater(item, 'b', null))
    assert.deepEqual(store.load('main')?.tabs.map((entry) => entry.id), ['b'])
    store.close()
    store = new SessionStore(path)
    assert.deepEqual(store.later('main'), [item])
    store.updateLater('main', item.id, 'toggle')
    store.updateLater('main', item.id, 'note', 'Updated')
    assert.equal(store.later('main')[0]?.done, true)
    assert.equal(store.later('main')[0]?.note, 'Updated')
    store.updateLater('main', item.id, 'remove')
    assert.deepEqual(store.later('main'), [])
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('favourites persist by scope, reorder and participate in saved-page search', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-favourites-'))
  try {
    const path = join(dir, 'session.sqlite'); let store = new SessionStore(path)
    store.createWorkspace('work', 'Work')
    const global = { id: 'g', workspaceId: null, url: 'https://example.com', title: 'Global example' }
    const local = { id: 'a', workspaceId: 'work', url: 'https://example.org', title: 'Research' }
    const other = { id: 'b', workspaceId: 'work', url: 'https://example.net', title: 'Reference' }
    store.toggleFavourite(global); store.toggleFavourite(local); store.toggleFavourite(other)
    store.moveFavourite('b', 'up'); store.close(); store = new SessionStore(path)
    assert.deepEqual(store.favourites().filter((item) => item.workspaceId === 'work').map((item) => item.id), ['b', 'a'])
    const later = [{ id: 'l', workspaceId: 'work', url: 'https://later.test', title: 'Article', savedAt: 1, note: 'Research notes', done: false }]
    const results = searchSavedPages('research', store.favourites(), later)
    assert.deepEqual(results.favourites.map((item) => item.id), ['a']); assert.deepEqual(results.later.map((item) => item.id), ['l'])
    assert.equal(searchSavedPages('EXAMPLE.COM', store.favourites(), later).favourites[0]?.id, 'g')
    store.deleteWorkspace('main', 'work', 'main')
    assert.deepEqual(store.favourites().map((item) => item.id), ['g'])
    store.toggleFavourite(global); assert.deepEqual(store.favourites(), []); store.close()
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('history persists by Workspace and ignores unsafe URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-history-'))
  try {
    const path = join(dir, 'session.sqlite'); let store = new SessionStore(path)
    store.createWorkspace('work', 'Work')
    store.recordHistory('main', 'https://example.com', 'Example')
    store.recordHistory('work', 'https://example.org', 'Work page')
    store.recordHistory('main', 'file:///secret', 'Unsafe')
    store.close(); store = new SessionStore(path)
    assert.equal(store.history().length, 2)
    assert.ok(store.history().some((item) => item.workspaceId === 'work' && item.url === 'https://example.org'))
    store.deleteWorkspace('main', 'work', 'main')
    assert.deepEqual(store.history().map((item) => item.workspaceId), ['main'])
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('untrusted IPC shapes and unsafe addresses are rejected', () => {
  assert.equal(isTabCommand({ type: 'navigate', value: 'x'.repeat(8193) }), false)
  assert.equal(isTabCommand({ type: 'workspace-delete', id: '' }), false)
  assert.equal(isTabCommand({ type: 'move', id: 'tab', direction: 'sideways' }), false)
  assert.equal(isTabCommand({ type: 'later-note', id: 'tab', note: 'safe' }), true)
  assert.equal(isTabCommand({ type: 'unknown', id: 'tab' }), false)
  assert.equal(isTabCommand({ type: 'sidebar-width', width: 280 }), true)
  assert.equal(isTabCommand({ type: 'sidebar-width', width: Infinity }), false)
  assert.equal(isTabCommand({ type: 'move-to-workspace', id: 'tab', sourceWorkspaceId: 'a', destinationWorkspaceId: 'b' }), true)
  assert.equal(isTabCommand({ type: 'move-to-workspace', id: 'tab', sourceWorkspaceId: 'a', destinationWorkspaceId: 'a' }), false)
  assert.equal(isViewBounds({ x: 0, y: 0, width: Infinity, height: 10 }), false)
  assert.equal(isViewBounds({ x: 0, y: 0, width: 200, height: 10 }), true)
  assert.equal(isWebURL('https://example.com/path'), true)
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://example.com\n@evil.com', 'https://']) assert.equal(isWebURL(url), false)
})

test('committed tab state survives abrupt process termination', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-crash-'))
  try {
    const path = join(dir, 'session.sqlite')
    const moduleURL = new URL('../src/main/session.ts', import.meta.url).href
    const source = `import { SessionStore } from ${JSON.stringify(moduleURL)}; const db = new SessionStore(${JSON.stringify(path)}); db.save('main', [{ id: 'a', url: 'https://example.com', pinned: true }], 'a', []); process.kill(process.pid, 'SIGKILL');`
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--experimental-sqlite', '--input-type=module', '-e', source])
    assert.notEqual(child.status, 0)
    if (child.stderr?.toString().includes('Error')) throw new Error(child.stderr.toString())
    const store = new SessionStore(path)
    try {
      assert.deepEqual(store.load('main')?.tabs, [{ id: 'a', url: 'https://example.com', pinned: true }])
      assert.equal(store.load('main')?.activeId, 'a')
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('tab reorder preserves object identity, pinned boundaries and workspace order on restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-tab-order-'))
  try {
    const a = tab('a', 'https://a.test', true); const b = tab('b', 'https://b.test', true)
    const c = tab('c', 'https://c.test'); const d = tab('d', 'https://d.test')
    assert.equal(reorderTabs([a, b, c, d], 'a', 'c', 'after'), null)
    assert.equal(reorderTabs([a, b, c, d], 'missing', 'c', 'after'), null)
    assert.equal(reorderTabs([a, b, c, d], 'c', 'c', 'before'), null)
    const ordered = reorderTabs([a, b, c, d], 'd', 'c', 'before')
    assert.ok(ordered); assert.deepEqual(ordered.map((item) => item.id), ['a', 'b', 'd', 'c'])
    assert.equal(ordered[2], d)
    const path = join(dir, 'session.sqlite'); let store = new SessionStore(path)
    store.createWorkspace('work', 'Work')
    store.save('main', ordered, 'c', [])
    store.save('work', [tab('e', 'https://e.test')], 'e', [])
    store.selectWorkspace('main', 'work'); store.selectWorkspace('main', 'main'); store.close()
    store = new SessionStore(path)
    assert.deepEqual(store.load('main')?.tabs.map((item) => item.id), ['a', 'b', 'd', 'c'])
    assert.equal(store.load('main')?.activeId, 'c')
    assert.deepEqual(store.load('work')?.tabs.map((item) => item.id), ['e'])
    store.close()
    assert.equal(isTabCommand({ type: 'reorder-tab', id: 'd', targetId: 'c', placement: 'before', workspaceId: 'main' }), true)
    assert.equal(isTabCommand({ type: 'reorder-tab', id: 'd', targetId: 'c', placement: 'elsewhere', workspaceId: 'main' }), false)
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('moving a tab atomically preserves order, selection and URL navigation across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-workspace-move-'))
  try {
    const path = join(dir, 'session.sqlite'); let store = new SessionStore(path)
    store.createWorkspace('work', 'Work')
    store.save('main', [tab('first', 'https://first.test'), tab('moving', 'https://second.test', true)], 'moving', [])
    store.save('work', [tab('existing', 'https://existing.test')], 'existing', [])
    const entries = [{ url: 'https://first.test', title: 'First' }, { url: 'https://second.test', title: 'Second' }]
    store.saveNavigation('moving', entries, 1)
    assert.throws(() => store.moveTab('moving', 'main', 'missing', 'first'))
    assert.equal(store.load('main')?.activeId, 'moving')
    store.moveTab('moving', 'main', 'work', 'first')
    assert.deepEqual(store.load('main')?.tabs.map((item) => item.id), ['first'])
    assert.equal(store.load('main')?.activeId, 'first')
    assert.deepEqual(store.load('work')?.tabs.map((item) => item.id), ['moving', 'existing'])
    assert.equal(store.load('work')?.activeId, 'existing')
    store.close(); store = new SessionStore(path)
    assert.deepEqual(store.loadNavigation('moving'), { entries, index: 1 })
    assert.equal(store.load('work')?.tabs[0]?.url, 'https://second.test')
    store.createWorkspace('empty', 'Empty')
    store.moveTab('moving', 'work', 'empty', 'existing')
    assert.equal(store.load('empty')?.activeId, 'moving')
    assert.deepEqual(store.loadNavigation('moving'), { entries, index: 1 })
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('fresh profile defaults are created once and retain their icons', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-fresh-profiles-'))
  let registry
  try {
    const path = join(dir, 'profiles.sqlite')
    registry = new ProfileRegistry(path)
    const initial = registry.list()
    assert.deepEqual(initial.map(({ name, icon }) => [name, icon]), [['Personal', 'personal'], ['Work', 'work']])
    assert.equal(registry.active(), 'default')
    const workId = initial[1].id
    registry.select(workId); registry.rename(workId, 'Office'); registry.close()
    registry = new ProfileRegistry(path)
    assert.equal(registry.active(), workId)
    assert.deepEqual(registry.list().map(({ name, icon }) => [name, icon]), [['Personal', 'personal'], ['Office', 'work']])
  } finally { registry?.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('existing profile registry migrates without changing profiles or selection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-existing-profiles-'))
  let registry
  try {
    const path = join(dir, 'profiles.sqlite'); const db = new DatabaseSync(path)
    db.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL); CREATE TABLE selection (id INTEGER PRIMARY KEY, profile_id TEXT NOT NULL); INSERT INTO profiles VALUES ('default', 'Original', 0), ('11111111-1111-4111-8111-111111111111', 'Work', 1); INSERT INTO selection VALUES (1, '11111111-1111-4111-8111-111111111111')")
    db.close(); registry = new ProfileRegistry(path)
    assert.deepEqual(registry.list().map(({ name, icon }) => [name, icon]), [['Original', 'personal'], ['Work', 'work']])
    assert.equal(registry.active(), '11111111-1111-4111-8111-111111111111')
  } finally { registry?.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('profiles retain independent sessions and active selection across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-profiles-'))
  try {
    const registryPath = join(dir, 'profiles.sqlite'); const defaultPath = join(dir, 'session.sqlite'); const workPath = join(dir, 'profile.sqlite')
    let existing = new SessionStore(defaultPath)
    existing.save('main', [tab('legacy', 'https://example.com', true)], 'legacy', [])
    existing.toggleFavourite({ id: 'f', workspaceId: null, url: 'https://example.com', title: 'Legacy' })
    existing.close()
    let registry = new ProfileRegistry(registryPath)
    assert.equal(registry.active(), 'default')
    assert.equal(registry.sidebarWidth(), 232); registry.setSidebarWidth(318)
    assert.throws(() => registry.setSidebarWidth(10000))
    assert.deepEqual(registry.list(), [{ id: 'default', name: 'Default', icon: 'personal' }])
    const id = '11111111-1111-4111-8111-111111111111'; registry.create(id, 'Work'); registry.select(id)
    let work = new SessionStore(workPath)
    work.save('main', [tab('work', 'https://example.org')], 'work', [])
    assert.deepEqual(work.favourites(), []); work.close(); registry.close()
    registry = new ProfileRegistry(registryPath)
    assert.equal(registry.active(), id)
    assert.equal(registry.sidebarWidth(), 318)
    existing = new SessionStore(defaultPath); work = new SessionStore(workPath)
    assert.equal(existing.load('main')?.tabs[0]?.id, 'legacy')
    assert.equal(work.load('main')?.tabs[0]?.id, 'work')
    assert.equal(existing.favourites()[0]?.title, 'Legacy')
    assert.deepEqual(work.favourites(), [])
    registry.rename(id, 'Personal'); assert.equal(registry.list()[1]?.name, 'Personal')
    assert.throws(() => registry.remove(id)); registry.select('default'); registry.remove(id)
    assert.deepEqual(registry.list(), [{ id: 'default', name: 'Default', icon: 'personal' }])
    existing.close(); work.close(); registry.close()
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

test('browser shortcuts recognize macOS and Windows modifiers without swallowing ordinary typing', () => {
  const base = { type: 'keyDown', key: '', code: '', meta: false, control: false, alt: false, shift: false, isAutoRepeat: false }
  const mac = (key, extra = {}) => browserShortcut({ ...base, key, meta: true, ...extra }, true)
  assert.equal(mac('l'), 'address'); assert.equal(mac('t'), 'new-tab'); assert.equal(mac('t', { shift: true }), 'reopen')
  assert.equal(mac('f'), 'find'); assert.equal(mac('['), 'back'); assert.equal(mac(']'), 'forward')
  assert.equal(mac('+', { shift: true, code: 'Equal' }), 'zoom-in'); assert.equal(mac('-'), 'zoom-out'); assert.equal(mac('0'), 'zoom-reset')
  assert.equal(mac('9'), 'tab-9')
  assert.equal(mac('{', { shift: true, code: 'BracketLeft' }), 'previous-tab')
  assert.equal(mac('}', { shift: true, code: 'BracketRight' }), 'next-tab')
  assert.equal(mac('s', { shift: true }), 'sidebar')
  assert.equal(mac('f', { shift: true }), 'saved-search')
  assert.equal(browserShortcut({ ...base, key: 'Tab', control: true }, true), 'next-tab')
  assert.equal(browserShortcut({ ...base, key: 'Tab', control: true, shift: true }, true), 'previous-tab')
  assert.equal(browserShortcut({ ...base, key: 'f' }, true), null)
  assert.equal(browserShortcut({ ...base, key: 'l', control: true }, false), 'address')
  assert.equal(browserShortcut({ ...base, key: 'l', meta: true, alt: true }, true), null)
  assert.equal(browserShortcut({ ...base, key: 'l', meta: true, isAutoRepeat: true }, true), null)
  assert.equal(isTabCommand({ type: 'find-query', value: 'example' }), true)
  assert.equal(isTabCommand({ type: 'find-query', value: 'x'.repeat(1001) }), false)
})

test('pin and unpin grouping remains stable without replacing tabs', () => {
  const a = tab('a', 'https://a.test'); const b = tab('b', 'https://b.test', true); const c = tab('c', 'https://c.test')
  const grouped = groupPinnedTabs([a, b, c])
  assert.deepEqual(grouped.map((entry) => entry.id), ['b', 'a', 'c'])
  assert.equal(grouped[0], b)
  a.pinned = true
  assert.deepEqual(groupPinnedTabs(grouped).map((entry) => entry.id), ['b', 'a', 'c'])
  b.pinned = false
  assert.deepEqual(groupPinnedTabs(grouped).map((entry) => entry.id), ['a', 'b', 'c'])
})

import { splitPane, splitTabIds, removeSplitTab, restoreSplitTree } from '../src/shared/split-tree.ts'

test('split trees cap pane count, collapse removed branches and reject invalid saved tabs', () => {
  let tree = { type: 'leaf', tabId: 'a' }
  tree = splitPane(tree, 'a', 'b', 'horizontal')
  tree = splitPane(tree, 'a', 'c', 'vertical')
  tree = splitPane(tree, 'b', 'd', 'vertical')
  assert.deepEqual(splitTabIds(tree), ['a', 'c', 'b', 'd'])
  assert.equal(splitPane(tree, 'a', 'e', 'horizontal'), null)
  assert.equal(splitPane(tree, 'a', 'b', 'horizontal'), null)
  assert.deepEqual(splitTabIds(removeSplitTab(tree, 'c')), ['a', 'b', 'd'])
  assert.deepEqual(splitTabIds(restoreSplitTree(tree, new Set(['a', 'b', 'c']))), ['a', 'c', 'b'])
  assert.equal(restoreSplitTree({ type: 'split', ratio: NaN, orientation: 'horizontal' }, new Set(['a'])), null)
})

test('split layouts persist with their workspace and prune invalid tab references', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-split-'))
  try {
    const path = join(dir, 'session.sqlite')
    let store = new SessionStore(path)
    const a = tab('a', 'https://example.com'), b = tab('b', 'https://example.org')
    const tree = splitPane({ type: 'leaf', tabId: 'a' }, 'a', 'b', 'horizontal')
    store.save('main', [a, b], 'b', [], tree)
    store.createWorkspace('other', 'Other')
    assert.equal(store.loadSplitTree('other', new Set(['a', 'b'])), null)
    store.close()
    store = new SessionStore(path)
    assert.deepEqual(store.loadSplitTree('main', new Set(['a', 'b'])), tree)
    assert.deepEqual(store.loadSplitTree('main', new Set(['a'])), { type: 'leaf', tabId: 'a' })
    store.save('main', [a], 'a', [], null)
    assert.equal(store.loadSplitTree('main', new Set(['a'])), null)
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('split drop commands validate tab, workspace and edge', () => {
  assert.equal(isTabCommand({ type: 'split-drop', id: 'a', targetId: 'b', workspaceId: 'main', edge: 'left' }), true)
  assert.equal(isTabCommand({ type: 'split-drop', id: 'a', targetId: 'b', workspaceId: 'main', edge: 'middle' }), false)
  const tree = splitPane({ type: 'leaf', tabId: 'a' }, 'a', 'b', 'horizontal', true)
  assert.deepEqual(splitTabIds(tree), ['b', 'a'])
})

test('pane navigation rejects malformed commands', () => {
  assert.equal(isTabCommand({ type: 'pane-command', id: 'tab', action: 'navigate', value: 'https://example.com' }), true)
  assert.equal(isTabCommand({ type: 'pane-command', id: '', action: 'back' }), false)
  assert.equal(isTabCommand({ type: 'pane-command', id: 'tab', action: 'navigate', value: 123 }), false)
  assert.equal(isTabCommand({ type: 'pane-command', id: 'tab', action: 'close' }), false)
  assert.equal(isTabCommand({ type: 'pane-menu', id: 'tab', x: -1, y: 0 }), false)
})

test('pane switchers validate their target and menu coordinates', () => {
  assert.equal(isTabCommand({ type: 'pane-switcher', id: 'a', kind: 'workspace', x: 20, y: 44 }), true)
  assert.equal(isTabCommand({ type: 'pane-switcher', id: 'a', kind: 'group', x: 20, y: 44 }), true)
  assert.equal(isTabCommand({ type: 'pane-switcher', id: 'a', kind: 'other', x: 20, y: 44 }), false)
  assert.equal(isTabCommand({ type: 'pane-switcher', id: '', kind: 'group', x: 20, y: 44 }), false)
  assert.equal(isTabCommand({ type: 'pane-switcher', id: 'a', kind: 'group', x: -1, y: 44 }), false)
})

test('deleting a group keeps its tabs and persists ungrouping', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idle-groups-'))
  let store
  try {
    const path = join(dir, 'session.sqlite')
    store = new SessionStore(path)
    store.save('main', [tab('a', 'https://example.com'), tab('b', 'https://example.org')], 'a', [])
    store.createGroup('main', 'g', 'Reading', '#55766b')
    store.setTabGroup('a', 'g', 'main')
    assert.equal(store.groups('main')[0].tabIds.length, 1)
    store.updateGroup('g', 'delete')
    store.close()
    store = new SessionStore(path)
    assert.equal(store.groups('main').length, 0)
    assert.deepEqual(store.load('main').tabs.map((item) => [item.id, item.groupId ?? null]), [['a', null], ['b', null]])
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }) }
})

