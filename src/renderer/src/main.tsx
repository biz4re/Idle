import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, Bookmark, BriefcaseBusiness, ChevronDown, ChevronRight, Folder, FolderPlus, Globe2, Maximize2, MoreHorizontal, PanelLeft, Pin, PinOff, Plus, RotateCw, Search, UserRound, X } from 'lucide-react'
import type { BrowserState, LaterItem, TabState, UpdateState } from '../../shared/ipc'
import type { SplitTree } from '../../shared/split-tree'
import { interfaceViewport } from '../../shared/interface-scale'
import { reorderTabs } from '../../shared/tab-order'
import { searchSavedPages } from '../../shared/search'
import { visibleProfiles } from '../../shared/profile-switcher'
import { WELCOME_URL } from '../../shared/welcome'
import { clampSidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, useUIStore } from './store'
import { WorkspaceEmojiPicker } from './WorkspaceEmojiPicker'
import { SettingsPage, type SettingsCategory } from './SettingsPage'
import { Onboarding } from './Onboarding'
import { ProfileSegment } from './ProfileSegment'
import { WorkspaceActions, type WorkspaceTarget, type WorkspaceActionMode } from './WorkspaceActions'
import './styles.css'

type IconName = 'later' | 'plus' | 'close' | 'back' | 'forward' | 'reload' | 'sidebar' | 'search' | 'globe' | 'user-round' | 'briefcase-business' | 'chevron-down' | 'chevron-right' | 'pin' | 'pin-off' | 'folder-plus' | 'more'
function Icon({ name }: { name: IconName }) {
  const icons = { later: Bookmark, plus: Plus, close: X, back: ArrowLeft, forward: ArrowRight, reload: RotateCw, sidebar: PanelLeft, search: Search, globe: Globe2, 'user-round': UserRound, 'briefcase-business': BriefcaseBusiness, 'chevron-down': ChevronDown, 'chevron-right': ChevronRight, pin: Pin, 'pin-off': PinOff, 'folder-plus': FolderPlus, more: MoreHorizontal } as const
  const Component = icons[name]
  return <Component aria-hidden="true" size={16} strokeWidth={1.8} />
}

function tabLabel(tab: TabState): string {
  const title = tab.title.trim()
  if (title && title !== tab.url) return title
  if (tab.url) { try { return new URL(tab.url).hostname.replace(/^www\./, '') || 'New tab' } catch { /* fall through */ } }
  return tab.loading ? 'Loading…' : tab.error ? 'Page unavailable' : 'New tab'
}

function LaterRow({ item }: { item: LaterItem }) {
  const [editingNote, setEditingNote] = useState(false)
  const [note, setNote] = useState(item.note)
  const command = window.idle.tabCommand
  return <div className={`later-item ${item.done ? 'done' : ''}`}>
    <button className="later-open" onClick={() => command({ type: 'later-open', id: item.id })} title={item.url}>{item.title || item.url}</button>
    <div className="later-meta"><time dateTime={new Date(item.savedAt).toISOString()}>{new Date(item.savedAt).toLocaleDateString()}</time><details className="saved-actions" onClickCapture={(event) => { if (event.target instanceof HTMLButtonElement) event.currentTarget.removeAttribute('open') }}><summary aria-label={`Actions for ${item.title}`} title="Saved page actions">···</summary><div className="saved-actions-items"><button onClick={() => command({ type: 'later-toggle', id: item.id })}>{item.done ? 'Mark not done' : 'Mark done'}</button><button onClick={() => { setNote(item.note); setEditingNote(!editingNote) }}>{item.note ? 'Edit note' : 'Add note'}</button><button onClick={() => command({ type: 'later-remove', id: item.id })}>Remove from Later</button></div></details></div>
    {!editingNote && item.note && <p className="later-note">{item.note}</p>}
    {editingNote && <form className="later-note-form" onSubmit={(event) => { event.preventDefault(); command({ type: 'later-note', id: item.id, note }); setEditingNote(false) }}><label>Note<textarea maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label><button type="submit">Save</button><button type="button" onClick={() => setEditingNote(false)}>Cancel</button></form>}
  </div>
}

function PaneToolbar({ tab, active, editing, open, close, workspace, group }: { tab: TabState; active: boolean; editing: boolean; open: (id: string) => void; close: () => void; workspace: string; group: BrowserState['groups'][number] | undefined }) {
  const [address, setAddress] = useState(tab.url)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) { setAddress(tab.url); requestAnimationFrame(() => { input.current?.focus(); input.current?.select() }) } }, [editing, tab.id])
  const command = window.idle.tabCommand
  let hostname = 'Search or enter a URL'
  try { hostname = new URL(tab.url).hostname || hostname } catch { /* empty tab */ }
  const security = tab.url.startsWith('https://') ? 'Secure HTTPS connection' : tab.url.startsWith('http://') ? 'Not secure: unencrypted HTTP' : 'Search or enter a web address'
  const switcher = (kind: 'workspace' | 'group', event: React.MouseEvent<HTMLButtonElement>) => { const rect = event.currentTarget.getBoundingClientRect(); command({ type: 'pane-switcher', id: tab.id, kind, x: Math.round(rect.left), y: Math.round(rect.bottom) }) }
  return <div className={`pane-toolbar ${active ? 'pane-active' : ''}`} onPointerDown={() => command({ type: 'pane-focus', id: tab.id })} onFocus={() => { if (!active) command({ type: 'pane-focus', id: tab.id }) }}>
    <button className="icon-button" disabled={!tab.canGoBack} aria-label="Back" title="Back" onClick={() => command({ type: 'pane-command', id: tab.id, action: 'back' })}><Icon name="back" /></button>
    <button className="icon-button" disabled={!tab.canGoForward} aria-label="Forward" title="Forward" onClick={() => command({ type: 'pane-command', id: tab.id, action: 'forward' })}><Icon name="forward" /></button>
    {editing ? <form className="pane-inline-address" onSubmit={(event) => { event.preventDefault(); command({ type: 'pane-command', id: tab.id, action: 'navigate', value: address }); close() }}><input ref={input} aria-label="Address or search" placeholder="Search or enter a URL" value={address} onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() } }} onBlur={close} /></form> : <nav className="pane-breadcrumbs" aria-label="Pane location"><span className="breadcrumb-workspace"><button title={workspace} onClick={(event) => switcher('workspace', event)}>{workspace}</button><span aria-hidden="true">›</span></span>{group && <span className="breadcrumb-group"><button title={group.name} onClick={(event) => switcher('group', event)}>{group.name}</button><span aria-hidden="true">›</span></span>}<button className="pane-host" onClick={() => open(tab.id)} aria-label={`${security}. ${hostname}. Edit address or search`} title={`${security}: ${tab.url || hostname}`}>{tab.favicon ? <img src={tab.favicon} alt="" /> : <Icon name="globe" />}<span className="pane-security" aria-hidden="true">{tab.loading ? '◌' : tab.url.startsWith('https://') ? '◈' : tab.url.startsWith('http://') ? '!' : ''}</span><span className="pane-hostname">{hostname}</span></button></nav>}
    <button className="icon-button pane-menu" aria-label="Page actions" title="Page actions" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); command({ type: 'pane-menu', id: tab.id, x: Math.round(rect.left), y: Math.round(rect.bottom) }) }}><Icon name="more" /></button>
  </div>
}

function SplitFrames({ tree, tabs, activeId, editingId, open, close, groups, workspace }: { tree: SplitTree; tabs: TabState[]; activeId: string | null; editingId: string | null; open: (id: string) => void; close: () => void; groups: BrowserState['groups']; workspace: string }) {
  if (tree.type === 'leaf') { const tab = tabs.find((item) => item.id === tree.tabId); return <div className={`split-pane-frame ${tab?.id === activeId ? 'active-frame' : ''}`}>{tab && <PaneToolbar tab={tab} active={tab.id === activeId} editing={tab.id === editingId} open={open} close={close} workspace={workspace} group={groups.find((item) => item.id === tab.groupId)} />}</div> }
  const props = { tabs, activeId, editingId, open, close, groups, workspace }
  return <div className={`split-frame-branch ${tree.orientation}`}><div style={{ flex: `${tree.ratio} 1 0` }}><SplitFrames tree={tree.first} {...props} /></div><div style={{ flex: `${1 - tree.ratio} 1 0` }}><SplitFrames tree={tree.second} {...props} /></div></div>
}

function SplitDropSurface({ tree, dragId, workspaceId, images, onFinish }: { tree: SplitTree; dragId: string; workspaceId: string; images: Record<string, string>; onFinish: () => void }) {
  const [preview, setPreview] = useState<{ id: string; edge: 'left' | 'right' | 'top' | 'bottom' } | null>(null)
  const renderNode = (node: SplitTree): React.ReactNode => {
    if (node.type === 'split') return <div className={`split-drop-branch ${node.orientation}`}><div style={{ flex: node.ratio }}>{renderNode(node.first)}</div><div style={{ flex: 1 - node.ratio }}>{renderNode(node.second)}</div></div>
    const edgeAt = (event: React.DragEvent<HTMLDivElement>) => {
      const r = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - r.left) / r.width; const y = (event.clientY - r.top) / r.height
      const choices = [{ edge: 'left' as const, value: x }, { edge: 'right' as const, value: 1 - x }, { edge: 'top' as const, value: y }, { edge: 'bottom' as const, value: 1 - y }]
      choices.sort((a, b) => a.value - b.value)
      return choices[0]?.value !== undefined && choices[0].value < 0.3 ? choices[0].edge : null
    }
    return <div className="split-drop-pane" onDragOver={(event) => { const edge = edgeAt(event); if (edge && dragId !== node.tabId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setPreview((prev) => prev?.id === node.tabId && prev.edge === edge ? prev : { id: node.tabId, edge }) } else setPreview(null) }} onDragLeave={(event) => { const next = event.relatedTarget; if (next instanceof Node && event.currentTarget.contains(next)) return; const r = event.currentTarget.getBoundingClientRect(); if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) return; setPreview(null) }} onDrop={(event) => { const edge = edgeAt(event); event.preventDefault(); if (edge && dragId !== node.tabId) window.idle.tabCommand({ type: 'split-drop', id: dragId, targetId: node.tabId, workspaceId, edge }); onFinish() }}>
      <div className={`split-page-preview ${preview?.id === node.tabId ? `split-${preview.edge}` : ''}`}>{images[node.tabId] ? <img src={images[node.tabId]} alt="" draggable={false} /> : <span>New tab</span>}</div>
      {preview?.id === node.tabId && <div className={`split-drop-preview ${preview.edge}`}><span>Drop to split</span></div>}
    </div>
  }
  return <div className="split-drop-surface">{renderNode(tree)}</div>
}

function App() {
  const { sidebarOpen, sidebarWidth, interfaceScale, toggleSidebar, setSidebarWidth, saveSidebarWidth } = useUIStore()
  useLayoutEffect(() => { document.documentElement.style.setProperty('--ui-scale', String(interfaceScale)) }, [interfaceScale])
  const resizeStart = useRef<{ width: number; x: number } | null>(null)
  const contentRef = useRef<HTMLElement>(null)
  const sidebarWidthLoaded = useRef(false)
  const [paletteId, setPaletteId] = useState<string | null>(null)
  const paletteRef = useRef<string | null>(null)
  const openPalette = (id: string) => { window.idle.tabCommand({ type: 'pane-focus', id }); paletteRef.current = id; setPaletteId(id); requestAnimationFrame(() => { const input = document.querySelector<HTMLInputElement>('.pane-inline-address input'); input?.focus(); input?.select() }) }
  const closePalette = () => { paletteRef.current = null; setPaletteId(null) }
  const tabListRef = useRef<HTMLDivElement>(null)
  const previousWorkspace = useRef<{ id: string; profile: string; order: string[] } | null>(null)
  const workspaceAnimation = useRef<Animation | null>(null)
  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; workspaceId: string; x: number; y: number; token: string } | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [dragMessage, setDragMessage] = useState('')
  const [splitPreview, setSplitPreview] = useState<{ token: string; images: Record<string, string> } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [workspaceDrop, setWorkspaceDrop] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; placement: 'before' | 'after' } | null>(null)
  const [browser, setBrowser] = useState<BrowserState>({ revision: 0, peekMode: 'automatic', splitTree: null, tabs: [], groups: [], activeId: null, recentlyClosed: 0, workspaces: [], activeWorkspaceId: '', later: [], laterError: '', favourites: [], searchLater: [], history: [], downloads: [], storageWarning: '', profiles: [], activeProfileId: '', sidebarWidth: 232, navigationError: '', announcement: '' })
  const authoritative = useRef(browser)
  const workspaceSnapshots = useRef(new Map<string, BrowserState>())
  const pendingWorkspace = useRef<{ id: string; profile: string; sequence: number } | null>(null)
  const workspaceSequence = useRef(0)
  const [optimisticWorkspace, setOptimisticWorkspace] = useState<{ id: string; profile: string } | null>(null)
  const snapshotKey = (profile: string, id: string) => `${profile}:${id}`
  const sidebarBrowser = optimisticWorkspace && optimisticWorkspace.profile === browser.activeProfileId
    ? { ...browser, ...(workspaceSnapshots.current.get(snapshotKey(optimisticWorkspace.profile, optimisticWorkspace.id)) ?? { tabs: [], groups: [], activeId: null, splitTree: null, later: [] }), workspaces: browser.workspaces, profiles: browser.profiles, activeProfileId: browser.activeProfileId, activeWorkspaceId: optimisticWorkspace.id }
    : browser
  const acceptState = (state: BrowserState) => {
    if (state.revision <= authoritative.current.revision) return
    workspaceSnapshots.current.set(snapshotKey(state.activeProfileId, state.activeWorkspaceId), state)
    authoritative.current = state
    setBrowser(state)
  }
  const switchWorkspace = (id: string) => {
    const state = workspaceGestureState.current
    if (!state.activeProfileId || !state.workspaces.some((workspace) => workspace.id === id) || id === (pendingWorkspace.current?.id ?? state.activeWorkspaceId)) return
    const request = { id, profile: state.activeProfileId, sequence: ++workspaceSequence.current }
    pendingWorkspace.current = request
    setOptimisticWorkspace({ id, profile: request.profile })
    workspaceGestureState.current = { ...state, activeWorkspaceId: id }
    void window.idle.switchWorkspace(request.profile, id).then((result) => {
      if (displayedProfile.current === request.profile) acceptState(result)
    }).catch(() => {
      if (pendingWorkspace.current?.sequence === request.sequence) window.idle.tabCommand({ type: 'sync' })
    }).finally(() => {
      if (pendingWorkspace.current?.sequence !== request.sequence) return
      pendingWorkspace.current = null
      setOptimisticWorkspace(null)
      workspaceGestureState.current = authoritative.current
    })
  }
  const switchWorkspaceRef = useRef(switchWorkspace)
  switchWorkspaceRef.current = switchWorkspace
  useLayoutEffect(() => {
    const previous = previousWorkspace.current
    const order = sidebarBrowser.workspaces.map((workspace) => workspace.id)
    previousWorkspace.current = { id: sidebarBrowser.activeWorkspaceId, profile: sidebarBrowser.activeProfileId, order }
    if (!previous || previous.id === sidebarBrowser.activeWorkspaceId && previous.profile === sidebarBrowser.activeProfileId) return
    workspaceAnimation.current?.cancel()
    if (previous.profile !== sidebarBrowser.activeProfileId) return
    const from = previous.order.indexOf(previous.id); const to = order.indexOf(sidebarBrowser.activeWorkspaceId)
    if (from < 0 || to < 0 || !tabListRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    workspaceAnimation.current = tabListRef.current.animate([{ opacity: 0.82, transform: `translateX(${to > from ? 5 : -5}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 140, easing: 'ease-out' })
  }, [sidebarBrowser.activeWorkspaceId, sidebarBrowser.activeProfileId, sidebarBrowser.workspaces])
  const displayedProfile = useRef('')
  const [profileEdit, setProfileEdit] = useState<'create' | 'rename' | null>(null)
  const [profileName, setProfileName] = useState('')
  const [manageProfiles, setManageProfiles] = useState(false)
  const [groupEdit, setGroupEdit] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [workspaceEdit, setWorkspaceEdit] = useState<'create' | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceEmoji, setWorkspaceEmoji] = useState('🌐')
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceTarget | null>(null)
  const workspaceAnchors = useRef(new Map<string, HTMLButtonElement>())
  const workspaceStrip = useRef<HTMLDivElement>(null)
  const workspaceGestureState = useRef(browser)
  workspaceGestureState.current = sidebarBrowser
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const findByProfile = useRef(new Map<string, string>())
  const [search, setSearch] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const overlayOrigins = useRef(new Map<string, { element: HTMLElement | null; page: string | null; profile: string }>())
  const overlayState = useRef({ commandOpen: false, historyOpen: false })
  overlayState.current = { commandOpen, historyOpen }
  const captureOrigin = (name: string, page: string | null = null) => { overlayOrigins.current.set(name, { element: document.activeElement instanceof HTMLElement ? document.activeElement : null, page, profile: authoritative.current.activeProfileId }) }
  const restoreOrigin = (name: string) => {
    const origin = overlayOrigins.current.get(name); overlayOrigins.current.delete(name)
    requestAnimationFrame(() => {
      if (origin?.profile === authoritative.current.activeProfileId && origin.page) { window.idle.tabCommand({ type: 'focus-page', id: origin.page }); return }
      const element = origin?.profile === authoritative.current.activeProfileId ? origin.element : null
      if (element?.isConnected && !element.closest('[inert]') && !element.closest('[hidden]')) { element.focus(); if (document.activeElement === element) return }
      ;(document.querySelector<HTMLElement>('.tab-select[aria-current="page"]') ?? document.querySelector<HTMLElement>('.pane-host') ?? document.querySelector<HTMLElement>('[aria-label="Show sidebar"]') ?? document.querySelector<HTMLElement>('[aria-label="Hide sidebar"]'))?.focus()
    })
  }
  const closeOverlay = (name: 'command' | 'downloads') => { if (name === 'command') setCommandOpen(false); else setHistoryOpen(false); restoreOrigin(name) }
  const closeOverlayRef = useRef(closeOverlay); closeOverlayRef.current = closeOverlay
  const profileFocus = useRef<{ id: string | null; sequence: number } | null>(null)
  const profileFocusSequence = useRef(0)
  useLayoutEffect(() => { const pending = profileFocus.current; if (!pending || pending.id !== browser.activeProfileId) return; profileFocus.current = null; document.querySelector<HTMLButtonElement>(`[data-profile-id="${CSS.escape(browser.activeProfileId)}"]`)?.focus() }, [browser.activeProfileId])
  const [onboarding, setOnboarding] = useState<boolean | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const hintQueue = useRef<string[]>([])
  const currentHint = useRef<string | null>(null)
  const previousHintState = useRef<BrowserState | null>(null)
  const showHint = (id: string) => { try { if (localStorage.getItem(`idle.hint.${id}`) || currentHint.current === id || hintQueue.current.includes(id)) return; if (currentHint.current) hintQueue.current.push(id); else { currentHint.current = id; setHint(id) } } catch { /* optional discovery */ } }
  const dismissHint = () => { if (currentHint.current) { try { localStorage.setItem(`idle.hint.${currentHint.current}`, '1') } catch { /* storage may be unavailable */ } } currentHint.current = hintQueue.current.shift() ?? null; setHint(currentHint.current) }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('general')
  const [update, setUpdate] = useState<UpdateState>({ status: 'disabled', version: '', updateVersion: null, dismissed: false })
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [findResult, setFindResult] = useState({ matches: 0, activeMatchOrdinal: 0 })
  const findRef = useRef<HTMLInputElement>(null)
  const active = browser.tabs.find((tab) => tab.id === browser.activeId)
  const activeWorkspaceName = sidebarBrowser.workspaces.find((workspace) => workspace.id === sidebarBrowser.activeWorkspaceId)?.name ?? 'Workspace'
  const query = search.trim().toLocaleLowerCase()
  const { favourites: searchFavourites, later: searchLater } = searchSavedPages(query, browser.favourites, browser.searchLater)
  const visibleFavourites = browser.favourites.filter((item) => item.workspaceId === null || item.workspaceId === browser.activeWorkspaceId)
  const hasFavourite = (scope: 'workspace' | 'global') => !!active?.url && browser.favourites.some((item) => item.url === active.url && item.workspaceId === (scope === 'global' ? null : browser.activeWorkspaceId))
  useEffect(() => { void window.idle.getAppInfo().then((info) => setOnboarding(!info.onboardingComplete)).catch(() => setOnboarding(false)) }, [])
  useEffect(() => {
    const unsubscribe = window.idle.onTabState((state) => { if (state.revision <= authoritative.current.revision) return; if (displayedProfile.current && displayedProfile.current !== state.activeProfileId) { pendingWorkspace.current = null; setOptimisticWorkspace(null); closePalette(); setWorkspaceTarget(null); setWorkspaceEdit(null); setProfileEdit(null); setGroupEdit(null); setSearchOpen(false); setSearch(''); setLibraryOpen(false); setHistoryOpen(false); setFindOpen(false); setFindText(findByProfile.current.get(state.activeProfileId) ?? ''); setCommandOpen(false); setFindResult({ matches: 0, activeMatchOrdinal: 0 }) } const previous = previousHintState.current; previousHintState.current = state; if (previous && previous.activeProfileId !== state.activeProfileId) showHint('profiles'); else if (previous && previous.activeWorkspaceId !== state.activeWorkspaceId && previous.activeProfileId === state.activeProfileId) showHint('workspaces'); else if (previous && state.groups.length > previous.groups.length && previous.activeWorkspaceId === state.activeWorkspaceId) showHint('groups'); else if (previous && state.later.length > previous.later.length && previous.activeWorkspaceId === state.activeWorkspaceId) showHint('later'); displayedProfile.current = state.activeProfileId; acceptState(state); if (paletteRef.current && state.activeId !== paletteRef.current) closePalette(); if (!sidebarWidthLoaded.current) { sidebarWidthLoaded.current = true; setSidebarWidth(state.sidebarWidth) } })
    window.idle.tabCommand({ type: 'sync' })
    return unsubscribe
  }, [])
  useEffect(() => window.idle.onBrowserAction((action, origin) => { if (action === 'find') { setFindOpen(true); setTimeout(() => { findRef.current?.focus(); findRef.current?.select() }, 0) } else if (action === 'sidebar') useUIStore.getState().toggleSidebar(); else if (action === 'command-menu') { captureOrigin('command', origin ?? null); setCommandQuery(''); setCommandOpen(true) } else if (action === 'workspace-next' || action === 'workspace-previous') { const state = workspaceGestureState.current; const index = state.workspaces.findIndex((workspace) => workspace.id === state.activeWorkspaceId); if (index >= 0 && state.workspaces.length > 1) { const next = state.workspaces[(index + (action === 'workspace-next' ? 1 : -1) + state.workspaces.length) % state.workspaces.length]; if (next) switchWorkspaceRef.current(next.id) } } else if (action === 'saved-search') setSearchOpen(true); else if (action === 'downloads') { captureOrigin('downloads', origin ?? null); setHistoryOpen(true) } else if (action === 'history') { if (!useUIStore.getState().sidebarOpen) useUIStore.getState().toggleSidebar(); setLibraryOpen(true); setTimeout(() => { const history = document.querySelector<HTMLDetailsElement>('#history-section'); if (history) history.open = true }, 0) } else if (action === 'focus-chrome') { (document.querySelector<HTMLButtonElement>('.tab-select[aria-current="page"]') ?? document.querySelector<HTMLButtonElement>('.pane-host') ?? document.querySelector<HTMLButtonElement>('[aria-label="Show sidebar"]') ?? document.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar"]'))?.focus() } else if (action === 'about') { captureOrigin('settings', origin ?? null); setSettingsCategory('about'); setSettingsOpen(true); window.idle.tabCommand({ type: 'settings-open', open: true }) } else if (action === 'settings') { captureOrigin('settings', origin ?? null); setSettingsOpen(true); setSearchOpen(false); setCommandOpen(false); setHistoryOpen(false); setFindOpen(false); closePalette(); resetDrag() } else if (action === 'settings-close') setSettingsOpen(false); else if (action === 'dismiss-workspace-actions') setWorkspaceTarget(null); else if (action === 'peek-hint') showHint('peek'); else { setFindOpen(false); setFindResult({ matches: 0, activeMatchOrdinal: 0 }) } }), [])
  useEffect(() => { const unsubscribe = window.idle.onUpdateState(setUpdate); void window.idle.update('state').then(setUpdate); return unsubscribe }, [])
  useEffect(() => { const dismiss = (event: PointerEvent) => { const details = document.querySelector<HTMLDetailsElement>('.profile-switcher[open]'); if (details && event.target instanceof Node && !details.contains(event.target)) details.open = false }; document.addEventListener('pointerdown', dismiss); return () => document.removeEventListener('pointerdown', dismiss) }, [])
  useEffect(() => window.idle.onFindResult(setFindResult), [])
  useEffect(() => window.idle.onSplitPreview((preview) => { if (dragRef.current?.token === preview.token) setSplitPreview(preview) }), [])
  useEffect(() => { if (!splitPreview || dragRef.current?.token !== splitPreview.token) return; const frame = requestAnimationFrame(() => { if (dragRef.current?.token === splitPreview.token) window.idle.tabCommand({ type: 'split-drag-ready', token: splitPreview.token }) }); return () => cancelAnimationFrame(frame) }, [splitPreview])
  useEffect(() => { const dismiss = (event: KeyboardEvent) => { if (event.key !== 'Escape') return; document.querySelectorAll<HTMLDetailsElement>('details.entity-menu[open], details.saved-actions[open], details.profile-switcher[open]').forEach((menu) => { menu.open = false }); setSearchOpen(false); if (overlayState.current.commandOpen) closeOverlayRef.current('command'); else if (overlayState.current.historyOpen) closeOverlayRef.current('downloads'); setLibraryOpen(false); setWorkspaceEdit(null); setProfileEdit(null) }; window.addEventListener('keydown', dismiss); return () => window.removeEventListener('keydown', dismiss) }, [])
  useEffect(() => window.idle.onFocusAddress((id) => { if (id) openPalette(id) }), [])
  useEffect(() => {
    const element = contentRef.current
    if (settingsOpen || !element) return
    let frame = 0
    const update = () => { frame = 0; const r = element.getBoundingClientRect(); window.idle.setViewBounds({ x: r.x, y: r.y, width: r.width, height: r.height, uiScale: interfaceScale }) }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    observer.observe(element); window.addEventListener('resize', schedule); update()
    return () => { if (frame) cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule) }
  }, [sidebarOpen, settingsOpen, interfaceScale, onboarding])
  const command = window.idle.tabCommand
  useEffect(() => {
    const strip = workspaceStrip.current
    if (!strip) return
    let wheelX = 0; let wheelY = 0; let lastWheel = 0; let wheelUsed = false; let cooldownUntil = 0
    let pointer: { id: number; x: number; y: number; moved: boolean; rejected: boolean } | null = null
    let suppressClickUntil = 0
    const navigate = (direction: number) => {
      const now = performance.now()
      if (now < cooldownUntil) return
      const state = workspaceGestureState.current
      const index = state.workspaces.findIndex((workspace) => workspace.id === state.activeWorkspaceId)
      const next = state.workspaces[index + direction]
      if (index < 0 || !next) return
      cooldownUntil = now + 750
      switchWorkspaceRef.current(next.id)
    }
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || dragRef.current) return
      const now = performance.now()
      if (now - lastWheel > 250) { wheelX = 0; wheelY = 0; wheelUsed = false }
      lastWheel = now
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? strip.clientWidth : 1
      wheelX += event.deltaX * scale; wheelY += event.deltaY * scale
      if (Math.abs(wheelX) <= Math.abs(wheelY) * 1.35 || Math.abs(wheelX) < 8) return
      event.preventDefault()
      if (!wheelUsed && Math.abs(wheelX) >= 70) { wheelUsed = true; navigate(wheelX > 0 ? 1 : -1) }
    }
    const down = (event: PointerEvent) => {
      if ((event.pointerType !== 'touch' && event.pointerType !== 'pen') || !event.isPrimary || event.button !== 0) return
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, rejected: false }
    }
    const move = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id || pointer.rejected) return
      const dx = event.clientX - pointer.x; const dy = event.clientY - pointer.y
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { pointer.rejected = true; return }
      if (!pointer.moved && Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.35) { pointer.moved = true; suppressClickUntil = performance.now() + 700; navigate(dx < 0 ? 1 : -1) }
    }
    const end = (event: PointerEvent) => { if (pointer?.id === event.pointerId) pointer = null }
    const click = (event: MouseEvent) => { if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); suppressClickUntil = 0 } }
    strip.addEventListener('wheel', wheel, { passive: false }); strip.addEventListener('pointerdown', down); strip.addEventListener('pointermove', move); strip.addEventListener('pointerup', end); strip.addEventListener('pointercancel', end); strip.addEventListener('click', click, true)
    return () => { strip.removeEventListener('wheel', wheel); strip.removeEventListener('pointerdown', down); strip.removeEventListener('pointermove', move); strip.removeEventListener('pointerup', end); strip.removeEventListener('pointercancel', end); strip.removeEventListener('click', click, true) }
  }, [sidebarOpen, browser.activeProfileId])
  useEffect(() => {
    const strip = workspaceStrip.current; const active = workspaceAnchors.current.get(sidebarBrowser.activeWorkspaceId)
    if (!strip || !active) return
    const entry = active.parentElement ?? active; const left = entry.offsetLeft - strip.offsetLeft; const add = entry.nextElementSibling as HTMLElement | null; const right = left + entry.offsetWidth + (add?.classList.contains('workspace-dock-add') ? add.offsetWidth + 5 : 0)
    if (left < strip.scrollLeft) strip.scrollLeft = left
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
  }, [sidebarBrowser.activeWorkspaceId, sidebarOpen])
  const resetDrag = () => {
    if (dragRef.current) command({ type: 'split-drag-end', token: dragRef.current.token }); setSplitPreview(null)
    dragRef.current = null; setDragId(null); setDropTarget(null); setWorkspaceDrop(null)
    if (scrollTimer.current) clearInterval(scrollTimer.current)
    scrollTimer.current = null
  }
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape' && dragRef.current) resetDrag() }
    window.addEventListener('keydown', cancel)
    return () => { window.removeEventListener('keydown', cancel); if (scrollTimer.current) clearInterval(scrollTimer.current) }
  }, [])
  useEffect(() => { resetDrag() }, [browser.activeWorkspaceId, sidebarOpen])
  const findDrop = (x: number, y: number, hit?: EventTarget | null): { id: string; placement: 'before' | 'after' } | null => {
    const list = tabListRef.current; const drag = dragRef.current
    if (!list || !drag || drag.workspaceId !== browser.activeWorkspaceId) return null
    const bounds = list.getBoundingClientRect()
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null
    const element = (hit instanceof Element ? hit : document.elementFromPoint(x, y))?.closest<HTMLElement>('[data-tab-id]')
    if (!element || !list.contains(element)) return null
    const id = element.dataset.tabId; if (!id || id === drag.id) return null
    const rect = element.getBoundingClientRect()
    const placement = y < rect.top + rect.height / 2 ? 'before' : 'after'
    return reorderTabs(browser.tabs, drag.id, id, placement) ? { id, placement } : null
  }
  useEffect(() => { const clamp = () => setSidebarWidth(useUIStore.getState().sidebarWidth); window.addEventListener('resize', clamp); clamp(); return () => window.removeEventListener('resize', clamp) }, [setSidebarWidth])
  const effectiveWidth = clampSidebarWidth(sidebarWidth, interfaceViewport(window.innerWidth, interfaceScale))
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const isWindows = navigator.platform.toLowerCase().includes('win')
  const switcherProfiles = browser.profiles.map((profile) => ({ ...profile, icon: profile.icon === 'work' || profile.name.trim().toLowerCase() === 'work' ? 'work' as const : 'personal' as const }))
  const quickProfiles: { id: string | null; name: string; icon: 'personal' | 'work' }[] = visibleProfiles(switcherProfiles, browser.activeProfileId)
  if (quickProfiles.length === 1 && !switcherProfiles.some((profile) => profile.icon === 'work')) quickProfiles.push({ id: null, name: 'Work', icon: 'work' })
  const extraProfiles = switcherProfiles.filter((profile) => !quickProfiles.some((visible) => visible.id === profile.id))
  const switchProfile = (id: string | null) => { if (id === null) { resetDrag(); command({ type: 'profile-create', name: 'Work' }) } else if (id !== browser.activeProfileId) { resetDrag(); command({ type: 'profile-switch', id }) } }
  const switchProfileByKeyboard = (id: string | null) => { const sequence = ++profileFocusSequence.current; const from = browser.activeProfileId; resetDrag(); void window.idle.switchProfileForFocus(from, id).then((selected) => { if (profileFocusSequence.current !== sequence) return; profileFocus.current = { id: selected, sequence }; if (authoritative.current.activeProfileId === selected) { profileFocus.current = null; requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-profile-id="${CSS.escape(selected)}"]`)?.focus()) } }).catch(() => { if (profileFocusSequence.current !== sequence) return; profileFocus.current = null; requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.profile-segment[aria-checked="true"]')?.focus()) }) }
  const closeSettings = (restore = true) => { window.idle.tabCommand({ type: 'settings-open', open: false }); setSettingsOpen(false); if (restore) restoreOrigin('settings') }
  const newTab = () => { if (settingsOpen) closeSettings(false); command({ type: 'create' }) }
  const shortcutPrefix = isMac ? '⌘' : 'Ctrl+'
  const commandItems = [
    { label: 'New tab', shortcut: `${shortcutPrefix}T`, run: newTab },
    { label: 'Toggle sidebar', shortcut: `${shortcutPrefix}\\`, run: toggleSidebar },
    { label: 'Save tab for Later', shortcut: `${shortcutPrefix}Shift+L`, run: () => { if (browser.activeId) command({ type: 'save-later', id: browser.activeId }) } },
    { label: 'Search saved pages', shortcut: '', run: () => setSearchOpen(true) },
    { label: 'Show downloads', shortcut: isMac ? '⌘Option+L' : 'Ctrl+J', run: () => { const origin = overlayOrigins.current.get('command'); if (origin) overlayOrigins.current.set('downloads', origin); else captureOrigin('downloads'); setHistoryOpen(true) } },
    ...browser.workspaces.map((workspace) => ({ label: `Switch to ${workspace.name}`, shortcut: '', run: () => switchWorkspace(workspace.id) })),
    ...browser.profiles.map((profile) => ({ label: `Switch to ${profile.name} Profile`, shortcut: '', run: () => switchProfile(profile.id) })),
  ].filter((item) => item.label.toLocaleLowerCase().includes(commandQuery.trim().toLocaleLowerCase()))

  const openWorkspaceActions = (id: string, mode: WorkspaceActionMode) => { const anchor = workspaceAnchors.current.get(id); if (anchor) { anchor.focus(); setWorkspaceEdit(null); setWorkspaceTarget({ id, anchor, mode }) } }
  const closeWorkspaceActions = (restoreFocus = false) => { const anchor = workspaceTarget?.anchor; setWorkspaceTarget(null); if (restoreFocus && anchor?.isConnected) anchor.focus() }
  const renderTab = (tab: TabState) => (<div key={tab.id} data-tab-id={tab.id} draggable className={`tab ${tab.groupId ? 'grouped-tab' : ''} ${tab.id === sidebarBrowser.activeId ? 'active' : ''} ${dragId === tab.id ? 'dragging' : ''} ${dropTarget?.id === tab.id ? `drop-${dropTarget.placement}` : ''}`} onDragStart={(event) => {
        setDragMessage(''); const token = crypto.randomUUID(); dragRef.current = { id: tab.id, workspaceId: browser.activeWorkspaceId, x: event.clientX, y: event.clientY, token }; setDragId(tab.id); command({ type: 'split-drag-start', token })
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tab.id)
        scrollTimer.current = setInterval(() => { const drag = dragRef.current; const list = sidebarScrollRef.current; if (!drag || !list) return; const rect = list.getBoundingClientRect(); if (drag.x < rect.left || drag.x > rect.right || drag.y < rect.top || drag.y > rect.bottom) return; const edge = Math.min(36, rect.height / 3); const speed = drag.y < rect.top + edge ? -8 : drag.y > rect.bottom - edge ? 8 : 0; if (speed) { list.scrollTop += speed; setDropTarget(findDrop(drag.x, drag.y)) } }, 30)
      }} onDragEnd={resetDrag} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); command({ type: 'close', id: tab.id }) } }} onContextMenu={(event) => { event.preventDefault(); command({ type: 'tab-menu', id: tab.id }) }}>
        <button className="tab-select" aria-label={`${tabLabel(tab)}, ${tab.url || 'new tab'}, tab ${sidebarBrowser.tabs.findIndex((item) => item.id === tab.id) + 1} of ${sidebarBrowser.tabs.length}${tab.pinned ? ', pinned' : ''}`} onClick={() => { if (settingsOpen) closeSettings(false); command({ type: 'activate', id: tab.id }) }} aria-current={tab.id === sidebarBrowser.activeId ? 'page' : undefined} title={`${tabLabel(tab)}${tab.url ? ` � ${tab.url}` : ''}`} onKeyDown={(event) => { if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); command({ type: 'move', id: tab.id, direction: event.key === 'ArrowUp' ? 'up' : 'down' }) } }}>
          {tab.loading ? <span className="spinner" aria-label="Loading" /> : tab.favicon ? <img className="favicon" src={tab.favicon} alt="" referrerPolicy="no-referrer" /> : <Icon name="globe" />}
          <span className="tab-label">{tab.pinned ? '📌 ' : ''}{tabLabel(tab)}</span>
        </button><button className="icon-button tab-action" onClick={() => command({ type: 'pin', id: tab.id })} aria-label={`${tab.pinned ? 'Unpin' : 'Pin'} ${tabLabel(tab)}`} title={tab.pinned ? 'Unpin tab' : 'Pin tab'}><Icon name={tab.pinned ? "pin-off" : "pin"} /></button><button className="icon-button close-tab" aria-label={`Close ${tabLabel(tab)}`} title="Close tab" onClick={() => command({ type: 'close', id: tab.id })}><Icon name="close" /></button>
      </div>)
  const hintText: Record<string, string> = { workspaces: 'Workspaces keep your tabs together.', groups: 'Groups help organise tabs within a Workspace.', peek: 'Peek previews a link without leaving your tab.', later: 'Find your saved pages in Library → Later.', profiles: 'Profiles keep browsing sessions separate.' }
  const finishOnboarding = () => { void window.idle.completeOnboarding().then(() => { window.idle.tabCommand({ type: 'settings-open', open: false }); setOnboarding(false); window.idle.tabCommand({ type: 'open-welcome', reuseEmpty: true }) }).catch((error: unknown) => console.error('Unable to complete onboarding:', error)) }
  if (onboarding === null) return <div className="app-shell" />
  if (onboarding) return <Onboarding finish={finishOnboarding} />
  return <div className={`app-shell ${interfaceViewport(window.innerWidth, interfaceScale) <= 620 ? 'ui-compact' : ''} ${isMac ? 'mac' : ''} ${isWindows ? 'windows' : ''}`}>
    {sidebarOpen && <aside id="sidebar" className="sidebar" style={{ flexBasis: effectiveWidth }} aria-label="Browser sidebar">
      <div className="sidebar-titlebar"><div className="profile-quick-switch" role="radiogroup" aria-label="Switch Profile">{quickProfiles.map((profile, index) => <ProfileSegment icon={profile.icon} key={profile.id ?? "new-work"} type="button" role="radio" aria-checked={profile.id === browser.activeProfileId} tabIndex={profile.id === browser.activeProfileId ? 0 : -1} data-profile-id={profile.id ?? undefined} title={profile.id ? `${profile.name} (${isMac ? '⌘' : 'Ctrl+'}Shift+${index + 1})` : "Create and switch to Work"} aria-label={profile.id ? profile.name : "Create and switch to Work Profile"} onClick={() => switchProfile(profile.id)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? quickProfiles.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + quickProfiles.length) % quickProfiles.length; const target = quickProfiles[next]; if (target) switchProfileByKeyboard(target.id) }}>{profile.name}</ProfileSegment>)}</div><details className="profile-switcher" onToggle={(event) => { if (!event.currentTarget.open) setManageProfiles(false) }}><summary className="profile-menu-trigger" aria-label="Profile menu" title="Profile menu"><Icon name="more" /></summary><div className="profile-popover">{extraProfiles.length > 0 && <><div className="profile-popover-heading">Other Profiles</div>{extraProfiles.map((profile) => <button className="profile-option" key={profile.id} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); switchProfile(profile.id) }}><Icon name={profile.icon === 'work' ? 'briefcase-business' : 'user-round'} /><span className="profile-option-name">{profile.name}</span></button>)}<div className="profile-popover-divider" /></>}<button className="profile-manage" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.closest('details')?.removeAttribute('open'); command({ type: 'settings-menu', x: Math.round(rect.left), y: Math.round(rect.bottom) }) }}>Settings</button><button className="profile-manage" onClick={() => setManageProfiles(!manageProfiles)} aria-expanded={manageProfiles}>Manage Profiles <Icon name={manageProfiles ? 'chevron-down' : 'chevron-right'} /></button>{manageProfiles && <div className="profile-manage-actions"><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setProfileName(''); setProfileEdit('create') }}>New Profile</button><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setProfileName(browser.profiles.find((profile) => profile.id === browser.activeProfileId)?.name ?? ''); setProfileEdit('rename') }}>Rename Profile</button><button disabled={browser.profiles.length < 2} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); command({ type: 'profile-delete', id: browser.activeProfileId }) }}>Delete Profile</button></div>}</div></details></div>
      <div className="sidebar-scroll" ref={sidebarScrollRef}>
      {profileEdit && <form className="workspace-edit" onSubmit={(event) => { event.preventDefault(); if (!profileName.trim()) return; if (profileEdit === 'create') command({ type: 'profile-create', name: profileName }); else command({ type: 'profile-rename', id: browser.activeProfileId, name: profileName }); setProfileEdit(null) }}><label htmlFor="profile-name">{profileEdit === 'create' ? 'New Profile name' : 'Profile name'}</label><input id="profile-name" autoFocus maxLength={80} value={profileName} onChange={(event) => setProfileName(event.target.value)} /><div><button type="submit">Save</button><button type="button" onClick={() => setProfileEdit(null)}>Cancel</button></div></form>}
        {dragId && browser.workspaces.length > 1 && <div className="workspace-drop-list" aria-label="Move tab to Workspace">
          <span>Move tab to</span>{browser.workspaces.filter((workspace) => workspace.id !== sidebarBrowser.activeWorkspaceId).map((workspace) => <div key={workspace.id} className={`workspace-drop ${workspaceDrop === workspace.id ? 'workspace-drop-active' : ''}`} onDragEnter={(event) => { if (dragRef.current?.workspaceId === sidebarBrowser.activeWorkspaceId) { event.preventDefault(); setWorkspaceDrop(workspace.id) } }} onDragOver={(event) => { if (dragRef.current?.workspaceId === sidebarBrowser.activeWorkspaceId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setWorkspaceDrop(workspace.id) } }} onDragLeave={() => setWorkspaceDrop(null)} onDrop={(event) => { const drag = dragRef.current; if (drag && drag.workspaceId === sidebarBrowser.activeWorkspaceId && workspace.id !== drag.workspaceId) { event.preventDefault(); command({ type: 'move-to-workspace', id: drag.id, sourceWorkspaceId: drag.workspaceId, destinationWorkspaceId: workspace.id }) } resetDrag() }}>{workspace.name}</div>)}
        </div>}
      <nav className="workspace-dock" aria-label="Workspaces"><div ref={workspaceStrip} className="workspace-dock-scroll">{browser.workspaces.map((workspace) => <div className="workspace-dock-entry" key={workspace.id} onContextMenu={(event) => { event.preventDefault(); openWorkspaceActions(workspace.id, 'menu') }}><button ref={(element) => { if (element) workspaceAnchors.current.set(workspace.id, element); else workspaceAnchors.current.delete(workspace.id) }} className={`workspace-dock-item ${workspace.id === sidebarBrowser.activeWorkspaceId ? 'active' : ''}`} aria-label={workspace.name} aria-current={workspace.id === sidebarBrowser.activeWorkspaceId ? 'page' : undefined} aria-haspopup="menu" title={workspace.name} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openWorkspaceActions(workspace.id, 'menu') } }} onClick={() => { setWorkspaceEdit(null); setWorkspaceTarget(null); switchWorkspace(workspace.id) }}>{workspace.emoji}</button></div>)}<button className="workspace-dock-add" aria-label="New Workspace" title="New Workspace" onClick={() => { setWorkspaceTarget(null); setWorkspaceName(''); setWorkspaceEmoji('🌐'); setWorkspaceEdit('create') }}><Icon name="plus" /></button></div></nav>
      {workspaceTarget && browser.workspaces.some((workspace) => workspace.id === workspaceTarget.id) && <WorkspaceActions key={workspaceTarget.id} target={workspaceTarget} name={browser.workspaces.find((workspace) => workspace.id === workspaceTarget.id)?.name ?? 'Workspace'} index={browser.workspaces.findIndex((workspace) => workspace.id === workspaceTarget.id)} count={browser.workspaces.length} setMode={(mode) => setWorkspaceTarget((current) => current ? { ...current, mode } : null)} close={closeWorkspaceActions} command={command} />}
      {workspaceEdit === 'create' && <form className="workspace-edit" onSubmit={(event) => { event.preventDefault(); const value = workspaceName.trim(); if (!value) return; command({ type: 'workspace-create', name: value, emoji: workspaceEmoji }); setWorkspaceEdit(null) }}><label htmlFor="workspace-name">New Workspace name</label><input id="workspace-name" autoFocus maxLength={80} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /><span>Workspace emoji</span><WorkspaceEmojiPicker value={workspaceEmoji} onChange={setWorkspaceEmoji} /><div><button type="submit">Save</button><button type="button" onClick={() => setWorkspaceEdit(null)}>Cancel</button></div></form>}
      <div className="sidebar-heading"><span className="sidebar-heading-name" title={activeWorkspaceName}>{activeWorkspaceName}</span><span><button className="icon-button" onClick={() => command({ type: 'group-create', name: 'New Group', color: '#55766b' })} aria-label="New group" title="New group"><Icon name="folder-plus" /></button><button className="icon-button" onClick={newTab} aria-label="New tab" title="New tab"><Icon name="plus" /></button></span></div>
      <div className="tab-list" ref={tabListRef} inert={!!optimisticWorkspace} aria-busy={!!optimisticWorkspace} onDragOver={(event) => {
        const drag = dragRef.current; if (!drag) return
        drag.x = event.clientX; drag.y = event.clientY
        const target = findDrop(drag.x, drag.y, event.target); setDropTarget(target)
        event.preventDefault(); event.dataTransfer.dropEffect = target ? 'move' : 'none'
      }} onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null) }} onDrop={(event) => {
        const drag = dragRef.current; const target = findDrop(event.clientX, event.clientY, event.target)
        event.preventDefault(); if (drag && target) command({ type: 'reorder-tab', id: drag.id, targetId: target.id, placement: target.placement, workspaceId: drag.workspaceId }); else setDragMessage('Tab was not moved.');
        resetDrag()
      }}>{sidebarBrowser.tabs.filter((tab) => tab.pinned).map(renderTab)}{sidebarBrowser.groups.map((group) => <section className={`tab-group-card ${group.collapsed ? 'collapsed' : ''} ${group.collapsed && group.tabIds.includes(sidebarBrowser.activeId ?? '') ? 'contains-active' : ''}`} style={{ '--group-color': group.color } as React.CSSProperties} key={group.id} aria-label={`${group.name} group`}><div className="tab-group-heading"><button className="group-toggle" onClick={() => command({ type: 'group-toggle', id: group.id })} aria-expanded={!group.collapsed} aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.name}, ${group.tabIds.length} tabs${group.collapsed && group.tabIds.includes(sidebarBrowser.activeId ?? '') ? ', contains active tab' : ''}`}><Folder className="group-folder" aria-hidden="true" size={16} strokeWidth={1.8} /><span className="group-name" title={group.name}>{group.name}</span><small>{group.tabIds.length}</small><span aria-hidden="true"><Icon name={group.collapsed ? 'chevron-right' : 'chevron-down'} /></span></button><details className="entity-menu group-actions" onClickCapture={(event) => { if (event.target instanceof HTMLButtonElement) event.currentTarget.removeAttribute('open') }}><summary aria-label={`Actions for ${group.name}`} title="Group actions">···</summary><div className="entity-menu-items"><button onClick={() => { setGroupName(group.name); setGroupEdit(group.id) }}>Rename group</button><label className="group-color-label">Group colour<input type="color" value={/^#[0-9a-f]{6}$/i.test(group.color) ? group.color : '#55766b'} onChange={(event) => command({ type: 'group-color', id: group.id, color: event.target.value })} /></label><button onClick={() => command({ type: 'group-delete', id: group.id })}>Ungroup tabs</button></div></details></div>{groupEdit === group.id && <form className="workspace-edit group-edit" onSubmit={(event) => { event.preventDefault(); if (groupName.trim()) command({ type: 'group-rename', id: group.id, name: groupName }); setGroupEdit(null) }}><label>Group name<input autoFocus maxLength={80} value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label><div><button type="submit">Save</button><button type="button" onClick={() => setGroupEdit(null)}>Cancel</button></div></form>}{!group.collapsed && <div className="group-tabs">{sidebarBrowser.tabs.filter((tab) => tab.groupId === group.id && !tab.pinned).map(renderTab)}{group.tabIds.length === 0 && <p className="sidebar-empty">No tabs in this group</p>}</div>}</section>)}{sidebarBrowser.tabs.filter((tab) => !tab.pinned && (!tab.groupId || !sidebarBrowser.groups.some((group) => group.id === tab.groupId))).map(renderTab)}{sidebarBrowser.tabs.length === 0 && (!optimisticWorkspace || workspaceSnapshots.current.has(snapshotKey(optimisticWorkspace.profile, optimisticWorkspace.id))) && <p className="sidebar-empty">No open tabs</p>}</div>

      </div>

      {hint && <div className="discovery-hint" role="status"><span>{hintText[hint]}</span><button type="button" aria-label="Dismiss hint" onClick={dismissHint}>×</button></div>}
      <div className="library-footer">{libraryOpen && <section id="library-panel" className="library-panel" aria-label="Library"><div className="library-panel-heading"><strong>Library</strong><button className="icon-button" aria-label="Close Library" onClick={() => setLibraryOpen(false)}><Icon name="close" /></button></div><details className="later-section">
        <summary><span className="destination-label"><span aria-hidden="true">◷</span> Later</span><span className="destination-count">{sidebarBrowser.later.length || ''}</span></summary>
        <div className="later-list">{sidebarBrowser.later.length === 0 ? <p className="sidebar-empty">Saved pages appear here.</p> : sidebarBrowser.later.map((item) => <LaterRow key={item.id} item={item} />)}</div>
      </details>
      <details id="history-section" className="later-section"><summary><span className="destination-label"><span aria-hidden="true">↶</span> History</span><span className="destination-count">{browser.history.length || ''}</span></summary><div className="later-list">{browser.history.length === 0 ? <p className="sidebar-empty">No browsing history yet.</p> : browser.history.map((item) => <div className="later-item" key={`${item.workspaceId}:${item.url}`}><button className="later-open" title={item.url} onClick={() => command({ type: 'history-open', url: item.url, workspaceId: item.workspaceId })}>{item.title || item.url}</button><span className="later-meta">{browser.workspaces.find((workspace) => workspace.id === item.workspaceId)?.name}</span></div>)}</div></details>
      {sidebarBrowser.laterError && <p role="alert" className="later-error">{sidebarBrowser.laterError}</p>}

      {<div className="favourites-section"><div className="sidebar-heading"><span>Favourites</span><details className="saved-actions favourite-add" onClickCapture={(event) => { if (event.target instanceof HTMLButtonElement) event.currentTarget.removeAttribute('open') }}><summary aria-label="Favourite current page" title="Favourite current page">+</summary><div className="saved-actions-items"><button disabled={!active?.url} onClick={() => command({ type: 'favourite-toggle', scope: 'workspace' })}>{hasFavourite('workspace') ? 'Remove from Workspace' : 'Add to Workspace'}</button><button disabled={!active?.url} onClick={() => command({ type: 'favourite-toggle', scope: 'global' })}>{hasFavourite('global') ? 'Remove global Favourite' : 'Add global Favourite'}</button></div></details></div>
        <div className="favourites-list">{visibleFavourites.length === 0 ? <p className="sidebar-empty favourite-empty">Your favourites will appear here</p> : visibleFavourites.map((item) => {
          const group = visibleFavourites.filter((entry) => entry.workspaceId === item.workspaceId); const index = group.findIndex((entry) => entry.id === item.id)
          return <div className="favourite-row" key={item.id}><button className="favourite-open" title={item.url} onClick={() => command({ type: 'favourite-open', id: item.id })}><span aria-hidden="true">{item.workspaceId === null ? '◇' : '☆'}</span> {item.title || item.url}</button><details className="saved-actions" onClickCapture={(event) => { if (event.target instanceof HTMLButtonElement) event.currentTarget.removeAttribute('open') }}><summary aria-label={`Actions for ${item.title}`} title="Favourite actions">···</summary><div className="saved-actions-items"><button disabled={index === 0} onClick={() => command({ type: 'favourite-move', id: item.id, direction: 'up' })}>Move up</button><button disabled={index === group.length - 1} onClick={() => command({ type: 'favourite-move', id: item.id, direction: 'down' })}>Move down</button><button onClick={() => command({ type: 'favourite-remove', id: item.id })}>Remove Favourite</button></div></details></div>
        })}</div>
      </div>}
</section>}<button className="library-trigger" aria-expanded={libraryOpen} aria-controls="library-panel" onClick={() => setLibraryOpen(!libraryOpen)}><Icon name="later" /><span>Library</span></button></div>
      <div role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, interfaceViewport(window.innerWidth, interfaceScale) - 320))} aria-valuenow={effectiveWidth} tabIndex={0} className="sidebar-resize" onPointerDown={(event) => { if (event.button !== 0) return; resizeStart.current = { width: effectiveWidth, x: event.clientX }; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }} onPointerMove={(event) => { if (resizeStart.current !== null && event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarWidth(resizeStart.current.width + (event.clientX - resizeStart.current.x) / interfaceScale) }} onPointerUp={(event) => { if (resizeStart.current === null) return; resizeStart.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); saveSidebarWidth() }} onPointerCancel={() => { if (resizeStart.current !== null) setSidebarWidth(resizeStart.current.width); resizeStart.current = null }} onLostPointerCapture={() => { if (resizeStart.current !== null) { setSidebarWidth(resizeStart.current.width); resizeStart.current = null } }} onKeyDown={(event) => { const delta = event.shiftKey ? 25 : 10; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') { event.preventDefault(); setSidebarWidth(event.key === 'Home' ? MIN_SIDEBAR_WIDTH : event.key === 'End' ? MAX_SIDEBAR_WIDTH : effectiveWidth + (event.key === 'ArrowRight' ? delta : -delta)); saveSidebarWidth() } }} />
    </aside>}
    <div className="sr-only" aria-live="polite" aria-atomic="true">{browser.announcement || dragMessage}</div>
    <div className="browser-pane">
      <header className="toolbar window-toolbar" aria-label="Window controls">
        <div className="toolbar-drag" aria-hidden="true" />
        <button className="icon-button" onClick={toggleSidebar} aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} title={`${sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} (${isMac ? '⌘' : 'Ctrl+'}\\)`} aria-expanded={sidebarOpen} aria-controls="sidebar"><Icon name="sidebar" /></button>
        <span className="window-title" aria-hidden="true" />
        {isWindows && <button className="icon-button app-menu-button" aria-label="Application menu" title="Application menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); command({ type: 'app-menu', x: Math.round(rect.left), y: Math.round(rect.bottom) }) }}>···</button>}
      </header>
      {update.status === 'ready' && !update.dismissed && <section className="update-panel" role="status"><strong>Update ready</strong><button onClick={() => void window.idle.update('install').then(setUpdate)}>Restart to update</button><button onClick={() => void window.idle.update('dismiss').then(setUpdate)}>Later</button></section>}
      {update.status === 'save-error' && <section className="update-panel" role="alert"><strong>Could not save browsing state. Please try again.</strong><button onClick={() => void window.idle.update('install').then(setUpdate)}>Restart to update</button></section>}
      {findOpen && <section className="find-bar" aria-label="Find in page"><input ref={findRef} aria-label="Find in page" placeholder="Find in page" value={findText} onChange={(event) => { setFindText(event.target.value); findByProfile.current.set(browser.activeProfileId, event.target.value); command({ type: 'find-query', value: event.target.value }) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); command({ type: 'find-step', forward: !event.shiftKey }) } else if (event.key === 'Escape') { event.preventDefault(); command({ type: 'find-close' }); setFindOpen(false); setFindResult({ matches: 0, activeMatchOrdinal: 0 }) } }} /><span role="status">{findText ? `${findResult.activeMatchOrdinal} / ${findResult.matches}` : ''}</span><button onClick={() => command({ type: 'find-step', forward: false })} aria-label="Previous match">↑</button><button onClick={() => command({ type: 'find-step', forward: true })} aria-label="Next match">↓</button><button onClick={() => { command({ type: 'find-close' }); setFindOpen(false); setFindResult({ matches: 0, activeMatchOrdinal: 0 }) }} aria-label="Close find">×</button></section>}
      {commandOpen && <section className="command-menu" role="dialog" aria-label="Command menu"><form className="command-search-row" onSubmit={(event) => { event.preventDefault(); const item = commandItems[0]; if (item) { setCommandOpen(false); item.run() } }}><input autoFocus aria-label="Search commands" placeholder="Type a command…" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeOverlay('command') } }} /><button type="button" aria-label="Close command menu" onClick={() => closeOverlay('command')}>×</button></form><div className="command-menu-items">{commandItems.map((item, index) => <button key={`${index}:${item.label}`} onClick={() => { setCommandOpen(false); item.run() }}><span>{item.label}</span><kbd>{item.shortcut}</kbd></button>)}{commandItems.length === 0 && <p>No commands found.</p>}</div></section>}
      {historyOpen && <section className="download-panel" aria-label="Downloads"><div className="download-heading"><strong>Downloads</strong><button autoFocus onClick={() => closeOverlay('downloads')} aria-label="Close downloads">×</button></div>{browser.downloads.length === 0 ? <p>No downloads yet.</p> : browser.downloads.map((download) => <div className="download-row" key={download.id}><span>{download.filename}</span><small>{download.status}{download.total > 0 ? ` · ${Math.round(download.received / download.total * 100)}%` : download.received ? ` · ${Math.round(download.received / 1024)} KB` : ''}</small>{download.status === 'Downloading' && download.total > 0 && <progress max={download.total} value={download.received} />}</div>)}</section>}
      {searchOpen && <section className="command-search" aria-label="Search saved pages"><div className="command-search-row"><input autoFocus aria-label="Search Favourites and Later" placeholder="Search Favourites and Later" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} /><button onClick={() => setSearchOpen(false)} aria-label="Close saved pages search">×</button></div>
        {query && <div className="command-results">{searchFavourites.map((item) => <button key={item.id} onClick={() => { command({ type: 'favourite-open', id: item.id }); setSearchOpen(false) }}><span>{item.title || item.url}</span><small>Favourite · {item.workspaceId === null ? 'Global' : browser.workspaces.find((workspace) => workspace.id === item.workspaceId)?.name}</small></button>)}{searchLater.map((item) => <button key={item.id} onClick={() => { command({ type: 'search-later-open', id: item.id, workspaceId: item.workspaceId }); setSearchOpen(false) }}><span>{item.title || item.url}</span><small>Later · {browser.workspaces.find((workspace) => workspace.id === item.workspaceId)?.name}</small></button>)}{searchFavourites.length + searchLater.length === 0 && <p>No saved pages found.</p>}</div>}
      </section>}
      {browser.navigationError && <div role="alert" className="error-banner">{browser.navigationError}</div>}
      {browser.storageWarning && <div role="alert" className="error-banner">{browser.storageWarning}</div>}
      {active?.error && active.url !== WELCOME_URL && <div role="alert" className="error-banner">Could not load page: {active.error}</div>}
      {settingsOpen ? <SettingsPage category={settingsCategory} setCategory={setSettingsCategory} close={closeSettings} browser={browser} update={update} /> : (
      <div className={`canvas-frame ${browser.splitTree ? 'split-canvas' : ''}`}>{browser.activeId && <div className="split-frames"><SplitFrames tree={browser.splitTree ?? { type: 'leaf', tabId: browser.activeId }} tabs={browser.tabs} activeId={browser.activeId} editingId={paletteId} open={openPalette} close={closePalette} groups={browser.groups} workspace={browser.workspaces.find((item) => item.id === browser.activeWorkspaceId)?.name ?? 'Workspace'} /></div>}{dragId && browser.activeId && <SplitDropSurface tree={browser.splitTree ?? { type: 'leaf', tabId: browser.activeId }} dragId={dragId} workspaceId={browser.activeWorkspaceId} images={splitPreview?.images ?? {}} onFinish={resetDrag} />}<main ref={contentRef} className="webpage" aria-label="Webpage"><div className="empty-state">{active?.error && active.url === WELCOME_URL ? <><div className="empty-symbol"><Icon name="globe" /></div><h1>Welcome to Idle</h1><p>The welcome page is unavailable. You can still browse: enter a website or search above.<br />Use Workspaces to organise tabs and Profiles to separate sessions. Drag a tab to split the view, preview links with Peek, and find saved pages in Library → Later.</p><button className="empty-action" onClick={() => command({ type: 'reload' })}>Try again</button></> : <><div className="empty-symbol"><Icon name="globe" /></div><h1>{active?.error ? 'Page unavailable' : active?.loading ? 'Loading page…' : active ? 'A little room to explore' : 'Your next stop awaits'}</h1><p>{active?.error ? 'Check the address or try reloading.' : active?.loading ? 'Just a moment.' : active ? 'Search or enter a URL above to get started.' : 'Open a new tab or enter an address above.'}</p>{!active && <button className="empty-action" onClick={newTab}>New tab</button>}</>}</div></main></div>
      )}
    </div>
  </div>
}
function PeekToolbar() {
  return <div className="peek-toolbar" role="toolbar" aria-label="Peek controls">
    <button type="button" aria-label="Close Peek" title="Close Peek" onClick={() => window.idle.tabCommand({ type: 'peek-close', id: 'toolbar' })}><X size={16} strokeWidth={1.8} /></button>
    <button type="button" aria-label="Open Peek in current tab" title="Open in current tab" onClick={() => window.idle.tabCommand({ type: 'peek-expand' })}><Maximize2 size={16} strokeWidth={1.8} /></button>
  </div>
}
createRoot(document.getElementById('root')!).render(<StrictMode>{location.hash === '#peek-toolbar' ? <PeekToolbar /> : location.hash === '#peek-backdrop' ? <div className="peek-backdrop" /> : <App />}</StrictMode>)





