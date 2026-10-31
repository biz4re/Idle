import { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, Menu, shell, systemPreferences, nativeTheme, type WebContents } from 'electron'
import { join, basename } from 'node:path'
import { release } from 'node:os'
import { browserShortcut, type BrowserShortcut } from './shortcuts'
import { groupPinnedTabs, reorderTabs } from '../shared/tab-order'
import { splitPane, splitTabIds, removeSplitTab, type SplitTree } from '../shared/split-tree'
import { isTabCommand, isViewBounds, isWebURL } from './security'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { ProfileRegistry } from './profiles'
import { SessionStore, type SavedTab } from './session'
import { pathToFileURL } from 'node:url'
import { APP_INFO_CHANNEL, SPLIT_PREVIEW_CHANNEL, VIEW_BOUNDS_CHANNEL, TAB_COMMAND_CHANNEL, TAB_STATE_CHANNEL, SHORTCUT_CHANNEL, BROWSER_ACTION_CHANNEL, FIND_RESULT_CHANNEL, type DownloadState, type TabState, type ViewBounds, type AppInfo } from '../shared/ipc'

app.setName('Idle')
app.enableSandbox()

let store: SessionStore
let profiles: ProfileRegistry
let switchingProfile = false
let activeProfileId = 'default'
const deletingProfiles = new Set<string>()
const profilePath = (id: string): string => join(app.getPath('userData'), id === 'default' ? 'session.sqlite' : `profile-${id}.sqlite`)
const profilePartition = (id: string): string => `persist:wander-profile-${id}`
let storageWarning = ''
const windowId = 'main'
if (!app.requestSingleInstanceLock()) app.quit()

const rendererFile = join(__dirname, '../renderer/index.html')
const rendererURL = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  ? new URL(process.env.ELECTRON_RENDERER_URL).href
  : pathToFileURL(rendererFile).href

function createWindow(): void {
  const profileId = activeProfileId
  const pageSession = session.fromPartition(profilePartition(profileId))
  pageSession.setPermissionCheckHandler(() => false)
  const supportsMica = process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22621
  const useMaterial = (): boolean => !nativeTheme.prefersReducedTransparency && !nativeTheme.shouldUseHighContrastColors && (supportsMica || process.platform === 'darwin')
  const solidColor = (): string => nativeTheme.shouldUseDarkColors ? '#202120' : '#f1f0ed'
  const window = new BrowserWindow({
    title: 'Idle',
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: useMaterial() ? '#00000000' : solidColor(),
    show: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, ...(useMaterial() ? { vibrancy: 'sidebar' as const, visualEffectState: 'active' as const } : {}) } : {}),
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, ...(useMaterial() ? { backgroundMaterial: 'mica' as const } : {}), titleBarOverlay: { color: useMaterial() ? '#00000000' : solidColor(), symbolColor: nativeTheme.shouldUseDarkColors ? '#eeefeb' : '#292b29', height: 49 }, autoHideMenuBar: true } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
    },
  })

  const updateMaterial = (): void => {
    if (window.isDestroyed()) return
    const glass = useMaterial()
    window.setBackgroundColor(glass ? '#00000000' : solidColor())
    if (process.platform === 'win32') {
      if (supportsMica) window.setBackgroundMaterial(glass ? 'mica' : 'none')
      window.setTitleBarOverlay({ color: glass ? '#00000000' : solidColor(), symbolColor: nativeTheme.shouldUseDarkColors ? '#eeefeb' : '#292b29', height: 49 })
    } else if (process.platform === 'darwin') window.setVibrancy(glass ? 'sidebar' : null)
  }
  nativeTheme.on('updated', updateMaterial)

  type Tab = { view: WebContentsView; state: TabState; loaded: boolean; presented: boolean; workspaceId: string }
  type WorkspaceTabs = { tabs: Map<string, Tab>; activeId: string | null; closed: SavedTab[] }
  let tabs = new Map<string, Tab>()
  const workspaceCache = new Map<string, WorkspaceTabs>()
  const updatePageBackings = (): void => {
    const color = nativeTheme.shouldUseDarkColors ? '#292b29' : '#fbfaf8'
    for (const tab of tabs.values()) tab.view.setBackgroundColor(color)
    for (const workspace of workspaceCache.values()) for (const tab of workspace.tabs.values()) tab.view.setBackgroundColor(color)
  }
  nativeTheme.on('updated', updatePageBackings)
  let activeId: string | null = null
  let splitTree: SplitTree | null = null
  let splitDragging = false
  let splitViewsHidden = false
  let splitDragToken = ''
  let splitDragTimer: ReturnType<typeof setTimeout> | undefined
  let activeWorkspaceId = store.activeWorkspace(windowId)
  let bounds: ViewBounds = { x: 0, y: 0, width: 0, height: 0 }
  let closed: SavedTab[] = []
  let restoring = true
  let suppressSave = false
  let laterError = ''
  let navigationError = ''
  let announcement = ''
  const downloads: DownloadState[] = []
  let findOpen = false
  let findText = ''
  let findRequest = 0
  const trusted = (event: Electron.IpcMainEvent): boolean => profileId === activeProfileId && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === rendererURL
  const publish = (): void => {
    if (window.isDestroyed() || profileId !== activeProfileId) return
    const states = [...tabs.values()].map((tab) => tab.state)
    if (!restoring && !suppressSave) { try { store.save(activeWorkspaceId, states, activeId, closed, splitTree) } catch (error) { console.error('Unable to save session:', error); storageWarning = 'Session changes could not be saved. Check available disk space and restart Idle.' } }
    if (!window.isDestroyed()) window.webContents.send(TAB_STATE_CHANNEL, { splitTree, tabs: states, groups: store.groups(activeWorkspaceId), activeId, recentlyClosed: closed.length, workspaces: store.workspaces(), activeWorkspaceId, later: store.later(activeWorkspaceId), laterError, favourites: store.favourites(), searchLater: store.workspaces().flatMap((workspace) => store.later(workspace.id)), history: store.history(), downloads, storageWarning, profiles: profiles.list(), activeProfileId: profileId, sidebarWidth: profiles.sidebarWidth(), navigationError, announcement })
    announcement = ''
  }
  const layout = (): void => {
    const [width = 0, height = 0] = window.getContentSize()
    const x = Math.min(width, Math.round(bounds.x)); const y = Math.min(height, Math.round(bounds.y))
    const rect = { x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.width))), height: Math.max(0, Math.min(height - y, Math.round(bounds.height))) }
    const place = (node: SplitTree, area: typeof rect): void => {
      if (node.type === 'leaf') { tabs.get(node.tabId)?.view.setBounds({ x: area.x + 1, y: area.y + 41, width: Math.max(0, area.width - 2), height: Math.max(0, area.height - 42) }); return }
      const gap = 8; const horizontal = node.orientation === 'horizontal'
      const size = horizontal ? area.width : area.height
      const first = Math.max(0, Math.round((size - gap) * node.ratio)); const second = Math.max(0, size - gap - first)
      if (horizontal) { place(node.first, { ...area, width: first }); place(node.second, { ...area, x: area.x + first + gap, width: second }) }
      else { place(node.first, { ...area, height: first }); place(node.second, { ...area, y: area.y + first + gap, height: second }) }
    }
    if (splitTree) place(splitTree, rect)
    else if (activeId) tabs.get(activeId)?.view.setBounds({ ...rect, y: rect.y + Math.min(40, rect.height), height: Math.max(0, rect.height - 40) })
  }
  const loadTab = (tab: Tab): void => {
    if (tab.loaded || !tab.state.url) return
    tab.loaded = true
    const history = store.loadNavigation(tab.state.id)
    if (history && history.entries[history.index]?.url === tab.state.url) void tab.view.webContents.navigationHistory.restore(history).catch(() => {})
    else void tab.view.webContents.loadURL(tab.state.url).catch(() => {})
  }
  const attachVisible = (): void => {
    const visible = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []
    for (const [tabId, tab] of tabs) {
      if (visible.includes(tabId)) { window.contentView.addChildView(tab.view); if (!restoring) loadTab(tab) }
      else window.contentView.removeChildView(tab.view)
    }
    layout()
  }
  const activate = (id: string | null, focusPage = false): void => {
    if (id !== null && !tabs.has(id)) return
    if (id === activeId) { if (focusPage && id) tabs.get(id)?.view.webContents.focus(); return }
    navigationError = ''
    const old = activeId ? tabs.get(activeId) : undefined
    if (findOpen) { old?.view.webContents.stopFindInPage('clearSelection'); findOpen = false; findText = ''; window.webContents.send(BROWSER_ACTION_CHANNEL, 'dismiss') }
    if (splitTree && id && !splitTabIds(splitTree).includes(id) && activeId) {
      const replace = (node: SplitTree): SplitTree => node.type === 'leaf' ? (node.tabId === activeId ? { type: 'leaf', tabId: id } : node) : { ...node, first: replace(node.first), second: replace(node.second) }
      splitTree = replace(splitTree)
    }
    activeId = id
    attachVisible()
    if (focusPage && id) tabs.get(id)?.view.webContents.focus()
    publish()
  }
  const create = (saved?: SavedTab, select = true, workspaceId = activeWorkspaceId, destination = tabs): WebContents => {
    const id = saved?.id ?? randomUUID()
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, partition: profilePartition(profileId) } })
    // Keep native backing consistent with the canvas during resize and loading.
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#292b29' : '#fbfaf8')
    view.setBorderRadius(15)
    const state: TabState = { id, url: saved?.url ?? '', pinned: saved?.pinned ?? false, groupId: saved?.groupId ?? null, title: saved?.url || 'New tab', favicon: saved?.favicon ?? '', loading: false, canGoBack: false, canGoForward: false, error: '' }
    view.setVisible(false)
    const ownedTab: Tab = { view, state, loaded: false, presented: false, workspaceId }
    destination.set(id, ownedTab)
    const contents = view.webContents
    const refresh = (): void => {
      const ownerId = ownedTab.workspaceId
      const ownerTabs = ownerId === activeWorkspaceId ? tabs : workspaceCache.get(ownerId)?.tabs
      if (window.isDestroyed() || profileId !== activeProfileId || contents.isDestroyed() || ownerTabs?.get(id) !== ownedTab) return
      state.canGoBack = contents.navigationHistory.canGoBack(); state.canGoForward = contents.navigationHistory.canGoForward()
      const history = contents.navigationHistory; const entries = history.getAllEntries(); const index = history.getActiveIndex()
      if (entries.length && entries.length <= 100 && entries[index]?.url === state.url) { try { store.saveNavigation(id, entries, index) } catch (error) { console.error('Unable to save tab navigation:', error); storageWarning = 'Session changes could not be saved. Check available disk space and restart Idle.' } }
      if (ownerId === activeWorkspaceId) publish()
      else {
        const cached = workspaceCache.get(ownerId)
        if (cached) { try { store.save(ownerId, [...ownerTabs.values()].map((tab) => tab.state), cached.activeId, cached.closed) } catch (error) { console.error('Unable to save session:', error); storageWarning = 'Session changes could not be saved. Check available disk space and restart Idle.' } }
      }
    }
    installShortcuts(contents)
    contents.on('focus', () => { if (ownedTab.workspaceId === activeWorkspaceId && splitTree && splitTabIds(splitTree).includes(id) && activeId !== id) activate(id) })
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (ownedTab.workspaceId !== activeWorkspaceId || activeId !== id || !contents.isFocused() || tabs.size >= 100) return { action: 'deny' }
      if (!isWebURL(url) && url !== 'about:blank') { void confirmExternal(url, contents); return { action: 'deny' } }
      return { action: 'allow', createWindow: () => create(undefined, disposition !== 'background-tab') }
    })
    contents.on('context-menu', (_event, params) => {
      const template: Electron.MenuItemConstructorOptions[] = []
      if (params.linkURL && isWebURL(params.linkURL)) template.push({ label: 'Open Link in New Tab', click: () => { if (ownedTab.workspaceId === activeWorkspaceId && tabs.get(id) === ownedTab) create({ id: randomUUID(), url: params.linkURL, pinned: false }) } })
      if (params.isEditable) template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' })
      else if (params.selectionText) template.push({ role: 'copy' })
      if (ownedTab.workspaceId === activeWorkspaceId && tabs.get(id) === ownedTab) {
        const available = [...tabs.values()].filter((tab) => tab.state.id !== id && (!splitTree || !splitTabIds(splitTree).includes(tab.state.id)))
        const canSplit = !splitTree || splitTabIds(splitTree).length < 4
        const choose = (orientation: 'horizontal' | 'vertical') => available.map((tab) => ({ label: tab.state.title || 'New tab', click: () => { activate(id); addSplit(tab.state.id, orientation) } }))
        if (template.length) template.push({ type: 'separator' })
        template.push({ label: 'Split Right', enabled: canSplit && available.length > 0 && bounds.width >= 480, submenu: choose('horizontal') }, { label: 'Split Below', enabled: canSplit && available.length > 0 && bounds.height >= 320, submenu: choose('vertical') }, { label: 'Close Split', enabled: !!splitTree && splitTabIds(splitTree).includes(id), click: () => closeSplit(id) })
      }
      if (template.length) Menu.buildFromTemplate(template).popup({ window })
    })
    contents.on('will-navigate', (event, url) => { if (!isWebURL(url)) { event.preventDefault(); if (activeId === id && contents.isFocused()) void confirmExternal(url, contents) } })
    contents.on('will-frame-navigate', (event) => { if (!event.isMainFrame && !isWebURL(event.url) && event.url !== 'about:blank' && event.url !== 'about:srcdoc' && !/^(?:blob:|data:)/i.test(event.url)) event.preventDefault() })
    contents.on('will-redirect', (event, url) => { if (!isWebURL(url)) event.preventDefault() })
    contents.on('found-in-page', (_event, result) => { if (activeId === id && ownedTab.workspaceId === activeWorkspaceId && findOpen && result.requestId === findRequest && !window.isDestroyed()) window.webContents.send(FIND_RESULT_CHANNEL, { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal }) })
    contents.on('did-start-loading', () => { state.loading = true; state.error = ''; refresh() })
    const revealLoadedPage = (): void => {
      if (contents.isDestroyed() || state.error || !isWebURL(contents.getURL())) return
      ownedTab.presented = true
      if (!splitViewsHidden) view.setVisible(true)
    }
    contents.on('did-finish-load', () => { const title = contents.getTitle().trim(); if (title) state.title = title; revealLoadedPage() })
    contents.on('did-stop-loading', () => { state.loading = false; if (!ownedTab.presented) revealLoadedPage(); refresh() })
    contents.on('did-navigate', (_event, url) => { if (window.isDestroyed() || profileId !== activeProfileId) return; const previousURL = state.url; state.url = url; state.title = ''; state.error = ''; let sameOrigin = false; try { sameOrigin = !!previousURL && new URL(previousURL).origin === new URL(url).origin } catch { /* invalid or new-tab URL */ } if (!sameOrigin) state.favicon = ''; try { store.recordHistory(ownedTab.workspaceId, url, url) } catch (error) { console.error('Unable to record history:', error) } refresh() })
    contents.on('did-navigate-in-page', (_event, url, main) => { if (main) { state.url = url; refresh() } })
    contents.on('page-title-updated', (_event, title) => { if (window.isDestroyed() || profileId !== activeProfileId) return; state.title = title; if (state.url) { try { store.recordHistory(ownedTab.workspaceId, state.url, title) } catch (error) { console.error('Unable to record history:', error) } } refresh() })
    contents.on('page-favicon-updated', (_event, icons) => { if (window.isDestroyed() || profileId !== activeProfileId) return; const icon = icons.find((value) => value.length <= 8192 && /^(?:https?:|data:image\/|chrome:\/\/favicon\/)/i.test(value)); state.favicon = icon && !/^chrome:\/\/favicon\//i.test(icon) ? icon : ''; refresh() })
    contents.on('did-fail-load', (_event, code, description, url, main) => { if (main && code !== -3) { state.url = url; state.error = description; view.setVisible(false); refresh() } })
    if (select && workspaceId === activeWorkspaceId) { regroupTabs(); activate(id) }
    else if (!restoring && workspaceId === activeWorkspaceId) publish()
    return contents
  }
  let externalPrompt = false
  const confirmExternal = async (value: string, source: WebContents): Promise<void> => {
    let url: URL
    try { url = new URL(value) } catch { return }
    if (!['mailto:', 'tel:'].includes(url.protocol) || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value) || window.isDestroyed() || externalPrompt || !source.isFocused()) return
    const sourceURL = source.getURL(); externalPrompt = true
    const answer = await dialog.showMessageBox(window, { type: 'question', buttons: ['Cancel', 'Open'], defaultId: 0, cancelId: 0, title: 'Open external application?', message: `Open ${url.protocol} link in another application?`, detail: `From: ${sourceURL.slice(0, 300)}\n\n${value.slice(0, 500)}` }).catch(() => ({ response: 0 }))
    externalPrompt = false
    if (answer.response === 1 && !window.isDestroyed() && !source.isDestroyed() && source.getURL() === sourceURL) await shell.openExternal(value).catch((error: unknown) => console.error('Unable to open external link:', error))
  }
  const performShortcut = (action: BrowserShortcut): void => {
    const current = activeId ? tabs.get(activeId)?.view.webContents : undefined
    if (action === 'sidebar' || action === 'saved-search' || action === 'downloads') { window.webContents.focus(); window.webContents.send(BROWSER_ACTION_CHANNEL, action); return }
    if (action === 'address') { if (!activeId && tabs.size < 100) create(); window.webContents.focus(); window.webContents.send(SHORTCUT_CHANNEL, activeId); return }
    if (action === 'new-tab') { if (tabs.size < 100) create(); window.webContents.focus(); window.webContents.send(SHORTCUT_CHANNEL, activeId); return }
    if (action === 'close-tab') { if (activeId) closeTab(activeId); return }
    if (action === 'reopen') { const saved = closed.shift(); if (saved) { create(saved); publish() } return }
    if (action === 'find') { if (current) { findOpen = true; window.webContents.focus(); window.webContents.send(BROWSER_ACTION_CHANNEL, 'find') } return }
    if (action === 'dismiss') { if (findOpen) { current?.stopFindInPage('clearSelection'); findOpen = false; findText = ''; window.webContents.send(BROWSER_ACTION_CHANNEL, 'dismiss'); current?.focus() } return }
    if (action === 'reload') { if (current?.getURL()) current.reload(); return }
    if (action === 'back' && current?.navigationHistory.canGoBack()) { current.navigationHistory.goBack(); return }
    if (action === 'forward' && current?.navigationHistory.canGoForward()) { current.navigationHistory.goForward(); return }
    if ((action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset') && current) { const level = action === 'zoom-reset' ? 0 : current.getZoomLevel() + (action === 'zoom-in' ? 1 : -1); current.setZoomLevel(Math.max(-7, Math.min(8, level))); return }
    const ids = [...tabs.keys()]; if (!ids.length) return
    if (action === 'next-tab' || action === 'previous-tab') { const index = Math.max(0, ids.indexOf(activeId ?? '')); const id = ids[(index + (action === 'next-tab' ? 1 : ids.length - 1)) % ids.length]; if (id) activate(id, true); return }
    if (action.startsWith('tab-')) { const number = Number(action.slice(4)); const id = number === 9 ? ids[ids.length - 1] : ids[number - 1]; if (id) activate(id, true) }
  }
  const installShortcuts = (contents: WebContents): void => {
    contents.on('before-input-event', (event, input) => {
      const action = browserShortcut(input, process.platform === 'darwin')
      if (!action || (action === 'dismiss' && !findOpen)) return
      event.preventDefault(); performShortcut(action)
    })
  }
  const switchWorkspace = (id: string, persistSelection = true): void => {
    if (id === activeWorkspaceId || !store.workspaces().some((workspace) => workspace.id === id)) return
    if (findOpen) performShortcut('dismiss')
    if (persistSelection) store.selectWorkspace(windowId, id)
    restoring = true
    for (const tab of tabs.values()) window.contentView.removeChildView(tab.view)
    workspaceCache.set(activeWorkspaceId, { tabs, activeId, closed })
    activeWorkspaceId = id
    splitTree = null
    const cached = workspaceCache.get(id)
    if (cached) {
      tabs = cached.tabs; activeId = cached.activeId; closed = cached.closed

    } else {
      tabs = new Map<string, Tab>(); activeId = null; closed = []
      const saved = store.load(id)
      if (saved) { closed = saved.closed; for (const tab of saved.tabs) create(tab, false); regroupTabs(); activate(saved.activeId) }
    }
    workspaceCache.delete(id)
    splitTree = store.loadSplitTree(id, new Set(tabs.keys()))
    if (splitTree?.type === 'leaf') splitTree = null
    if (splitTree && (!activeId || !splitTabIds(splitTree).includes(activeId))) activeId = splitTabIds(splitTree)[0] ?? null
    restoring = false
    attachVisible()
    const current = activeId ? tabs.get(activeId) : undefined
    if (current) loadTab(current)
    publish()
  }
  const updateBounds = (event: Electron.IpcMainEvent, value: unknown): void => {
    if (!trusted(event) || !isViewBounds(value)) return
    bounds = value
    layout()
  }
  const saveLater = (id: string): void => {
    const tab = tabs.get(id)
    if (!tab?.state.url) return
    try { const url = new URL(tab.state.url); if (url.protocol !== 'http:' && url.protocol !== 'https:') return } catch { return }
    const ids = [...tabs.keys()]; const index = ids.indexOf(id)
    const next = activeId === id ? ids[index + 1] ?? ids[index - 1] ?? null : activeId
    try {
      store.saveForLater({ id: randomUUID(), workspaceId: activeWorkspaceId, url: tab.state.url, title: tab.state.title || tab.state.url, savedAt: Date.now(), note: '', done: false }, id, next)
    } catch (error) { console.error('Unable to save for Later:', error); laterError = 'Could not save this page. The tab is still open.'; publish(); return }
    laterError = ''; suppressSave = true
    splitTree = removeSplitTab(splitTree, id)
    if (splitTree?.type === 'leaf') splitTree = null
    window.contentView.removeChildView(tab.view)
    if (activeId === id) activate(splitTree ? splitTabIds(splitTree)[0] ?? next : next)
    tabs.delete(id); attachVisible(); tab.view.webContents.close(); suppressSave = false
    publish()
  }
  const closeTab = (id: string): void => {
    const tab = tabs.get(id); if (!tab) return
    const ids = [...tabs.keys()]; const index = ids.indexOf(id)
    closed.unshift({ id: tab.state.id, url: tab.state.url, pinned: tab.state.pinned }); closed = closed.slice(0, 25)
    suppressSave = true
    splitTree = removeSplitTab(splitTree, id)
    if (splitTree?.type === 'leaf') splitTree = null
    window.contentView.removeChildView(tab.view)
    if (activeId === id) activate(splitTree ? splitTabIds(splitTree)[0] ?? null : ids[index + 1] ?? ids[index - 1] ?? null)
    tabs.delete(id); attachVisible(); tab.view.webContents.close(); suppressSave = false; publish()
  }
  const regroupTabs = (): void => {
    const ordered = groupPinnedTabs([...tabs.values()].map((tab) => ({ id: tab.state.id, pinned: tab.state.pinned, tab })))
    tabs.clear(); for (const entry of ordered) tabs.set(entry.id, entry.tab)
  }
  const togglePin = (id: string): void => {
    const tab = tabs.get(id); if (!tab) return
    tab.state.pinned = !tab.state.pinned; regroupTabs()
    announcement = `${tab.state.title} ${tab.state.pinned ? 'pinned' : 'unpinned'}, position ${[...tabs.keys()].indexOf(id) + 1} of ${tabs.size}.`
    publish()
  }
  const reorder = (id: string, targetId: string, placement: 'before' | 'after'): void => {
    const entries = [...tabs.entries()].map(([tabId, tab]) => ({ id: tabId, pinned: tab.state.pinned, tab }))
    const ordered = reorderTabs(entries, id, targetId, placement)
    if (!ordered) return
    tabs.clear()
    for (const entry of ordered) tabs.set(entry.id, entry.tab)
    announcement = `${tabs.get(id)?.state.title ?? 'Tab'} moved to position ${[...tabs.keys()].indexOf(id) + 1} of ${tabs.size}.`
    publish()
  }
  const moveTab = (id: string, direction: 'up' | 'down'): void => {
    const ids = [...tabs.keys()]; const index = ids.indexOf(id)
    const target = ids[index + (direction === 'up' ? -1 : 1)]
    if (index >= 0 && target) reorder(id, target, direction === 'up' ? 'before' : 'after')
  }
  const moveToWorkspace = (id: string, source: string, destination: string): void => {
    if (source !== activeWorkspaceId || source === destination || !store.workspaces().some((workspace) => workspace.id === destination)) return
    const tab = tabs.get(id); if (!tab) return
    let target = workspaceCache.get(destination)
    if (!target) {
      const saved = store.load(destination)
      target = { tabs: new Map<string, Tab>(), activeId: saved?.activeId ?? null, closed: saved?.closed ?? [] }
      for (const row of saved?.tabs ?? []) create(row, false, destination, target.tabs)
      workspaceCache.set(destination, target)
    }
    if (target.tabs.has(id)) return
    const ids = [...tabs.keys()]; const index = ids.indexOf(id)
    const next = activeId === id ? ids[index + 1] ?? ids[index - 1] ?? null : activeId
    try { store.moveTab(id, source, destination, next) } catch (error) {
      console.error('Unable to move tab:', error); storageWarning = 'Could not move the tab. Please check session storage.'; publish(); return
    }
    suppressSave = true
    splitTree = removeSplitTab(splitTree, id)
    if (splitTree?.type === 'leaf') splitTree = null
    window.contentView.removeChildView(tab.view)
    if (activeId === id) activate(splitTree ? splitTabIds(splitTree)[0] ?? next : next)
    tabs.delete(id); attachVisible(); tab.workspaceId = destination
    const entries = [...target.tabs.entries()]
    const insertion = tab.state.pinned ? entries.findIndex(([, item]) => !item.state.pinned) : -1
    entries.splice(insertion < 0 ? entries.length : insertion, 0, [id, tab])
    target.tabs.clear(); for (const [tabId, entry] of entries) target.tabs.set(tabId, entry)
    if (!target.activeId) target.activeId = id
    suppressSave = false; announcement = `${tab.state.title} moved to ${store.workspaces().find((workspace) => workspace.id === destination)?.name ?? 'Workspace'}.`; publish()
  }
  const addSplit = (id: string, orientation: 'horizontal' | 'vertical', targetId = activeId, before = false): void => {
    if (!activeId || !targetId || !tabs.has(id) || (orientation === 'horizontal' ? bounds.width < 480 : bounds.height < 320)) return
    const next = splitPane(splitTree ?? { type: 'leaf', tabId: activeId }, targetId, id, orientation, before)
    if (!next) return
    splitTree = next; activeId = id; attachVisible(); tabs.get(id)?.view.webContents.focus()
    announcement = 'Split created.'; publish()
  }
  const closeSplit = (id: string): void => {
    if (!splitTree || !splitTabIds(splitTree).includes(id)) return
    const next = removeSplitTab(splitTree, id); const remaining = next ? splitTabIds(next) : []
    splitTree = next?.type === 'split' ? next : null
    activeId = remaining[0] ?? null; attachVisible(); announcement = 'Split closed.'; publish()
  }
  const command = (event: Electron.IpcMainEvent, value: unknown): void => {
    if (!trusted(event) || !isTabCommand(value)) return
    let cmd = value
    if (cmd.type === 'pane-focus') {
      const visible = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []
      if (visible.includes(cmd.id)) activate(cmd.id)
      return
    }
    if (cmd.type === 'pane-command') {
      const visible = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []
      if (!visible.includes(cmd.id) || !tabs.has(cmd.id)) return
      activate(cmd.id)
      cmd = cmd.action === 'navigate' ? { type: 'navigate', value: cmd.value ?? '' } : { type: cmd.action }
    }
    if (cmd.type === 'pane-menu') {
      const id = cmd.id; const tab = tabs.get(id); const visible = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []
      const [width = 0, height = 0] = window.getContentSize()
      if (!tab || !visible.includes(id) || cmd.x > width || cmd.y > height) return
      activate(id)
      Menu.buildFromTemplate([
        { label: 'Back', enabled: tab.state.canGoBack, click: () => tab.view.webContents.navigationHistory.goBack() },
        { label: 'Forward', enabled: tab.state.canGoForward, click: () => tab.view.webContents.navigationHistory.goForward() },
        { label: tab.state.loading ? 'Stop' : 'Reload', enabled: !!tab.state.url, click: () => { if (tab.state.loading) tab.view.webContents.stop(); else tab.view.webContents.reload() } },
        { label: 'Find in Page', click: () => performShortcut('find') },
        { type: 'separator' },
        { label: 'Add or Remove Workspace Favourite', enabled: !!tab.state.url, click: () => { if (!isWebURL(tab.state.url)) return; try { store.toggleFavourite({ id: randomUUID(), workspaceId: activeWorkspaceId, url: tab.state.url, title: tab.state.title || tab.state.url }); publish() } catch (error) { console.error('Unable to update Favourite:', error) } } },
        { label: 'Add or Remove Global Favourite', enabled: !!tab.state.url, click: () => { if (!isWebURL(tab.state.url)) return; try { store.toggleFavourite({ id: randomUUID(), workspaceId: null, url: tab.state.url, title: tab.state.title || tab.state.url }); publish() } catch (error) { console.error('Unable to update Favourite:', error) } } },
        { label: 'Save for Later', enabled: !!tab.state.url, click: () => saveLater(id) },
      ]).popup({ window, x: cmd.x, y: cmd.y })
      return
    }
    if (cmd.type === 'sync') { publish(); return }
    if (cmd.type === 'split-drag-start') {
      splitDragging = true; splitDragToken = cmd.token
      const visible = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []
      const workspace = activeWorkspaceId; const token = cmd.token
      void Promise.all(visible.map(async (id) => {
        const tab = tabs.get(id)
        if (!tab || !tab.view.getVisible() || !tab.loaded || tab.state.loading || tab.view.webContents.isDestroyed()) return [id, ''] as const
        try { return [id, (await tab.view.webContents.capturePage()).toDataURL()] as const } catch { return [id, ''] as const }
      })).then((entries) => {
        if (!window.isDestroyed() && splitDragging && splitDragToken === token && activeWorkspaceId === workspace) window.webContents.send(SPLIT_PREVIEW_CHANNEL, { token, images: Object.fromEntries(entries) })
      })
      if (splitDragTimer) clearTimeout(splitDragTimer)
      splitDragTimer = setTimeout(() => { splitDragging = false; splitViewsHidden = false; splitDragToken = ''; for (const tab of tabs.values()) tab.view.setVisible(tab.presented && !!tab.state.url && !tab.state.error) }, 30000)
      return
    }
    if (cmd.type === 'split-drag-ready' && splitDragging && cmd.token === splitDragToken) {
      splitViewsHidden = true
      for (const tab of tabs.values()) tab.view.setVisible(false)
      return
    }
    if (cmd.type === 'split-drag-end' && cmd.token === splitDragToken) {
      if (splitDragTimer) clearTimeout(splitDragTimer)
      splitDragging = false; splitViewsHidden = false; splitDragToken = ''
      for (const tab of tabs.values()) tab.view.setVisible(tab.presented && !!tab.state.url && !tab.state.error)
      return
    }
    if (cmd.type === 'split-drop') {
      if (splitDragging && cmd.workspaceId === activeWorkspaceId && tabs.has(cmd.id) && tabs.has(cmd.targetId)) addSplit(cmd.id, cmd.edge === 'left' || cmd.edge === 'right' ? 'horizontal' : 'vertical', cmd.targetId, cmd.edge === 'left' || cmd.edge === 'top')
      return
    }

    if (cmd.type === 'app-menu' && process.platform === 'win32') {
      const [width = 0, height = 0] = window.getContentSize()
      if (cmd.x <= width && cmd.y <= height) Menu.getApplicationMenu()?.popup({ window, x: cmd.x, y: cmd.y })
      return
    }
    if (cmd.type === 'find-close') { const current = activeId ? tabs.get(activeId)?.view.webContents : undefined; current?.stopFindInPage('clearSelection'); findOpen = false; findText = ''; current?.focus(); return }
    if (cmd.type === 'find-query' || cmd.type === 'find-step') {
      const current = activeId ? tabs.get(activeId)?.view.webContents : undefined
      if (!current || !findOpen) return
      if (cmd.type === 'find-query') { findText = cmd.value; if (!findText) { current.stopFindInPage('clearSelection'); window.webContents.send(FIND_RESULT_CHANNEL, { matches: 0, activeMatchOrdinal: 0 }); return } findRequest = current.findInPage(findText, { findNext: false }) }
      else if (findText) findRequest = current.findInPage(findText, { forward: cmd.forward, findNext: true })
      return
    }
    if (cmd.type === 'sidebar-width') { try { profiles.setSidebarWidth(cmd.width) } catch (error) { console.error('Unable to save sidebar width:', error) } return }
    if (cmd.type === 'profile-create') {
      const name = cmd.name.trim(); if (!name) return
      const id = randomUUID()
      try { profiles.create(id, name); switchProfile(id, window) } catch (error) { console.error('Unable to create Profile:', error); storageWarning = 'Could not create Profile.'; publish() }
      return
    }
    if (cmd.type === 'profile-rename') {
      const name = cmd.name.trim(); if (name && profiles.list().some((profile) => profile.id === cmd.id)) { profiles.rename(cmd.id, name); publish() } return
    }
    if (cmd.type === 'profile-switch') { try { switchProfile(cmd.id, window) } catch (error) { console.error('Unable to switch Profile:', error); storageWarning = 'Could not switch Profile.'; publish() } return }
    if (cmd.type === 'profile-delete') {
      const id = cmd.id; const target = profiles.list().find((profile) => profile.id === id); const replacement = profiles.list().find((profile) => profile.id !== id)
      if (!target || !replacement || deletingProfiles.has(id)) return
      void dialog.showMessageBox(window, { type: 'warning', title: 'Delete Profile', message: `Delete “${target.name}”?`, detail: 'This permanently deletes the Profile, its Workspaces and saved pages, and its browser data.', buttons: ['Cancel', 'Delete Profile'], defaultId: 0, cancelId: 0 }).then(async (answer) => {
        if (answer.response !== 1 || window.isDestroyed() || profileId !== activeProfileId) return
        if (deletingProfiles.has(id)) return
        deletingProfiles.add(id)
        try {
          if (id === activeProfileId) switchProfile(replacement.id, window)
          await session.fromPartition(profilePartition(id)).clearData()
          await session.fromPartition(profilePartition(id)).clearCache()
          await session.fromPartition(profilePartition(id)).clearAuthCache()
          const path = profilePath(id)
          for (const suffix of ['', '-wal', '-shm']) await unlink(path + suffix).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
          profiles.remove(id)
          if (!window.isDestroyed()) publish(); else { const current = BrowserWindow.getAllWindows()[0]; current?.reload() }
        } catch (error) { console.error('Unable to delete Profile:', error); storageWarning = 'Could not completely delete Profile data.'; if (!window.isDestroyed()) publish(); else BrowserWindow.getAllWindows()[0]?.reload() } finally { deletingProfiles.delete(id) }
      }).catch((error: unknown) => console.error('Profile confirmation failed:', error))
      return
    }
    if (cmd.type === 'group-create' && typeof cmd.name === 'string') { const name = cmd.name.trim().slice(0, 80); if (name) { store.createGroup(activeWorkspaceId, randomUUID(), name, cmd.color || '#55766b'); publish() } return }
    if (cmd.type === 'group-rename' || cmd.type === 'group-color' || cmd.type === 'group-toggle' || cmd.type === 'group-delete') { if (!store.groups(activeWorkspaceId).some((group) => group.id === cmd.id)) return; const action = cmd.type === 'group-rename' ? 'rename' : cmd.type === 'group-color' ? 'color' : cmd.type === 'group-toggle' ? 'toggle' : 'delete'; store.updateGroup(cmd.id, action, 'name' in cmd ? cmd.name.trim().slice(0, 80) : 'color' in cmd ? cmd.color : ''); publish(); return }
    if (cmd.type === 'group-add' && typeof cmd.tabId === 'string' && (cmd.groupId === null || typeof cmd.groupId === 'string')) { const tab = tabs.get(cmd.tabId); if (!tab || tab.state.pinned) return; if (cmd.groupId && !store.groups(activeWorkspaceId).some((group) => group.id === cmd.groupId)) return; store.setTabGroup(cmd.tabId, cmd.groupId, activeWorkspaceId); tab.state.groupId = cmd.groupId; publish(); return }
    if (cmd.type === 'move-to-workspace') { moveToWorkspace(cmd.id, cmd.sourceWorkspaceId, cmd.destinationWorkspaceId); return }
    if (cmd.type === 'history-open' && typeof cmd.url === 'string' && typeof cmd.workspaceId === 'string') {
      const entry = store.history().find((item) => item.url === cmd.url && item.workspaceId === cmd.workspaceId)
      if (entry && store.workspaces().some((workspace) => workspace.id === entry.workspaceId)) { if (entry.workspaceId !== activeWorkspaceId) switchWorkspace(entry.workspaceId); create({ id: randomUUID(), url: entry.url, pinned: false }) }
      return
    }
    if (cmd.type === 'favourite-toggle' && (cmd.scope === 'workspace' || cmd.scope === 'global')) {
      const current = activeId ? tabs.get(activeId)?.state : undefined
      if (!current?.url) return
      try {
        const url = new URL(current.url); if (!['http:', 'https:'].includes(url.protocol)) return
        store.toggleFavourite({ id: randomUUID(), workspaceId: cmd.scope === 'global' ? null : activeWorkspaceId, url: current.url, title: current.title || current.url }); laterError = ''
      } catch (error) { console.error('Unable to update Favourites:', error); laterError = 'Could not update Favourites.' }
      publish(); return
    }
    if ((cmd.type === 'favourite-open' || cmd.type === 'favourite-remove' || cmd.type === 'favourite-move') && typeof cmd.id === 'string') {
      const favourite = store.favourites().find((entry) => entry.id === cmd.id); if (!favourite) return
      try {
        if (cmd.type === 'favourite-open') { if (favourite.workspaceId && favourite.workspaceId !== activeWorkspaceId) switchWorkspace(favourite.workspaceId); create({ id: randomUUID(), url: favourite.url, pinned: false }) }
        else if (cmd.type === 'favourite-remove') store.removeFavourite(favourite.id)
        else if ('direction' in cmd && (cmd.direction === 'up' || cmd.direction === 'down')) store.moveFavourite(favourite.id, cmd.direction)
        laterError = ''
      } catch (error) { console.error('Unable to update Favourites:', error); laterError = 'Could not update Favourites.' }
      publish(); return
    }
    if (cmd.type === 'search-later-open' && typeof cmd.id === 'string' && typeof cmd.workspaceId === 'string') {
      const workspaceId = cmd.workspaceId
      if (!store.workspaces().some((workspace) => workspace.id === workspaceId)) return
      const item = store.later(workspaceId).find((entry) => entry.id === cmd.id); if (!item) return
      if (workspaceId !== activeWorkspaceId) switchWorkspace(workspaceId)
      create({ id: randomUUID(), url: item.url, pinned: false }); return
    }
    if (cmd.type === 'tab-menu' && typeof cmd.id === 'string') {
      const id = cmd.id; const target = tabs.get(id)
      if (!target) return
      const ids = [...tabs.keys()]; const index = ids.indexOf(id)
      const previous = index > 0 ? tabs.get(ids[index - 1] ?? '') : undefined
      const next = tabs.get(ids[index + 1] ?? '')
      Menu.buildFromTemplate([
        { label: 'Split Right', enabled: !!activeId && activeId !== id && (!splitTree || !splitTabIds(splitTree).includes(id)) && (!splitTree || splitTabIds(splitTree).length < 4) && bounds.width >= 480, click: () => addSplit(id, 'horizontal') },
        { label: 'Split Below', enabled: !!activeId && activeId !== id && (!splitTree || !splitTabIds(splitTree).includes(id)) && (!splitTree || splitTabIds(splitTree).length < 4) && bounds.height >= 320, click: () => addSplit(id, 'vertical') },
        { label: 'Close Split', enabled: !!splitTree && splitTabIds(splitTree).includes(id), click: () => closeSplit(id) },
        { type: 'separator' },
        { label: 'Close Tab', click: () => closeTab(id) },
        { label: target.state.pinned ? 'Unpin Tab' : 'Pin Tab', click: () => togglePin(id) },
        { type: 'separator' },
        { label: 'Move Up', enabled: !!previous && previous.state.pinned === target.state.pinned, click: () => moveTab(id, 'up') },
        { label: 'Move Down', enabled: !!next && next.state.pinned === target.state.pinned, click: () => moveTab(id, 'down') },
        { label: 'Move to Workspace', enabled: store.workspaces().some((workspace) => workspace.id !== activeWorkspaceId), submenu: store.workspaces().filter((workspace) => workspace.id !== activeWorkspaceId).map((workspace) => ({ label: workspace.name, click: () => moveToWorkspace(id, activeWorkspaceId, workspace.id) })) },
        { label: 'Add to Group', enabled: !target.state.pinned, submenu: [{ label: 'New Group', click: () => { const groupId = randomUUID(); store.createGroup(activeWorkspaceId, groupId, 'New Group', '#55766b'); store.setTabGroup(id, groupId, activeWorkspaceId); target.state.groupId = groupId; publish() } }, ...store.groups(activeWorkspaceId).map((group) => ({ label: group.name, click: () => { store.setTabGroup(id, group.id, activeWorkspaceId); target.state.groupId = group.id; publish() } })), { label: 'Remove from Group', enabled: !!target.state.groupId, click: () => { store.setTabGroup(id, null, activeWorkspaceId); target.state.groupId = null; publish() } }] },
        { type: 'separator' },
        { label: 'Save for Later', enabled: !!target.state.url, click: () => saveLater(id) },
      ]).popup({ window })
      return
    }
    if (cmd.type === 'save-later' && typeof cmd.id === 'string') { saveLater(cmd.id); return }
    if ((cmd.type === 'later-open' || cmd.type === 'later-remove' || cmd.type === 'later-toggle' || cmd.type === 'later-note') && typeof cmd.id === 'string') {
      const item = store.later(activeWorkspaceId).find((entry) => entry.id === cmd.id)
      if (!item) return
      try {
        if (cmd.type === 'later-open') create({ id: randomUUID(), url: item.url, pinned: false })
        else if (cmd.type === 'later-remove') store.updateLater(activeWorkspaceId, item.id, 'remove')
        else if (cmd.type === 'later-toggle') store.updateLater(activeWorkspaceId, item.id, 'toggle')
        else if ('note' in cmd && typeof cmd.note === 'string') store.updateLater(activeWorkspaceId, item.id, 'note', cmd.note.slice(0, 2000))
        laterError = ''
      } catch (error) { console.error('Unable to update Later:', error); laterError = 'Could not update Later. Please try again.' }
      publish(); return
    }
    if (cmd.type === 'workspace-create' && typeof cmd.name === 'string') {
      const name = cmd.name.trim().slice(0, 80); if (!name) return
      const id = randomUUID(); store.createWorkspace(id, name); switchWorkspace(id); return
    }
    if (cmd.type === 'workspace-rename' && typeof cmd.id === 'string' && typeof cmd.name === 'string') {
      const name = cmd.name.trim().slice(0, 80); if (name && store.workspaces().some((workspace) => workspace.id === cmd.id)) { store.renameWorkspace(cmd.id, name); publish() } return
    }
    if (cmd.type === 'workspace-switch' && typeof cmd.id === 'string') { switchWorkspace(cmd.id); return }
    if (cmd.type === 'workspace-delete' && typeof cmd.id === 'string') {
      const id = cmd.id; const workspaces = store.workspaces(); const workspace = workspaces.find((item) => item.id === id)
      const replacement = workspaces.find((item) => item.id !== id)
      if (!workspace || !replacement) return
      const count = id === activeWorkspaceId ? tabs.size : store.load(id)?.tabs.length ?? 0
      const savedCount = store.later(id).length
      const favouriteCount = store.favourites().filter((item) => item.workspaceId === id).length
      const remove = (): void => {
        const currentWorkspaces = store.workspaces()
        if (window.isDestroyed() || !currentWorkspaces.some((item) => item.id === id)) return
        const fallback = currentWorkspaces.find((item) => item.id !== id)
        if (!fallback) return
        const selected = activeWorkspaceId === id ? fallback.id : activeWorkspaceId
        store.deleteWorkspace(windowId, id, selected)
        if (id === activeWorkspaceId) switchWorkspace(selected, false)
        const deleted = workspaceCache.get(id)
        if (deleted) { workspaceCache.delete(id); for (const tab of deleted.tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close() }
        publish()
      }
      if (count === 0 && savedCount === 0 && favouriteCount === 0) remove()
      else void dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Delete Workspace'], defaultId: 0, cancelId: 0, title: 'Delete Workspace', message: `Delete “${workspace.name}”?`, detail: `This will permanently delete its ${count} ${count === 1 ? 'tab' : 'tabs'} and ${savedCount} Later ${savedCount === 1 ? 'item' : 'items'}, and ${favouriteCount} Workspace ${favouriteCount === 1 ? 'Favourite' : 'Favourites'}.` }).then((result) => { if (result.response === 1) remove() }).catch((error: unknown) => console.error('Unable to confirm Workspace deletion:', error))
      return
    }
    if (cmd.type === 'create') { if (tabs.size < 100) create(); return }
    if (cmd.type === 'reopen') { const saved = closed.shift(); if (saved) { create(saved); publish() } return }
    if (cmd.type === 'pin' && typeof cmd.id === 'string') { togglePin(cmd.id); return }
    if (cmd.type === 'move') { moveTab(cmd.id, cmd.direction); return }
    if (cmd.type === 'reorder-tab') { if (cmd.workspaceId === activeWorkspaceId) reorder(cmd.id, cmd.targetId, cmd.placement); return }
    if (cmd.type === 'activate' && typeof cmd.id === 'string') { activate(cmd.id, true); return }
    if (cmd.type === 'close' && typeof cmd.id === 'string') { closeTab(cmd.id); return }
    let tab = activeId ? tabs.get(activeId) : undefined
    if (cmd.type === 'navigate' && typeof cmd.value === 'string') {
      const input = cmd.value.trim(); if (!input) return
      if (!tab) { create(); tab = activeId ? tabs.get(activeId) : undefined }
      if (!tab) return
      let url: string
      if (/^https?:\/\//i.test(input)) url = input
      else if (/^(localhost(?::\d+)?|[\w-]+(?:\.[\w-]+)+)(?:[/:?#]|$)/i.test(input) && !/\s/.test(input)) url = 'https://' + input
      else url = 'https://www.google.com/search?q=' + encodeURIComponent(input)
      if (!isWebURL(url)) { navigationError = 'Enter a valid web address.'; publish(); return }
      navigationError = ''
      const previousURL = tab.state.url
      tab.loaded = true; tab.state.url = url; tab.state.error = ''; let sameOrigin = false; try { sameOrigin = !!previousURL && new URL(previousURL).origin === new URL(url).origin } catch { /* invalid or new-tab URL */ } if (!sameOrigin) tab.state.favicon = ''; if (tab.presented && !splitViewsHidden) tab.view.setVisible(true); publish()
      void tab.view.webContents.loadURL(url).catch(() => {})
      return
    }
    if (!tab) return
    const contents = tab.view.webContents
    if (cmd.type === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    if (cmd.type === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    if (cmd.type === 'reload') contents.reload()
    if (cmd.type === 'stop') contents.stop()
  }
  let permissionPrompt = false
  const permissionLabels: Record<string, string> = { 'clipboard-read': 'read the clipboard', 'clipboard-sanitized-write': 'write to the clipboard', media: 'use your camera or microphone', geolocation: 'access your location', 'geolocation-approximate': 'access your approximate location', notifications: 'show notifications', fullscreen: 'enter fullscreen' }
  pageSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const label = permissionLabels[permission]; const parent = window
    let origin: string
    try { const url = new URL(details.requestingUrl); if (url.protocol !== 'https:' || !details.isMainFrame || !label || parent.isDestroyed() || permissionPrompt || !contents.isFocused() || !activeId || tabs.get(activeId)?.view.webContents !== contents) { callback(false); return } origin = url.origin } catch { callback(false); return }
    const requestingURL = contents.getURL(); permissionPrompt = true
    void dialog.showMessageBox(parent, { type: 'question', buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0, title: 'Website permission', message: `Allow ${origin} to ${label}?`, detail: 'This choice applies to this request.' }).then((result) => { permissionPrompt = false; let sameOrigin = false; try { sameOrigin = !contents.isDestroyed() && contents.getURL() === requestingURL && !!activeId && tabs.get(activeId)?.view.webContents === contents && new URL(contents.getURL()).origin === origin } catch { /* navigation or closure */ } callback(result.response === 1 && sameOrigin) }).catch(() => { permissionPrompt = false; callback(false) })
  })
  const onDownload = (_event: Electron.Event, item: Electron.DownloadItem, source: WebContents): void => {
    const owned = [...tabs.values(), ...[...workspaceCache.values()].flatMap((workspace) => [...workspace.tabs.values()])].some((tab) => tab.view.webContents === source)
    if (!owned) { item.cancel(); return }
    const state: DownloadState = { id: randomUUID(), filename: item.getFilename(), received: 0, total: item.getTotalBytes(), status: 'Choosing where to save' }
    downloads.unshift(state)
    if (downloads.length > 100) downloads.length = 100
    item.setSaveDialogOptions({ title: 'Save download', defaultPath: join(app.getPath('downloads'), basename(item.getFilename().replaceAll('\\', '/')) || 'download') })
    item.on('updated', (_event, status) => { state.received = item.getReceivedBytes(); state.total = item.getTotalBytes(); state.status = status === 'interrupted' ? 'Interrupted' : item.isPaused() ? 'Paused' : 'Downloading'; publish() })
    item.once('done', (_event, status) => { state.received = item.getReceivedBytes(); state.total = item.getTotalBytes(); state.status = status === 'completed' ? 'Complete' : status === 'cancelled' ? 'Cancelled' : 'Failed'; publish() })
    publish()
  }
  pageSession.on('will-download', onDownload)
  const menuItem = (label: string, accelerator: string, action: BrowserShortcut): Electron.MenuItemConstructorOptions => ({ label, accelerator, click: () => performShortcut(action) })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [menuItem('New Tab', 'CommandOrControl+T', 'new-tab'), menuItem('Close Tab', 'CommandOrControl+W', 'close-tab'), menuItem('Reopen Closed Tab', 'CommandOrControl+Shift+T', 'reopen'), ...(process.platform === 'darwin' ? [] : [{ role: 'quit' as const }])] },
    { role: 'editMenu' },
    { label: 'View', submenu: [menuItem('Show or Hide Sidebar', 'CommandOrControl+Shift+S', 'sidebar'), menuItem('Search Saved Pages', 'CommandOrControl+Shift+F', 'saved-search'), { label: 'Downloads', click: () => performShortcut('downloads') }, { label: 'Save Tab for Later', click: () => { if (activeId) saveLater(activeId) } }, menuItem('Find in Page', 'CommandOrControl+F', 'find'), menuItem('Reload', 'CommandOrControl+R', 'reload'), { type: 'separator' }, menuItem('Zoom In', 'CommandOrControl+Plus', 'zoom-in'), menuItem('Zoom Out', 'CommandOrControl+-', 'zoom-out'), menuItem('Actual Size', 'CommandOrControl+0', 'zoom-reset')] },
    { label: 'Navigate', submenu: [menuItem('Address Bar', 'CommandOrControl+L', 'address'), menuItem('Back', 'CommandOrControl+[', 'back'), menuItem('Forward', 'CommandOrControl+]', 'forward'), { type: 'separator' }, menuItem('Next Tab', 'Control+Tab', 'next-tab'), menuItem('Previous Tab', 'Control+Shift+Tab', 'previous-tab'), ...(process.platform === 'darwin' ? [menuItem('Next Tab (Alternative)', 'Command+Shift+]', 'next-tab'), menuItem('Previous Tab (Alternative)', 'Command+Shift+[', 'previous-tab')] : []), ...Array.from({ length: 9 }, (_, i) => menuItem(i === 8 ? 'Last Tab' : `Tab ${i + 1}`, `CommandOrControl+${i + 1}`, `tab-${i + 1}`))] },
    { role: 'windowMenu' },
  ]))
  if (process.platform === 'win32') window.setMenuBarVisibility(false)
  if (process.platform === 'darwin') window.on('swipe', (_event, direction) => { const current = activeId ? tabs.get(activeId)?.view.webContents : undefined; if (!current?.isFocused() || !systemPreferences.isSwipeTrackingFromScrollEventsEnabled()) return; if (direction === 'right') performShortcut('back'); else if (direction === 'left') performShortcut('forward') })
  installShortcuts(window.webContents)
  ipcMain.on(VIEW_BOUNDS_CHANNEL, updateBounds)
  ipcMain.on(TAB_COMMAND_CHANNEL, command)
  window.on('resize', layout)
  window.on('closed', () => {
    nativeTheme.removeListener('updated', updateMaterial)
    nativeTheme.removeListener('updated', updatePageBackings)
    if (splitDragTimer) clearTimeout(splitDragTimer)
    pageSession.removeListener('will-download', onDownload)
    pageSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    ipcMain.removeListener(VIEW_BOUNDS_CHANNEL, updateBounds)
    ipcMain.removeListener(TAB_COMMAND_CHANNEL, command)
    for (const tab of tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    tabs.clear()
    for (const workspace of workspaceCache.values()) for (const tab of workspace.tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    workspaceCache.clear()
  })
  const saved = store.load(activeWorkspaceId)
  if (saved) { closed = saved.closed; for (const tab of saved.tabs) create(tab, false); regroupTabs(); activate(saved.activeId) }
  else create()
  splitTree = store.loadSplitTree(activeWorkspaceId, new Set(tabs.keys()))
  if (splitTree?.type === 'leaf') splitTree = null
  if (splitTree && (!activeId || !splitTabIds(splitTree).includes(activeId))) activeId = splitTabIds(splitTree)[0] ?? null
  restoring = false
  attachVisible()
  const initial = activeId ? tabs.get(activeId) : undefined
  if (initial) loadTab(initial)
  publish()

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  void window.loadURL(rendererURL).catch((error: unknown) => {
    console.error('Unable to load Idle:', error)
    app.quit()
  })
}

function openProfile(id: string): SessionStore {
  try {
    const candidate = new SessionStore(profilePath(id))
    try { candidate.workspaces(); candidate.load(candidate.activeWorkspace(windowId)) } catch (error) { candidate.close(); throw error }
    storageWarning = ''
    return candidate
  } catch (error) {
    console.error('Session database unavailable; using temporary storage:', error)
    storageWarning = 'Session storage is unavailable. Changes will be lost when Idle closes.'
    return new SessionStore(':memory:')
  }
}
function switchProfile(id: string, window: BrowserWindow): void {
  if (id === activeProfileId || deletingProfiles.has(id) || !profiles.list().some((profile) => profile.id === id)) return
  const next = openProfile(id)
  try { profiles.select(id) } catch (error) { next.close(); throw error }
  switchingProfile = true
  try { window.destroy(); store.close(); store = next; activeProfileId = id; createWindow() } finally { switchingProfile = false }
}

void app.whenReady().then(() => {
  profiles = new ProfileRegistry(join(app.getPath('userData'), 'profiles.sqlite'))
  activeProfileId = profiles.active()
  store = openProfile(activeProfileId)
  app.on('second-instance', () => { const existing = BrowserWindow.getAllWindows()[0]; if (existing) { if (existing.isMinimized()) existing.restore(); existing.focus() } })
  app.on('will-quit', () => { store.close(); profiles.close() })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  ipcMain.handle(APP_INFO_CHANNEL, (event): AppInfo => {
    const frame = event.senderFrame
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.webContents !== event.sender || !frame || frame !== event.sender.mainFrame || frame.url !== rendererURL) {
      throw new Error('Untrusted IPC sender')
    }
    return { name: app.getName(), version: app.getVersion() }
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !switchingProfile) app.quit()
})

