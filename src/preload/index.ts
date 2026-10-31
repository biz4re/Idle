import { contextBridge, ipcRenderer } from 'electron'
import { APP_INFO_CHANNEL, SPLIT_PREVIEW_CHANNEL, VIEW_BOUNDS_CHANNEL, TAB_COMMAND_CHANNEL, TAB_STATE_CHANNEL, SHORTCUT_CHANNEL, BROWSER_ACTION_CHANNEL, FIND_RESULT_CHANNEL, type BrowserState, type IdleAPI } from '../shared/ipc'
const api: IdleAPI = {
  setViewBounds: (bounds) => ipcRenderer.send(VIEW_BOUNDS_CHANNEL, bounds),
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  tabCommand: (command) => ipcRenderer.send(TAB_COMMAND_CHANNEL, command),
  onBrowserAction: (callback) => { const listener = (_event: Electron.IpcRendererEvent, action: 'find' | 'dismiss' | 'sidebar' | 'saved-search' | 'downloads') => callback(action); ipcRenderer.on(BROWSER_ACTION_CHANNEL, listener); return () => ipcRenderer.removeListener(BROWSER_ACTION_CHANNEL, listener) },
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
