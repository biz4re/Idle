import { contextBridge, ipcRenderer } from 'electron'
import { ONBOARDING_CHANNEL, APP_INFO_CHANNEL, SPLIT_PREVIEW_CHANNEL, VIEW_BOUNDS_CHANNEL, TAB_COMMAND_CHANNEL, TAB_STATE_CHANNEL, WORKSPACE_SWITCH_CHANNEL, PROFILE_SWITCH_CHANNEL, SHORTCUT_CHANNEL, BROWSER_ACTION_CHANNEL, FIND_RESULT_CHANNEL, PEEK_HOST_CHANNEL, type BrowserState, type IdleAPI } from '../shared/ipc'
import { UPDATE_CHANNEL, UPDATE_STATE_CHANNEL, type UpdateState } from '../shared/ipc'
const api: IdleAPI = {
  update: (action) => ipcRenderer.invoke(UPDATE_CHANNEL, action),
  onUpdateState: (callback) => { const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state); ipcRenderer.on(UPDATE_STATE_CHANNEL, listener); return () => ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, listener) },
  onPeekHost: (callback) => { const listener = (_event: Electron.IpcRendererEvent, hostname: string) => callback(hostname); ipcRenderer.on(PEEK_HOST_CHANNEL, listener); return () => ipcRenderer.removeListener(PEEK_HOST_CHANNEL, listener) },
  setViewBounds: (bounds) => ipcRenderer.send(VIEW_BOUNDS_CHANNEL, bounds),
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  completeOnboarding: () => ipcRenderer.invoke(ONBOARDING_CHANNEL),
  tabCommand: (command) => ipcRenderer.send(TAB_COMMAND_CHANNEL, command),
  switchWorkspace: (profileId, id) => ipcRenderer.invoke(WORKSPACE_SWITCH_CHANNEL, profileId, id),
  switchProfileForFocus: (profileId, id) => ipcRenderer.invoke(PROFILE_SWITCH_CHANNEL, profileId, id),
  onBrowserAction: (callback) => { const listener = (_event: Electron.IpcRendererEvent, action: 'find' | 'dismiss' | 'sidebar' | 'command-menu' | 'workspace-next' | 'workspace-previous' | 'saved-search' | 'downloads' | 'history' | 'about' | 'settings' | 'settings-close' | 'focus-chrome' | 'dismiss-workspace-actions' | 'peek-hint', origin?: string | null) => callback(action, origin); ipcRenderer.on(BROWSER_ACTION_CHANNEL, listener); return () => ipcRenderer.removeListener(BROWSER_ACTION_CHANNEL, listener) },
  onFindResult: (callback) => { const listener = (_event: Electron.IpcRendererEvent, result: { matches: number; activeMatchOrdinal: number }) => callback(result); ipcRenderer.on(FIND_RESULT_CHANNEL, listener); return () => ipcRenderer.removeListener(FIND_RESULT_CHANNEL, listener) },
  onFocusAddress: (callback) => { const listener = (_event: Electron.IpcRendererEvent, id: string | null) => callback(id); ipcRenderer.on(SHORTCUT_CHANNEL, listener); return () => ipcRenderer.removeListener(SHORTCUT_CHANNEL, listener) },
  onSplitPreview: (callback) => { const listener = (_event: Electron.IpcRendererEvent, preview: { token: string; images: Record<string, string> }) => callback(preview); ipcRenderer.on(SPLIT_PREVIEW_CHANNEL, listener); return () => ipcRenderer.removeListener(SPLIT_PREVIEW_CHANNEL, listener) },
  onTabState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BrowserState) => callback(state)
    ipcRenderer.on(TAB_STATE_CHANNEL, listener)
    return () => ipcRenderer.removeListener(TAB_STATE_CHANNEL, listener)
  },
}
contextBridge.exposeInMainWorld('idle', Object.freeze(api))
