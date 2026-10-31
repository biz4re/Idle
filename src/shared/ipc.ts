import type { SplitTree } from './split-tree'
export const SPLIT_PREVIEW_CHANNEL = 'idle:split-preview'
export const VIEW_BOUNDS_CHANNEL = 'idle:view-bounds'
export const APP_INFO_CHANNEL = 'idle:app-info'
export const TAB_COMMAND_CHANNEL = 'idle:tab-command'
export const BROWSER_ACTION_CHANNEL = 'idle:browser-action'
export const FIND_RESULT_CHANNEL = 'idle:find-result'
export const SHORTCUT_CHANNEL = 'idle:shortcut'
export const TAB_STATE_CHANNEL = 'idle:tab-state'
export const PEEK_HOST_CHANNEL = 'idle:peek-host'
export interface ViewBounds { x: number; y: number; width: number; height: number }
export interface AppInfo { name: string; version: string }
export interface TabState { id: string; url: string; pinned: boolean; groupId: string | null; title: string; favicon: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string }
export interface TabGroup { id: string; workspaceId: string; name: string; color: string; collapsed: boolean; position: number; tabIds: string[] }
export interface LaterItem { id: string; workspaceId: string; url: string; title: string; savedAt: number; note: string; done: boolean }
export interface Favourite { id: string; workspaceId: string | null; url: string; title: string }
export interface HistoryEntry { url: string; title: string; visitedAt: number; workspaceId: string }
export interface DownloadState { id: string; filename: string; received: number; total: number; status: string }
export interface BrowserState { splitTree: SplitTree | null; tabs: TabState[]; groups: TabGroup[]; activeId: string | null; recentlyClosed: number; workspaces: { id: string; name: string; emoji: string }[]; activeWorkspaceId: string; later: LaterItem[]; laterError: string; favourites: Favourite[]; searchLater: LaterItem[]; history: HistoryEntry[]; downloads: DownloadState[]; storageWarning: string; profiles: { id: string; name: string; icon: 'personal' | 'work' }[]; activeProfileId: string; sidebarWidth: number; navigationError: string; announcement: string }
export type TabCommand = { type: 'peek-back' | 'peek-expand' } | { type: 'peek-open'; id: string; url: string } | { type: 'peek-close'; id: string } | { type: 'pane-switcher'; id: string; kind: 'workspace' | 'group'; x: number; y: number } | { type: 'pane-focus'; id: string } | { type: 'pane-command'; id: string; action: 'back' | 'forward' | 'reload' | 'stop' | 'navigate'; value?: string } | { type: 'pane-menu'; id: string; x: number; y: number } | { type: 'split-drag-start' | 'split-drag-ready' | 'split-drag-end'; token: string } | { type: 'split-drop'; id: string; targetId: string; workspaceId: string; edge: 'left' | 'right' | 'top' | 'bottom' } | { type: 'create'; groupId?: string } | { type: 'back' | 'forward' | 'reload' | 'stop' | 'sync' | 'reopen' } | { type: 'activate' | 'close'; id: string } | { type: 'navigate'; value: string } | { type: 'app-menu'; x: number; y: number } | { type: 'find-query'; value: string } | { type: 'find-step'; forward: boolean } | { type: 'find-close' } | { type: 'sidebar-width'; width: number } | { type: 'profile-create'; name: string } | { type: 'profile-rename'; id: string; name: string } | { type: 'profile-switch' | 'profile-delete'; id: string } | { type: 'history-open'; url: string; workspaceId: string } | { type: 'favourite-toggle'; scope: 'workspace' | 'global' } | { type: 'favourite-open' | 'favourite-remove'; id: string } | { type: 'favourite-move'; id: string; direction: 'up' | 'down' } | { type: 'search-later-open'; id: string; workspaceId: string } | { type: 'save-later' | 'tab-menu'; id: string } | { type: 'later-open' | 'later-remove' | 'later-toggle'; id: string } | { type: 'later-note'; id: string; note: string } | { type: 'workspace-create'; name: string } | { type: 'workspace-rename'; id: string; name: string } | { type: 'workspace-emoji'; id: string; emoji: string } | { type: 'workspace-switch' | 'workspace-delete'; id: string } | { type: 'pin'; id: string } | { type: 'move'; id: string; direction: 'up' | 'down' } | { type: 'move-to-workspace'; id: string; sourceWorkspaceId: string; destinationWorkspaceId: string } | { type: 'reorder-tab'; id: string; targetId: string; placement: 'before' | 'after'; workspaceId: string } | { type: 'group-create'; name: string; color: string } | { type: 'group-rename'; id: string; name: string } | { type: 'group-color'; id: string; color: string } | { type: 'group-toggle'; id: string } | { type: 'group-delete'; id: string } | { type: 'group-add'; tabId: string; groupId: string | null }
export interface IdleAPI {
  onPeekHost: (callback: (hostname: string) => void) => () => void
  setViewBounds: (bounds: ViewBounds) => void
  getAppInfo: () => Promise<AppInfo>
  tabCommand: (command: TabCommand) => void
  onBrowserAction: (callback: (action: 'find' | 'dismiss' | 'sidebar' | 'saved-search' | 'downloads') => void) => () => void
  onFindResult: (callback: (result: { matches: number; activeMatchOrdinal: number }) => void) => () => void
  onFocusAddress: (callback: (id: string | null) => void) => () => void
  onSplitPreview: (callback: (preview: { token: string; images: Record<string, string> }) => void) => () => void
  onTabState: (callback: (state: BrowserState) => void) => () => void
}

