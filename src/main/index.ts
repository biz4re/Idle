import { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, Menu, shell, nativeTheme, type WebContents } from 'electron'
import appIcon from '../../resources/icon.png?asset'
import { join, basename } from 'node:path'
import { release } from 'node:os'
import { browserShortcut, shortcutAccelerator, type BrowserShortcut } from './shortcuts'
import { visibleProfiles } from '../shared/profile-switcher'
import { WELCOME_URL } from '../shared/welcome'
import { canRestorePane, nextFocusTarget } from '../shared/focus-navigation'
import { groupPinnedTabs, reorderTabs } from '../shared/tab-order'
import { splitPane, splitTabIds, removeSplitTab, type SplitTree } from '../shared/split-tree'
import { peekBounds } from '../shared/peek-layout'
import { shouldPeekLink } from '../shared/peek-link'
import { PeekNavigationGuard } from './peek-navigation'
import { popupRoute } from './popup-policy'
import { isTabCommand, isViewBounds, isWebURL } from './security'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { ProfileRegistry } from './profiles'
import { SessionStore, type SavedTab } from './session'
import { sessionSaveKey } from './session-dedup'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { autoUpdater, NsisUpdater } from 'electron-updater'
import { UpdateService } from './update-service'
import { verifyUpdateSignature } from './update-signature'
import { UPDATE_CHANNEL, UPDATE_STATE_CHANNEL, type UpdateState } from '../shared/ipc'
import { ONBOARDING_CHANNEL, APP_INFO_CHANNEL, SPLIT_PREVIEW_CHANNEL, VIEW_BOUNDS_CHANNEL, TAB_COMMAND_CHANNEL, TAB_STATE_CHANNEL, WORKSPACE_SWITCH_CHANNEL, PROFILE_SWITCH_CHANNEL, SHORTCUT_CHANNEL, BROWSER_ACTION_CHANNEL, FIND_RESULT_CHANNEL, PEEK_HOST_CHANNEL, type BrowserState, type DownloadState, type TabState, type ViewBounds, type AppInfo } from '../shared/ipc'

app.setName('Idle')
app.enableSandbox()

let store: SessionStore
let profiles: ProfileRegistry
let activeProfileId = 'default'
let stateRevision = 0
let settingsOpen = false
let updateService: UpdateService
let saveForUpdate: (() => Promise<void>) | undefined
const deletingProfiles = new Set<string>()
const profilePath = (id: string): string => join(app.getPath('userData'), id === 'default' ? 'session.sqlite' : `profile-${id}.sqlite`)
const profilePartition = (id: string): string => `persist:idle-profile-${id}`
let storageWarning = ''
const windowId = 'main'
type ProfileContext = { activate: () => void; deactivate: () => void; dispose: (closeStore?: boolean) => void; publish: () => void; flush: () => Promise<void>; evictable: () => boolean; store: SessionStore }
const profileContexts = new Map<string, ProfileContext>()
const profileFindQueries = new Map<string, string>()
let lastViewBounds: ViewBounds = { x: 0, y: 0, width: 0, height: 0 }
if (!app.requestSingleInstanceLock()) app.quit()

const rendererFile = join(__dirname, '../renderer/index.html')
const rendererURL = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  ? new URL(process.env.ELECTRON_RENDERER_URL).href
  : pathToFileURL(rendererFile).href

function createWindow(): void {
  settingsOpen = !profiles.onboardingComplete()
  const supportsMica = process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22621
  const useMaterial = (): boolean => !nativeTheme.prefersReducedTransparency && !nativeTheme.shouldUseHighContrastColors && (supportsMica || process.platform === 'darwin')
  const solidColor = (): string => nativeTheme.shouldUseDarkColors ? '#202120' : '#f1f0ed'
  const window = new BrowserWindow({
    title: 'Idle',
    icon: appIcon,
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
  window.once('closed', () => { nativeTheme.removeListener('updated', updateMaterial); profileContexts.clear() })
  const initial = createProfileContext(window, activeProfileId, store)
  profileContexts.set(activeProfileId, initial)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  void window.loadURL(rendererURL).catch((error: unknown) => { console.error('Unable to load Idle:', error); app.quit() })
}

function createProfileContext(window: BrowserWindow, profileId: string, store: SessionStore): ProfileContext {
  let contextStorageWarning = storageWarning
  const pageSession = session.fromPartition(profilePartition(profileId))
  pageSession.setPermissionCheckHandler(() => false)
  let disposed = false
  let contextActive = false
  const childWindows = new Set<BrowserWindow>()
  const hiddenChildWindows = new Set<BrowserWindow>()
  type Tab = { view: WebContentsView; state: TabState; loaded: boolean; presented: boolean; workspaceId: string }
  type WorkspaceTabs = { tabs: Map<string, Tab>; activeId: string | null; closed: SavedTab[]; splitTree: SplitTree | null }
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
  let bounds: ViewBounds = lastViewBounds
  let closed: SavedTab[] = []
  let restoring = true
  let suppressSave = false
  let laterError = ''
  let navigationError = ''
  let announcement = ''
  const downloads: DownloadState[] = []
  let findOpen = false
  let findText = profileFindQueries.get(profileId) ?? ''
  let findRequest = 0
  const savedSessionKeys = new Map<string, string>()
  const saveSession = (workspaceId: string, states: TabState[], selected: string | null, recentlyClosed: SavedTab[], tree?: SplitTree | null): void => {
    const key = sessionSaveKey(states, selected, recentlyClosed, tree)
    if (savedSessionKeys.get(workspaceId) === key) return
    store.save(workspaceId, states, selected, recentlyClosed, tree)
    savedSessionKeys.set(workspaceId, key)
  }
  const saveContextForUpdate = async () => {
    if (contextStorageWarning) throw new Error(contextStorageWarning)
    saveSession(activeWorkspaceId, [...tabs.values()].map((tab) => tab.state), activeId, closed, splitTree)
    for (const [id, cached] of workspaceCache) saveSession(id, [...cached.tabs.values()].map((tab) => tab.state), cached.activeId, cached.closed, cached.splitTree)
    await pageSession.cookies.flushStore()
    await pageSession.flushStorageData()
  }
  const peeks = new Map<string, { page: WebContentsView; toolbar: WebContentsView; backdrop: WebContentsView }>()
  const peekNavigation = new PeekNavigationGuard()
  const closePeek = (id: string, focus = false): void => {
    const pair = peeks.get(id); if (!pair) return
    peeks.delete(id)
    for (const view of [pair.toolbar, pair.page, pair.backdrop]) {
      if (!window.isDestroyed()) window.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    const visible = splitTree ? splitTabIds(splitTree).includes(id) : activeId === id
    const source = tabs.get(id)?.view.webContents
    if (focus && visible && !window.isDestroyed() && source && !source.isDestroyed()) { activeId = id; source.focus() }
  }
  const trusted = (event: Electron.IpcMainEvent): boolean => profileId === activeProfileId && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === rendererURL
  let lastPublishedState: BrowserState | undefined
  const publish = (): void => {
    if (disposed || restoring || window.isDestroyed() || profileId !== activeProfileId) return
    const states = [...tabs.values()].map((tab) => tab.state)
    if (!restoring && !suppressSave) { try { saveSession(activeWorkspaceId, states, activeId, closed, splitTree) } catch (error) { console.error('Unable to save session:', error); contextStorageWarning = 'Session changes could not be saved. Check available disk space and restart Idle.' } }
    const workspaces = store.workspaceSummaries()
    const later = store.later(activeWorkspaceId)
    storageWarning = contextStorageWarning
    lastPublishedState = { revision: ++stateRevision, peekMode: profiles.peekMode(profileId), splitTree, tabs: states, groups: store.groups(activeWorkspaceId), activeId, recentlyClosed: closed.length, workspaces, activeWorkspaceId, later, laterError, favourites: store.favourites(), searchLater: workspaces.flatMap((workspace) => workspace.id === activeWorkspaceId ? later : store.later(workspace.id)), history: store.history(), downloads, storageWarning: contextStorageWarning, profiles: profiles.list(), activeProfileId: profileId, sidebarWidth: profiles.sidebarWidth(), navigationError, announcement }
    if (!window.isDestroyed()) window.webContents.send(TAB_STATE_CHANNEL, lastPublishedState)
    announcement = ''
  }
  const layout = (): void => {
    if (disposed || profileId !== activeProfileId || window.isDestroyed()) return
    const [width = 0, height = 0] = window.getContentSize()
    const x = Math.min(width, Math.round(bounds.x)); const y = Math.min(height, Math.round(bounds.y))
    const rect = { x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.width))), height: Math.max(0, Math.min(height - y, Math.round(bounds.height))) }
    const place = (node: SplitTree, area: typeof rect): void => {
      if (node.type === 'leaf') { const top = Math.min(area.height, Math.round(44 * (bounds.uiScale ?? 1))); tabs.get(node.tabId)?.view.setBounds({ x: area.x + 1, y: area.y + top, width: Math.max(0, area.width - 2), height: Math.max(0, area.height - top - 1) }); return }
      const gap = Math.round(8 * (bounds.uiScale ?? 1)); const horizontal = node.orientation === 'horizontal'
      const size = horizontal ? area.width : area.height
      const first = Math.max(0, Math.round((size - gap) * node.ratio)); const second = Math.max(0, size - gap - first)
      if (horizontal) { place(node.first, { ...area, width: first }); place(node.second, { ...area, x: area.x + first + gap, width: second }) }
      else { place(node.first, { ...area, height: first }); place(node.second, { ...area, y: area.y + first + gap, height: second }) }
    }
    if (splitTree) place(splitTree, rect)
    else if (activeId) { const top = Math.min(rect.height, Math.round(44 * (bounds.uiScale ?? 1))); tabs.get(activeId)?.view.setBounds({ ...rect, y: rect.y + top, height: Math.max(0, rect.height - top) }) }
    for (const [id, pair] of peeks) {
      const source = tabs.get(id); if (!source || !(splitTree ? splitTabIds(splitTree).includes(id) : activeId === id)) { closePeek(id); continue }
      const result = peekBounds(rect)
      pair.backdrop.setBounds(rect); pair.toolbar.setBounds(result.toolbar); pair.page.setBounds(result.page)
    }
  }
  const loadTab = (tab: Tab): void => {
    if (tab.loaded || !tab.state.url) return
    tab.loaded = true
    const history = store.loadNavigation(tab.state.id)
    if (history && history.entries[history.index]?.url === tab.state.url) void tab.view.webContents.navigationHistory.restore(history).catch(() => {})
    else void tab.view.webContents.loadURL(tab.state.url).catch(() => {})
  }
  const attachVisible = (): void => {
    if (disposed || profileId !== activeProfileId || window.isDestroyed()) return
    const visible = settingsOpen ? [] : splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []
    for (const [tabId, tab] of tabs) {
      if (visible.includes(tabId)) { window.contentView.addChildView(tab.view); if (!restoring) loadTab(tab) }
      else window.contentView.removeChildView(tab.view)
    }
    for (const pair of peeks.values()) { window.contentView.addChildView(pair.backdrop); window.contentView.addChildView(pair.page); window.contentView.addChildView(pair.toolbar) }
    layout()
  }
  const setSettingsOpen = (open: boolean): void => {
    if (settingsOpen === open) return
    settingsOpen = open
    if (open) {
      for (const id of [...peeks.keys()]) closePeek(id)
      if (splitDragTimer) clearTimeout(splitDragTimer)
      splitDragging = false; splitViewsHidden = false; splitDragToken = ''
      for (const tab of tabs.values()) tab.view.setVisible(tab.presented && !!tab.state.url && !tab.state.error)
      if (findOpen) { const current = activeId ? tabs.get(activeId)?.view.webContents : undefined; if (current && !current.isDestroyed()) current.stopFindInPage('clearSelection'); findOpen = false; window.webContents.send(BROWSER_ACTION_CHANNEL, 'dismiss') }
      window.webContents.focus()
    }
    attachVisible()
    if (!open) window.webContents.focus()
  }
  const activate = (id: string | null, focusPage = false): void => {
    if (id !== null && !tabs.has(id)) return
    if (id === activeId) { if (focusPage && id && !settingsOpen) tabs.get(id)?.view.webContents.focus(); return }
    navigationError = ''
    const old = activeId ? tabs.get(activeId) : undefined
    if (findOpen) { old?.view.webContents.stopFindInPage('clearSelection'); findOpen = false; window.webContents.send(BROWSER_ACTION_CHANNEL, 'dismiss') }
    if (splitTree && id && !splitTabIds(splitTree).includes(id) && activeId) {
      const replace = (node: SplitTree): SplitTree => node.type === 'leaf' ? (node.tabId === activeId ? { type: 'leaf', tabId: id } : node) : { ...node, first: replace(node.first), second: replace(node.second) }
      splitTree = replace(splitTree)
    }
    activeId = id
    attachVisible()
    if (focusPage && id && !settingsOpen) tabs.get(id)?.view.webContents.focus()
    publish()
  }
  const create = (saved?: SavedTab, select = true, workspaceId = activeWorkspaceId, destination = tabs): WebContents => {
    const id = saved?.id ?? randomUUID()
    const view = new WebContentsView({ webPreferences: { preload: join(__dirname, '../preload/page.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, partition: profilePartition(profileId) } })
    // Keep native backing consistent with the canvas during resize and loading.
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#292b29' : '#fbfaf8')
    view.setBorderRadius(15)
    const state: TabState = { id, url: saved?.url ?? '', pinned: saved?.pinned ?? false, groupId: saved?.groupId ?? null, title: saved?.url || 'New tab', favicon: saved?.favicon ?? '', loading: false, canGoBack: false, canGoForward: false, error: '' }
    view.setVisible(false)
    const ownedTab: Tab = { view, state, loaded: false, presented: false, workspaceId }
    destination.set(id, ownedTab)
    const contents = view.webContents
    contents.once('destroyed', () => { peekNavigation.clear(id); closePeek(id) })
    let savedNavigationKey = ''
    let welcomeHttpFailure = false
    const refresh = (): void => {
      const ownerId = ownedTab.workspaceId
      const ownerTabs = ownerId === activeWorkspaceId ? tabs : workspaceCache.get(ownerId)?.tabs
      if (window.isDestroyed() || disposed || contents.isDestroyed() || ownerTabs?.get(id) !== ownedTab) return
      state.canGoBack = contents.navigationHistory.canGoBack(); state.canGoForward = contents.navigationHistory.canGoForward()
      const history = contents.navigationHistory; const entries = history.getAllEntries(); const index = history.getActiveIndex()
      if (entries.length && entries.length <= 100 && entries[index]?.url === state.url) { const key = JSON.stringify([entries, index]); if (key !== savedNavigationKey) { try { if (store.saveNavigation(id, entries, index)) savedNavigationKey = key } catch (error) { console.error('Unable to save tab navigation:', error); contextStorageWarning = 'Session changes could not be saved. Check available disk space and restart Idle.' } } }
      if (ownerId === activeWorkspaceId && profileId === activeProfileId) publish()
      else if (ownerId === activeWorkspaceId) { try { saveSession(ownerId, [...ownerTabs.values()].map((tab) => tab.state), activeId, closed, splitTree) } catch (error) { console.error('Unable to save inactive Profile session:', error); contextStorageWarning = 'Session changes could not be saved. Check available disk space and restart Idle.' } }
      else {
        const cached = workspaceCache.get(ownerId)
        if (cached) { try { saveSession(ownerId, [...ownerTabs.values()].map((tab) => tab.state), cached.activeId, cached.closed, cached.splitTree) } catch (error) { console.error('Unable to save session:', error); contextStorageWarning = 'Session changes could not be saved. Check available disk space and restart Idle.' } }
      }
    }
    installShortcuts(contents)
    contents.on('focus', () => { if (profileId !== activeProfileId) return; if (!window.isDestroyed()) window.webContents.send(BROWSER_ACTION_CHANNEL, 'dismiss-workspace-actions'); if (ownedTab.workspaceId === activeWorkspaceId && splitTree && splitTabIds(splitTree).includes(id) && activeId !== id) activate(id) })
    contents.setWindowOpenHandler(({ url, disposition, postBody }) => {
      if (profileId !== activeProfileId || ownedTab.workspaceId !== activeWorkspaceId || activeId !== id || !contents.isFocused() || tabs.size >= 100) return { action: 'deny' }
      const route = popupRoute(url, disposition, !!postBody)
      if (route === 'external') { void confirmExternal(url, contents); return { action: 'deny' } }
      if (route === 'window') return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, partition: profilePartition(profileId) } } }
      if (route === 'tab' && !peekNavigation.consume(id, url)) {
        setImmediate(() => { if (!window.isDestroyed() && profileId === activeProfileId && ownedTab.workspaceId === activeWorkspaceId && tabs.get(id) === ownedTab && tabs.size < 100) create({ id: randomUUID(), url, pinned: false }, disposition !== 'background-tab') })
      }
      return { action: 'deny' }
    })
    contents.on('did-create-window', (popup) => {
      childWindows.add(popup); popup.once('closed', () => childWindows.delete(popup))
      const child = popup.webContents
      child.on('will-navigate', (event, url) => { if (!isWebURL(url) && url !== 'about:blank') { event.preventDefault(); if (child.isFocused()) void confirmExternal(url, child) } })
      child.on('will-redirect', (event, url) => { if (!isWebURL(url) && url !== 'about:blank') event.preventDefault() })
      child.setWindowOpenHandler(({ url }) => { if (!isWebURL(url) && url !== 'about:blank') { if (child.isFocused()) void confirmExternal(url, child); return { action: 'deny' } } return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, partition: profilePartition(profileId) } } } })
    })
    contents.on('context-menu', (_event, params) => {
      if (profileId !== activeProfileId) return
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
    contents.on('will-navigate', (event, url) => { if (peekNavigation.consume(id, url)) { event.preventDefault(); return } if (!isWebURL(url)) { event.preventDefault(); if (activeId === id && contents.isFocused()) void confirmExternal(url, contents) } })
    contents.on('will-frame-navigate', (event) => { if (!event.isMainFrame && !isWebURL(event.url) && event.url !== 'about:blank' && event.url !== 'about:srcdoc' && !/^(?:blob:|data:)/i.test(event.url)) event.preventDefault() })
    contents.on('will-redirect', (event, url) => { if (!isWebURL(url)) event.preventDefault() })
    contents.on('found-in-page', (_event, result) => { if (activeId === id && ownedTab.workspaceId === activeWorkspaceId && findOpen && result.requestId === findRequest && !window.isDestroyed()) window.webContents.send(FIND_RESULT_CHANNEL, { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal }) })
    contents.on('did-start-loading', () => { welcomeHttpFailure = false; state.loading = true; state.error = ''; refresh() })
    const revealLoadedPage = (): void => {
      if (contents.isDestroyed() || state.error || !isWebURL(contents.getURL())) return
      ownedTab.presented = true
      if (!splitViewsHidden) view.setVisible(true)
    }
    contents.on('did-finish-load', () => { const title = contents.getTitle().trim(); if (title) state.title = title; revealLoadedPage() })
    contents.on('did-stop-loading', () => { state.loading = false; if (!ownedTab.presented) revealLoadedPage(); refresh() })
    contents.on('did-navigate', (_event, url) => { if (window.isDestroyed() || disposed) return; const previousURL = state.url; state.url = url; state.title = ''; state.error = url === WELCOME_URL && welcomeHttpFailure ? 'Page unavailable' : ''; let sameOrigin = false; try { sameOrigin = !!previousURL && new URL(previousURL).origin === new URL(url).origin } catch { /* invalid or new-tab URL */ } if (!sameOrigin) state.favicon = ''; try { store.recordHistory(ownedTab.workspaceId, url, url) } catch (error) { console.error('Unable to record history:', error) } refresh() })
    contents.on('did-frame-navigate', (_event, url, status, _statusText, main) => { if (main && status >= 400 && url === WELCOME_URL) { welcomeHttpFailure = true; state.url = url; state.error = `HTTP ${status}`; view.setVisible(false); refresh() } })
    contents.on('did-navigate-in-page', (_event, url, main) => { if (main) { state.url = url; refresh() } })
    contents.on('page-title-updated', (_event, title) => { if (window.isDestroyed() || disposed) return; state.title = title; if (state.url) { try { store.recordHistory(ownedTab.workspaceId, state.url, title) } catch (error) { console.error('Unable to record history:', error) } } refresh() })
    contents.on('page-favicon-updated', (_event, icons) => { if (window.isDestroyed() || disposed) return; const icon = icons.find((value) => value.length <= 8192 && /^(?:https?:|data:image\/|chrome:\/\/favicon\/)/i.test(value)); state.favicon = icon && !/^chrome:\/\/favicon\//i.test(icon) ? icon : ''; refresh() })
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
    if (answer.response === 1 && profileId === activeProfileId && !disposed && !window.isDestroyed() && !source.isDestroyed() && source.getURL() === sourceURL) await shell.openExternal(value).catch((error: unknown) => console.error('Unable to open external link:', error))
  }
  const performShortcut = (action: BrowserShortcut): void => {
    if (disposed || profileId !== activeProfileId) return
    if (action === 'settings') { const origin = activeId && tabs.get(activeId)?.view.webContents.isFocused() ? activeId : null; setSettingsOpen(true); window.webContents.send(BROWSER_ACTION_CHANNEL, 'settings', origin); return }
    if (settingsOpen && (['address', 'new-tab', 'reopen', 'next-tab', 'previous-tab'].includes(action) || action.startsWith('tab-'))) { setSettingsOpen(false); window.webContents.send(BROWSER_ACTION_CHANNEL, 'settings-close') }
    const current = activeId ? tabs.get(activeId)?.view.webContents : undefined
    if (action === 'focus-next' || action === 'focus-previous') { if (settingsOpen) return; const panes = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []; const focused = panes.find((id) => tabs.get(id)?.view.webContents.isFocused()) ?? null; const target = nextFocusTarget(panes, focused, activeId, action === 'focus-previous'); if (!target) { window.webContents.focus(); window.webContents.send(BROWSER_ACTION_CHANNEL, 'focus-chrome') } else { activate(target); const tab = tabs.get(target); if (tab?.presented && !tab.view.webContents.isDestroyed()) tab.view.webContents.focus(); else { window.webContents.focus(); window.webContents.send(SHORTCUT_CHANNEL, target) } } return }
    if (action === 'profile-1' || action === 'profile-2') { const target = visibleProfiles(profiles.list(), activeProfileId)[action === 'profile-1' ? 0 : 1]; try { if (target) switchProfile(target.id, window); else if (action === 'profile-2' && profiles.list().length === 1 && !profiles.list().some((profile) => profile.icon === 'work' || profile.name.trim().toLowerCase() === 'work')) { const id = randomUUID(); profiles.create(id, 'Work'); switchProfile(id, window) } } catch (error) { console.error('Unable to switch Profile:', error) } return }
    if (action === 'workspace-next' || action === 'workspace-previous') { window.webContents.send(BROWSER_ACTION_CHANNEL, action); return }
    if (action === 'save-later') { if (activeId) saveLater(activeId); return }
    if (action === 'toggle-split') { if (activeId && splitTree) closeSplit(activeId); else if (activeId && bounds.width >= 480) { let other = [...tabs.keys()].find((id) => id !== activeId); if (!other && tabs.size < 100) { other = randomUUID(); create({ id: other, url: '', pinned: false }, false) } if (other) { addSplit(other, 'horizontal'); if (activeId === other && !tabs.get(other)?.state.url) { window.webContents.focus(); window.webContents.send(SHORTCUT_CHANNEL, other) } } } return }
    if (action === 'sidebar' || action === 'command-menu' || action === 'downloads' || action === 'history') { const origin = activeId && current?.isFocused() ? activeId : null; window.webContents.focus(); window.webContents.send(BROWSER_ACTION_CHANNEL, action, origin); return }
    if (action === 'address') { if (!activeId && tabs.size < 100) create(); window.webContents.focus(); window.webContents.send(SHORTCUT_CHANNEL, activeId); return }
    if (action === 'new-tab') { if (tabs.size < 100) create(); window.webContents.focus(); window.webContents.send(SHORTCUT_CHANNEL, activeId); return }
    if (action === 'close-tab') { if (activeId) closeTab(activeId); return }
    if (action === 'reopen') { const saved = closed.shift(); if (saved) { create(saved); publish() } return }
    if (action === 'find') { if (current) { findOpen = true; window.webContents.focus(); window.webContents.send(BROWSER_ACTION_CHANNEL, 'find') } return }
    if (action === 'dismiss') { if (findOpen) { current?.stopFindInPage('clearSelection'); findOpen = false; window.webContents.send(BROWSER_ACTION_CHANNEL, 'dismiss'); current?.focus() } return }
    if (action === 'favourite') { const state = activeId ? tabs.get(activeId)?.state : undefined; if (state?.url && isWebURL(state.url) && !store.favourites().some((item) => item.workspaceId === null && item.url === state.url)) { try { store.toggleFavourite({ id: randomUUID(), workspaceId: null, url: state.url, title: state.title || state.url }); publish() } catch (error) { console.error('Unable to update Favourites:', error) } } return }
    if (action === 'print') { current?.print(); return }
    if (action === 'devtools') { current?.toggleDevTools(); return }
    if (action === 'find-next' || action === 'find-previous') { if (current && findText) { const wasOpen = findOpen; if (!wasOpen) performShortcut('find'); findRequest = current.findInPage(findText, { forward: action === 'find-next', findNext: wasOpen }) } else if (current && !findOpen) performShortcut('find'); return }
    if (action === 'hard-reload') { if (current?.getURL()) current.reloadIgnoringCache(); return }
    if (action === 'reload') { if (current?.getURL()) current.reload(); return }
    if (action === 'back' && current?.navigationHistory.canGoBack()) { current.navigationHistory.goBack(); return }
    if (action === 'forward' && current?.navigationHistory.canGoForward()) { current.navigationHistory.goForward(); return }
    if ((action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset') && current) { const level = action === 'zoom-reset' ? 0 : current.getZoomLevel() + (action === 'zoom-in' ? 1 : -1); current.setZoomLevel(Math.max(-7, Math.min(8, level))); return }
    const ids = [...tabs.keys()]; if (!ids.length) return
    if (action === 'next-tab' || action === 'previous-tab') { const index = Math.max(0, ids.indexOf(activeId ?? '')); const id = ids[(index + (action === 'next-tab' ? 1 : ids.length - 1)) % ids.length]; if (id) activate(id, true); return }
    if (action.startsWith('tab-')) { const number = Number(action.slice(4)); const id = number === 9 ? ids[ids.length - 1] : ids[number - 1]; if (id) activate(id, true) }
  }
  const installShortcuts = (contents: WebContents): (() => void) => {
    const listener = (event: Electron.Event, input: Electron.Input): void => {
      if (profileId !== activeProfileId) return
      if (input.type === 'keyUp') { contents.setIgnoreMenuShortcuts(false); return }
      const action = browserShortcut({ ...input, isAutoRepeat: false }, process.platform === 'darwin')
      contents.setIgnoreMenuShortcuts(!!action)
      if (!action || (action === 'dismiss' && !findOpen)) return
      event.preventDefault(); if (input.isAutoRepeat) return
      const focused = [...tabs.entries()].find(([, tab]) => tab.view.webContents === contents && tab.workspaceId === activeWorkspaceId)
      if (focused && focused[0] !== activeId && splitTree && splitTabIds(splitTree).includes(focused[0])) activate(focused[0])
      performShortcut(action)
    }
    contents.on('before-input-event', listener)
    return () => { if (!contents.isDestroyed()) { contents.removeListener('before-input-event', listener); contents.setIgnoreMenuShortcuts(false) } }
  }
  const switchWorkspace = (id: string, persistSelection = true): void => {
    if (id === activeWorkspaceId || !store.workspaces().some((workspace) => workspace.id === id)) return
    const pageHadFocus = !!(activeId && tabs.get(activeId)?.view.webContents.isFocused())
    const previousId = activeWorkspaceId
    const previous: WorkspaceTabs = { tabs, activeId, closed, splitTree }
    const existingTarget = workspaceCache.get(id)
    try {
    for (const peekId of peeks.keys()) closePeek(peekId)
    if (findOpen) performShortcut('dismiss')
    if (persistSelection) store.selectWorkspace(windowId, id)
    restoring = true
    for (const tab of tabs.values()) window.contentView.removeChildView(tab.view)
    workspaceCache.set(activeWorkspaceId, { tabs, activeId, closed, splitTree })
    activeWorkspaceId = id
    splitTree = null
    const cached = workspaceCache.get(id)
    if (cached) {
      tabs = cached.tabs; activeId = cached.activeId; closed = cached.closed; splitTree = cached.splitTree

    } else {
      tabs = new Map<string, Tab>(); activeId = null; closed = []
      const saved = store.load(id)
      if (saved) { closed = saved.closed; for (const tab of saved.tabs) create(tab, false); regroupTabs(); activate(saved.activeId) }
      splitTree = store.loadSplitTree(id, new Set(tabs.keys()))
    }
    workspaceCache.delete(id)
    if (splitTree?.type === 'leaf') splitTree = null
    if (splitTree && (!activeId || !splitTabIds(splitTree).includes(activeId))) activeId = splitTabIds(splitTree)[0] ?? null
    restoring = false
    attachVisible()
    const current = activeId ? tabs.get(activeId) : undefined
    if (current) { loadTab(current); if (pageHadFocus && current.presented) current.view.webContents.focus() }
    publish()
    } catch (error) {
      if (activeWorkspaceId === id) {
        for (const tab of tabs.values()) { window.contentView.removeChildView(tab.view); if (!existingTarget && !tab.view.webContents.isDestroyed()) tab.view.webContents.close() }
        if (existingTarget) workspaceCache.set(id, existingTarget)
      }
      activeWorkspaceId = previousId; tabs = previous.tabs; activeId = previous.activeId; closed = previous.closed; splitTree = previous.splitTree
      workspaceCache.delete(previousId)
      if (persistSelection) { try { store.selectWorkspace(windowId, previousId) } catch (rollbackError) { console.error('Unable to restore Workspace selection:', rollbackError) } }
      restoring = false; attachVisible(); publish()
      throw error
    }
  }
  const requestWorkspaceSwitch = (event: Electron.IpcMainInvokeEvent, requestedProfile: unknown, id: unknown): BrowserState => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== rendererURL || requestedProfile !== profileId || profileId !== activeProfileId || typeof id !== 'string' || !store.workspaces().some((workspace) => workspace.id === id)) throw new Error('Workspace switch unavailable')
    switchWorkspace(id)
    if (!lastPublishedState || lastPublishedState.activeWorkspaceId !== id) throw new Error('Workspace switch failed')
    return lastPublishedState
  }
  const requestProfileFocus = (event: Electron.IpcMainInvokeEvent, from: unknown, target: unknown): string => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== rendererURL || from !== profileId || profileId !== activeProfileId || !(target === null || typeof target === 'string')) throw new Error('Profile switch unavailable')
    let id = target; if (id === null) { if (profiles.list().some((profile) => profile.icon === 'work' || profile.name.trim().toLowerCase() === 'work')) throw new Error('Work Profile already exists'); id = randomUUID(); profiles.create(id, 'Work') }
    switchProfile(id, window); if (activeProfileId !== id) throw new Error('Profile switch failed'); return id
  }
  const updateBounds = (event: Electron.IpcMainEvent, value: unknown): void => {
    if (!trusted(event) || !isViewBounds(value)) return
    if (Math.round(bounds.x) === Math.round(value.x) && Math.round(bounds.y) === Math.round(value.y) && Math.round(bounds.width) === Math.round(value.width) && Math.round(bounds.height) === Math.round(value.height) && (bounds.uiScale ?? 1) === (value.uiScale ?? 1)) return
    bounds = value; lastViewBounds = value
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
    tab.state.pinned = !tab.state.pinned; if (tab.state.pinned && tab.state.groupId) { store.setTabGroup(id, null, activeWorkspaceId); tab.state.groupId = null } regroupTabs()
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
      target = { tabs: new Map<string, Tab>(), activeId: saved?.activeId ?? null, closed: saved?.closed ?? [], splitTree: null }
      for (const row of saved?.tabs ?? []) create(row, false, destination, target.tabs)
      target.splitTree = store.loadSplitTree(destination, new Set(target.tabs.keys()))
      workspaceCache.set(destination, target)
    }
    if (target.tabs.has(id)) return
    const ids = [...tabs.keys()]; const index = ids.indexOf(id)
    const next = activeId === id ? ids[index + 1] ?? ids[index - 1] ?? null : activeId
    try { store.moveTab(id, source, destination, next) } catch (error) {
      console.error('Unable to move tab:', error); contextStorageWarning = 'Could not move the tab. Please check session storage.'; publish(); return
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
  const openPeek = (peekId: string, url: string): boolean => {
      if (settingsOpen || disposed || profileId !== activeProfileId) return false
      const visible = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []
      if (!visible.includes(peekId) || !tabs.has(peekId) || !isWebURL(url)) return false
      closePeek(peekId)
      const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, partition: profilePartition(profileId) } })
      const toolbar = new WebContentsView({ webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, webSecurity: true } })
      const backdrop = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, webSecurity: true } })
      backdrop.setBackgroundColor('#00000000')
      backdrop.setBorderRadius(15)
      backdrop.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      backdrop.webContents.on('will-navigate', (event) => event.preventDefault())
      toolbar.setBorderRadius(0)
      toolbar.setBackgroundColor('#00000000')
      toolbar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      toolbar.webContents.on('will-navigate', (event) => event.preventDefault())
      toolbar.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); closePeek(peekId, true) } })
      view.setBorderRadius(15)
      view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#292b29' : '#fbfaf8')
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      view.webContents.on('will-navigate', (event, value) => { if (!isWebURL(value)) event.preventDefault() })
      view.webContents.on('will-redirect', (event, value) => { if (!isWebURL(value)) event.preventDefault() })
      view.webContents.on('will-frame-navigate', (event) => { if (!event.isMainFrame && !isWebURL(event.url) && event.url !== 'about:blank' && event.url !== 'about:srcdoc' && !/^(?:blob:|data:)/i.test(event.url)) event.preventDefault() })
      view.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); closePeek(peekId, true) } })
      const sendHost = (value: string): void => { if (toolbar.webContents.isDestroyed()) return; let host = ''; try { host = new URL(value).hostname } catch { /* blank or invalid URL */ } toolbar.webContents.send(PEEK_HOST_CHANNEL, host) }
      toolbar.webContents.on('did-finish-load', () => sendHost(view.webContents.getURL() || url))
      view.webContents.on('did-navigate', (_event, value) => sendHost(value))
      view.webContents.on('did-navigate-in-page', (_event, value, main) => { if (main) sendHost(value) })
      view.webContents.once('destroyed', () => { if (peeks.get(peekId)?.page === view) closePeek(peekId) })
      toolbar.webContents.once('destroyed', () => { if (peeks.get(peekId)?.toolbar === toolbar) closePeek(peekId) })
      backdrop.webContents.once('destroyed', () => { if (peeks.get(peekId)?.backdrop === backdrop) closePeek(peekId) })
      for (const id of peeks.keys()) closePeek(id)
      window.webContents.send(BROWSER_ACTION_CHANNEL, 'peek-hint'); peeks.set(peekId, { page: view, toolbar, backdrop }); window.contentView.addChildView(backdrop); window.contentView.addChildView(view); window.contentView.addChildView(toolbar); layout()
      void backdrop.webContents.loadURL(`${rendererURL}#peek-backdrop`).catch(() => { if (peeks.get(peekId)?.backdrop === backdrop) closePeek(peekId, true) })
      void toolbar.webContents.loadURL(`${rendererURL}#peek-toolbar`).catch(() => { if (peeks.get(peekId)?.toolbar === toolbar) closePeek(peekId, true) })
      view.webContents.focus()
      void view.webContents.loadURL(url).catch(() => {})
      return true
  }
  const peekLink = (event: Electron.IpcMainEvent, input: unknown): void => {
    event.returnValue = false
    if (!input || typeof input !== 'object' || Array.isArray(input)) return
    const { url, alt } = input as Record<string, unknown>
    if (profileId !== activeProfileId || typeof url !== 'string' || !isWebURL(url) || typeof alt !== 'boolean' || event.senderFrame !== event.sender.mainFrame) return
    const entry = [...tabs.entries()].find(([, tab]) => tab.view.webContents === event.sender && tab.workspaceId === activeWorkspaceId)
    if (!entry || !shouldPeekLink(profiles.peekMode(profileId), alt, event.sender.getURL(), url)) return
    const visible = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []
    if (!visible.includes(entry[0])) return
    const sourceURL = event.sender.getURL(); const source = event.sender
    peekNavigation.arm(entry[0], url)
    event.returnValue = true
    setImmediate(() => {
      if (disposed || profileId !== activeProfileId || window.isDestroyed() || source.isDestroyed() || source.getURL() !== sourceURL || tabs.get(entry[0])?.view.webContents !== source) return
      try { openPeek(entry[0], url) } catch (error) { console.error('Unable to open Peek:', error) }
    })
  }
  const command = (event: Electron.IpcMainEvent, value: unknown): void => {
    const toolbarEntry = [...peeks.entries()].find(([, pair]) => pair.toolbar.webContents === event.sender)
    if (toolbarEntry) {
      const [id, pair] = toolbarEntry
      if (profileId !== activeProfileId || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== `${rendererURL}#peek-toolbar` || !isTabCommand(value)) return
      if (value.type === 'peek-close') closePeek(id, true)
      if (value.type === 'peek-back' && pair.page.webContents.navigationHistory.canGoBack()) pair.page.webContents.navigationHistory.goBack()
      if (value.type === 'peek-expand') {
        const source = tabs.get(id)
        const url = pair.page.webContents.getURL()
        if (!source || source.workspaceId !== activeWorkspaceId || source.view.webContents.isDestroyed() || !isWebURL(url)) return
        peekNavigation.clear(id)
        source.loaded = true
        closePeek(id, true)
        void source.view.webContents.loadURL(url).catch((error: unknown) => console.error('Unable to open Peek in current tab:', error))
      }
      return
    }
    if (!trusted(event) || !isTabCommand(value)) return
    let cmd = value
    if (settingsOpen && ['open-welcome', 'create', 'activate', 'navigate', 'reopen', 'favourite-open', 'later-open', 'search-later-open', 'history-open'].includes(cmd.type)) { setSettingsOpen(false); window.webContents.send(BROWSER_ACTION_CHANNEL, 'settings-close') }
    if (cmd.type === 'open-welcome') {
      const current = activeId ? tabs.get(activeId) : undefined
      if (cmd.reuseEmpty && current && !current.state.url && !current.state.pinned && !current.state.groupId) cmd = { type: 'navigate', value: WELCOME_URL }
      else { if (tabs.size < 100) create({ id: randomUUID(), url: WELCOME_URL, pinned: false }); return }
    }
    if (cmd.type === 'peek-close') { closePeek(cmd.id, true); return }
    if (cmd.type === 'peek-open') { openPeek(cmd.id, cmd.url); return }
    if (cmd.type === 'pane-switcher') {
      const visible = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []
      const tab = tabs.get(cmd.id); const [width = 0, height = 0] = window.getContentSize()
      if (!tab || !visible.includes(cmd.id) || cmd.x > width || cmd.y > height) return
      activate(cmd.id)
      const items: Electron.MenuItemConstructorOptions[] = cmd.kind === 'workspace'
        ? store.workspaces().map((workspace) => ({ label: workspace.name, type: 'radio', checked: workspace.id === activeWorkspaceId, click: () => switchWorkspace(workspace.id) }))
        : [...tabs.values()].filter((item) => item.state.groupId && item.state.groupId === tab.state.groupId).map((item) => ({ label: item.state.title || item.state.url || 'New tab', type: 'radio', checked: item.state.id === activeId, click: () => activate(item.state.id, true) }))
      if (items.length) Menu.buildFromTemplate(items).popup({ window, x: cmd.x, y: cmd.y })
      return
    }
    if (cmd.type === 'focus-page') { const visible = splitTree ? splitTabIds(splitTree) : activeId ? [activeId] : []; const tab = tabs.get(cmd.id); if (canRestorePane(profileId, activeProfileId, visible, cmd.id, settingsOpen) && tab?.presented && !tab.view.webContents.isDestroyed()) { activate(cmd.id); tab.view.webContents.focus() } else { window.webContents.focus(); window.webContents.send(BROWSER_ACTION_CHANNEL, 'focus-chrome') } return }
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
        { label: 'Save for Later', accelerator: shortcutAccelerator('save-later', process.platform === 'darwin'), enabled: !!tab.state.url, click: () => saveLater(id) },
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

    if (cmd.type === 'settings-menu') { const origin = activeId && tabs.get(activeId)?.view.webContents.isFocused() ? activeId : null; setSettingsOpen(true); window.webContents.send(BROWSER_ACTION_CHANNEL, 'settings', origin); return }
    if (cmd.type === 'settings-open') { setSettingsOpen(cmd.open); return }
    if (cmd.type === 'peek-mode') { profiles.setPeekMode(profileId, cmd.mode); publish(); return }
    if (cmd.type === 'app-menu' && process.platform === 'win32') {
      const [width = 0, height = 0] = window.getContentSize()
      if (cmd.x <= width && cmd.y <= height) Menu.getApplicationMenu()?.popup({ window, x: cmd.x, y: cmd.y })
      return
    }
    if (cmd.type === 'find-close') { const current = activeId ? tabs.get(activeId)?.view.webContents : undefined; current?.stopFindInPage('clearSelection'); findOpen = false; current?.focus(); return }
    if (cmd.type === 'find-query' || cmd.type === 'find-step') {
      const current = activeId ? tabs.get(activeId)?.view.webContents : undefined
      if (!current || !findOpen) return
      if (cmd.type === 'find-query') { findText = cmd.value; profileFindQueries.set(profileId, findText); if (!findText) { current.stopFindInPage('clearSelection'); window.webContents.send(FIND_RESULT_CHANNEL, { matches: 0, activeMatchOrdinal: 0 }); return } findRequest = current.findInPage(findText, { findNext: false }) }
      else if (findText) findRequest = current.findInPage(findText, { forward: cmd.forward, findNext: true })
      return
    }
    if (cmd.type === 'sidebar-width') { try { profiles.setSidebarWidth(cmd.width) } catch (error) { console.error('Unable to save sidebar width:', error) } return }
    if (cmd.type === 'profile-create') {
      const name = cmd.name.trim(); if (!name) return
      const id = randomUUID()
      try { profiles.create(id, name); switchProfile(id, window) } catch (error) { console.error('Unable to create Profile:', error); contextStorageWarning = 'Could not create Profile.'; publish() }
      return
    }
    if (cmd.type === 'profile-rename') {
      const name = cmd.name.trim(); if (name && profiles.list().some((profile) => profile.id === cmd.id)) { profiles.rename(cmd.id, name); publish() } return
    }
    if (cmd.type === 'profile-switch') { try { switchProfile(cmd.id, window) } catch (error) { console.error('Unable to switch Profile:', error); contextStorageWarning = 'Could not switch Profile.'; publish() } return }
    if (cmd.type === 'profile-delete') {
      const id = cmd.id; const target = profiles.list().find((profile) => profile.id === id); const replacement = profiles.list().find((profile) => profile.id !== id)
      if (!target || !replacement || deletingProfiles.has(id)) return
      void dialog.showMessageBox(window, { type: 'warning', title: 'Delete Profile', message: `Delete “${target.name}”?`, detail: 'This permanently deletes the Profile, its Workspaces and saved pages, and its browser data.', buttons: ['Cancel', 'Delete Profile'], defaultId: 0, cancelId: 0 }).then(async (answer) => {
        if (answer.response !== 1 || window.isDestroyed() || profileId !== activeProfileId) return
        if (deletingProfiles.has(id)) return
        deletingProfiles.add(id)
        try {
          if (id === activeProfileId) switchProfile(replacement.id, window)
          const oldContext = profileContexts.get(id); if (oldContext) { oldContext.dispose(); profileContexts.delete(id) }
          await session.fromPartition(profilePartition(id)).clearData()
          await session.fromPartition(profilePartition(id)).clearCache()
          await session.fromPartition(profilePartition(id)).clearAuthCache()
          const path = profilePath(id)
          for (const suffix of ['', '-wal', '-shm']) await unlink(path + suffix).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
          profiles.remove(id)
          if (!window.isDestroyed()) profileContexts.get(activeProfileId)?.publish()
        } catch (error) { console.error('Unable to delete Profile:', error); contextStorageWarning = 'Could not completely delete Profile data.'; if (!window.isDestroyed()) profileContexts.get(activeProfileId)?.publish() } finally { deletingProfiles.delete(id) }
      }).catch((error: unknown) => console.error('Profile confirmation failed:', error))
      return
    }
    if (cmd.type === 'group-create' && typeof cmd.name === 'string') { const name = cmd.name.trim().slice(0, 80); if (name) { store.createGroup(activeWorkspaceId, randomUUID(), name, cmd.color || '#55766b'); publish() } return }
    if (cmd.type === 'group-rename' || cmd.type === 'group-color' || cmd.type === 'group-toggle' || cmd.type === 'group-delete') { if (!store.groups(activeWorkspaceId).some((group) => group.id === cmd.id)) return; const action = cmd.type === 'group-rename' ? 'rename' : cmd.type === 'group-color' ? 'color' : cmd.type === 'group-toggle' ? 'toggle' : 'delete'; store.updateGroup(cmd.id, action, 'name' in cmd ? cmd.name.trim().slice(0, 80) : 'color' in cmd ? cmd.color : ''); if (cmd.type === 'group-delete') for (const tab of tabs.values()) if (tab.state.groupId === cmd.id) tab.state.groupId = null; publish(); return }
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
        { label: 'Save for Later', accelerator: shortcutAccelerator('save-later', process.platform === 'darwin'), enabled: !!target.state.url, click: () => saveLater(id) },
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
      const id = randomUUID(); store.createWorkspace(id, name); if (cmd.emoji) store.setWorkspaceEmoji(id, cmd.emoji.trim()); switchWorkspace(id); return
    }
    if (cmd.type === 'workspace-rename' && typeof cmd.id === 'string' && typeof cmd.name === 'string') {
      const name = cmd.name.trim().slice(0, 80); if (name && store.workspaces().some((workspace) => workspace.id === cmd.id)) { store.renameWorkspace(cmd.id, name); publish() } return
    }
    if (cmd.type === 'workspace-emoji' && typeof cmd.id === 'string' && typeof cmd.emoji === 'string') { const emoji = cmd.emoji.trim(); if (emoji && store.workspaces().some((workspace) => workspace.id === cmd.id)) { store.setWorkspaceEmoji(cmd.id, emoji); publish() } return }
    if (cmd.type === 'workspace-move') { store.moveWorkspace(cmd.id, cmd.direction); publish(); return }
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
    try { const url = new URL(details.requestingUrl); if (profileId !== activeProfileId || url.protocol !== 'https:' || !details.isMainFrame || !label || parent.isDestroyed() || permissionPrompt || !contents.isFocused() || !activeId || tabs.get(activeId)?.view.webContents !== contents) { callback(false); return } origin = url.origin } catch { callback(false); return }
    const requestingURL = contents.getURL(); permissionPrompt = true
    void dialog.showMessageBox(parent, { type: 'question', buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0, title: 'Website permission', message: `Allow ${origin} to ${label}?`, detail: 'This choice applies to this request.' }).then((result) => { permissionPrompt = false; let sameOrigin = false; try { sameOrigin = !disposed && profileId === activeProfileId && !contents.isDestroyed() && contents.getURL() === requestingURL && !!activeId && tabs.get(activeId)?.view.webContents === contents && new URL(contents.getURL()).origin === origin } catch { /* navigation or closure */ } callback(result.response === 1 && sameOrigin) }).catch(() => { permissionPrompt = false; callback(false) })
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
  const menuItem = (label: string, action: BrowserShortcut): Electron.MenuItemConstructorOptions => ({ label, accelerator: shortcutAccelerator(action, process.platform === 'darwin'), click: () => performShortcut(action) })
  const installMenu = (): void => Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [menuItem('New Tab', 'new-tab'), menuItem('Close Tab', 'close-tab'), menuItem('Reopen Closed Tab', 'reopen'), menuItem('Print', 'print'), ...(process.platform === 'darwin' ? [] : [{ role: 'quit' as const }])] },
    { role: 'editMenu' },
    menuItem('Settings', 'settings'),
    { label: 'View', submenu: [menuItem('Show or Hide Sidebar', 'sidebar'), menuItem('Toggle Split View', 'toggle-split'), menuItem('Command Menu', 'command-menu'), { label: 'Search Saved Pages', click: () => { window.webContents.focus(); window.webContents.send(BROWSER_ACTION_CHANNEL, 'saved-search') } }, menuItem('Downloads', 'downloads'), menuItem('History', 'history'), menuItem('Add Favourite', 'favourite'), menuItem('Save Tab for Later', 'save-later'), menuItem('Find in Page', 'find'), menuItem('Find Next', 'find-next'), menuItem('Find Previous', 'find-previous'), menuItem('Reload', 'reload'), menuItem('Reload Ignoring Cache', 'hard-reload'), menuItem('Developer Tools', 'devtools'), { type: 'separator' }, menuItem('Zoom In', 'zoom-in'), menuItem('Zoom Out', 'zoom-out'), menuItem('Actual Size', 'zoom-reset')] },
    { label: 'Navigate', submenu: [menuItem('Address Bar', 'address'), menuItem('Back', 'back'), menuItem('Forward', 'forward'), { type: 'separator' }, menuItem('Next Tab', 'next-tab'), menuItem('Previous Tab', 'previous-tab'), menuItem('Next Focus Area', 'focus-next'), menuItem('Previous Focus Area', 'focus-previous'), menuItem('Next Workspace', 'workspace-next'), menuItem('Previous Workspace', 'workspace-previous'), menuItem('Profile 1', 'profile-1'), menuItem('Profile 2', 'profile-2'), ...Array.from({ length: 9 }, (_, i) => menuItem(i === 8 ? 'Last Tab' : `Tab ${i + 1}`, `tab-${i + 1}`))] },
    { role: 'windowMenu' },
  ]))
  const resize = (): void => layout()
  let removeWindowShortcuts: (() => void) | undefined
  const activateContext = (): void => {
    if (contextActive || disposed) return
    contextActive = true
    bounds = lastViewBounds
    saveForUpdate = async () => { for (const context of profileContexts.values()) await context.flush() }
    installMenu()
    if (process.platform === 'win32') window.setMenuBarVisibility(false)
    ipcMain.on(VIEW_BOUNDS_CHANNEL, updateBounds)
    ipcMain.on(TAB_COMMAND_CHANNEL, command)
    ipcMain.handle(WORKSPACE_SWITCH_CHANNEL, requestWorkspaceSwitch)
    ipcMain.handle(PROFILE_SWITCH_CHANNEL, requestProfileFocus)
    ipcMain.on('idle:peek-link', peekLink)
    window.on('resize', resize)
    removeWindowShortcuts = installShortcuts(window.webContents)
    for (const child of hiddenChildWindows) if (!child.isDestroyed()) child.showInactive()
    hiddenChildWindows.clear()
    attachVisible(); publish()
  }
  const deactivateContext = (): void => {
    if (!contextActive) return
    contextActive = false
    for (const id of [...peeks.keys()]) closePeek(id)
    if (findOpen) { const current = activeId ? tabs.get(activeId)?.view.webContents : undefined; if (current && !current.isDestroyed()) current.stopFindInPage('clearSelection'); findOpen = false; if (!window.isDestroyed()) window.webContents.send(BROWSER_ACTION_CHANNEL, 'dismiss') }
    if (splitDragTimer) clearTimeout(splitDragTimer)
    splitDragging = false; splitViewsHidden = false; splitDragToken = ''
    for (const tab of tabs.values()) { peekNavigation.clear(tab.state.id); tab.view.setVisible(tab.presented && !!tab.state.url && !tab.state.error); if (!window.isDestroyed()) window.contentView.removeChildView(tab.view) }
    for (const child of childWindows) if (!child.isDestroyed() && child.isVisible()) { hiddenChildWindows.add(child); child.hide() }
    ipcMain.removeListener(VIEW_BOUNDS_CHANNEL, updateBounds); ipcMain.removeListener(TAB_COMMAND_CHANNEL, command); ipcMain.removeHandler(WORKSPACE_SWITCH_CHANNEL); ipcMain.removeHandler(PROFILE_SWITCH_CHANNEL); ipcMain.removeListener('idle:peek-link', peekLink); window.removeListener('resize', resize); removeWindowShortcuts?.(); removeWindowShortcuts = undefined
  }
  const dispose = (closeStore = true): void => {
    if (disposed) return
    disposed = true; deactivateContext(); window.removeListener('closed', onClosed)
    nativeTheme.removeListener('updated', updatePageBackings)
    pageSession.removeListener('will-download', onDownload)
    pageSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    for (const child of childWindows) if (!child.isDestroyed()) child.destroy()
    childWindows.clear(); hiddenChildWindows.clear()
    for (const tab of tabs.values()) { if (!window.isDestroyed()) window.contentView.removeChildView(tab.view); if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close() }
    for (const workspace of workspaceCache.values()) for (const tab of workspace.tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    tabs.clear(); workspaceCache.clear()
    if (closeStore) store.close()
  }
  const onClosed = (): void => { dispose(profileId !== activeProfileId); if (profileId === activeProfileId) saveForUpdate = undefined }
  window.once('closed', onClosed)


  try {
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
    activateContext()
    return { activate: activateContext, deactivate: deactivateContext, dispose, publish, flush: saveContextForUpdate, evictable: () => !contextStorageWarning && childWindows.size === 0 && [...tabs.values(), ...[...workspaceCache.values()].flatMap((workspace) => [...workspace.tabs.values()])].every((tab) => !tab.state.loading) && downloads.every((item) => ['Complete', 'Cancelled', 'Failed'].includes(item.status)), store }
  } catch (error) { dispose(false); throw error }
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
  const previousId = activeProfileId; const previous = profileContexts.get(previousId)
  if (!previous) throw new Error('Active Profile context is unavailable')
  let next = profileContexts.get(id); const nextStore = next?.store ?? openProfile(id)
  try { profiles.select(id) } catch (error) { if (!next) nextStore.close(); throw error }
  let previousDeactivated = false
  try {
    previous.deactivate(); previousDeactivated = true; activeProfileId = id; store = nextStore
    if (next) { next.activate(); profileContexts.delete(id); profileContexts.set(id, next) }
    else { next = createProfileContext(window, id, nextStore); profileContexts.set(id, next) }
    for (const [cachedId, cached] of profileContexts) {
      if (profileContexts.size <= 2) break
      if (cachedId !== id && cached.evictable()) {
        try { cached.dispose(); profileContexts.delete(cachedId) } catch (error) { console.error('Unable to release inactive Profile:', error) }
      }
    }
  } catch (error) {
    if (next && activeProfileId === id) next.deactivate()
    activeProfileId = previousId; store = previous.store
    try { profiles.select(previousId) } catch (rollbackError) { console.error('Unable to restore Profile selection:', rollbackError) }
    if (!next) nextStore.close()
    if (previousDeactivated) previous.activate(); throw error
  }
}

void app.whenReady().then(() => {
  profiles = new ProfileRegistry(join(app.getPath('userData'), 'profiles.sqlite'))
  activeProfileId = profiles.active()
  store = openProfile(activeProfileId)
  // electron-updater 6 skips signature verification when publisherName is absent.
  // Disable updates for unsigned/local builds instead of accepting such installers.
  let signedUpdates = false
  if (app.isPackaged && process.platform === 'win32') {
    try { signedUpdates = /^publisherName:\s*(?:\S|\r?\n\s+-\s+\S)/m.test(readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8')) } catch { /* no update configuration */ }
  }
  if (autoUpdater instanceof NsisUpdater) autoUpdater.verifyUpdateCodeSignature = verifyUpdateSignature
  updateService = new UpdateService(autoUpdater, signedUpdates, app.getVersion(), (state) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(UPDATE_STATE_CHANNEL, state)
  })
  updateService.start()
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
    return { name: app.getName(), version: app.getVersion(), onboardingComplete: profiles.onboardingComplete() }
  })

  ipcMain.handle(ONBOARDING_CHANNEL, (event): void => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== rendererURL) throw new Error('Untrusted IPC sender')
    profiles.completeOnboarding()
  })

  ipcMain.handle(UPDATE_CHANNEL, async (event, action: unknown): Promise<UpdateState> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== rendererURL) throw new Error('Untrusted IPC sender')
    if (action === 'check') return updateService.check()
    if (action === 'dismiss') updateService.dismiss()
    else if (action === 'install') await updateService.install(async () => { if (!saveForUpdate) throw new Error('Window unavailable'); await saveForUpdate() })
    else if (action !== 'state') throw new Error('Invalid update action')
    return updateService.getState()
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

