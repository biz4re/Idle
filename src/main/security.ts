import type { TabCommand, ViewBounds } from '../shared/ipc'

const idActions = new Set(['activate', 'close', 'pane-focus', 'focus-page', 'favourite-open', 'favourite-remove', 'save-later', 'tab-menu', 'later-open', 'later-remove', 'later-toggle', 'workspace-switch', 'workspace-delete', 'profile-switch', 'profile-delete', 'pin'])
const simpleActions = new Set(['back', 'forward', 'reload', 'stop', 'sync', 'reopen', 'find-close'])
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const id = (value: unknown): value is string => text(value, 128) && value.length > 0
export function isTabCommand(value: unknown): value is TabCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const cmd = value as Record<string, unknown>
  if (typeof cmd.type !== 'string') return false
  if (simpleActions.has(cmd.type)) return true
  if (idActions.has(cmd.type)) return id(cmd.id)
  switch (cmd.type) {
    case 'peek-back': case 'peek-expand': return true
    case 'peek-open': return id(cmd.id) && text(cmd.url, 8192) && isWebURL(cmd.url)
    case 'peek-close': return id(cmd.id)
    case 'pane-switcher': return id(cmd.id) && (cmd.kind === 'workspace' || cmd.kind === 'group') && typeof cmd.x === 'number' && Number.isInteger(cmd.x) && cmd.x >= 0 && cmd.x <= 100000 && typeof cmd.y === 'number' && Number.isInteger(cmd.y) && cmd.y >= 0 && cmd.y <= 100000
    case 'create': return cmd.groupId === undefined || id(cmd.groupId)
    case 'pane-command': return id(cmd.id) && ['back', 'forward', 'reload', 'stop', 'navigate'].includes(String(cmd.action)) && (cmd.action !== 'navigate' || text(cmd.value, 8192))
    case 'pane-menu': return id(cmd.id) && typeof cmd.x === 'number' && Number.isInteger(cmd.x) && cmd.x >= 0 && cmd.x <= 100000 && typeof cmd.y === 'number' && Number.isInteger(cmd.y) && cmd.y >= 0 && cmd.y <= 100000
    case 'split-drag-start': case 'split-drag-ready': case 'split-drag-end': return id(cmd.token)
    case 'split-drop': return id(cmd.id) && id(cmd.targetId) && id(cmd.workspaceId) && ['left', 'right', 'top', 'bottom'].includes(String(cmd.edge))
    case 'move-to-workspace': return id(cmd.id) && id(cmd.sourceWorkspaceId) && id(cmd.destinationWorkspaceId) && cmd.sourceWorkspaceId !== cmd.destinationWorkspaceId
    case 'reorder-tab': return id(cmd.id) && id(cmd.targetId) && id(cmd.workspaceId) && (cmd.placement === 'before' || cmd.placement === 'after')
    case 'settings-open': return typeof cmd.open === 'boolean'
    case 'peek-mode': return cmd.mode === 'automatic' || cmd.mode === 'manual'
    case 'sidebar-width': return typeof cmd.width === 'number' && Number.isInteger(cmd.width) && cmd.width >= 200 && cmd.width <= 400
    case 'find-query': return text(cmd.value, 1000)
    case 'find-step': return typeof cmd.forward === 'boolean'
    case 'app-menu': case 'settings-menu': return typeof cmd.x === 'number' && Number.isInteger(cmd.x) && cmd.x >= 0 && cmd.x <= 100000 && typeof cmd.y === 'number' && Number.isInteger(cmd.y) && cmd.y >= 0 && cmd.y <= 100000
    case 'navigate': return text(cmd.value, 8192)
    case 'history-open': return text(cmd.url, 8192) && id(cmd.workspaceId)
    case 'search-later-open': return id(cmd.id) && id(cmd.workspaceId)
    case 'profile-create': return text(cmd.name, 80)
    case 'profile-rename': return id(cmd.id) && text(cmd.name, 80)
    case 'workspace-create': return text(cmd.name, 80) && (cmd.emoji === undefined || (text(cmd.emoji, 64) && cmd.emoji.trim().length > 0))
    case 'workspace-rename': return id(cmd.id) && text(cmd.name, 80)
    case 'workspace-emoji': return id(cmd.id) && text(cmd.emoji, 64) && cmd.emoji.trim().length > 0
    case 'later-note': return id(cmd.id) && text(cmd.note, 2000)
    case 'group-create': return text(cmd.name, 80) && text(cmd.color, 32)
    case 'group-rename': return id(cmd.id) && text(cmd.name, 80)
    case 'group-color': return id(cmd.id) && text(cmd.color, 32)
    case 'group-toggle': case 'group-delete': return id(cmd.id)
    case 'group-add': return id(cmd.tabId) && (cmd.groupId === null || id(cmd.groupId))
    case 'favourite-toggle': return cmd.scope === 'workspace' || cmd.scope === 'global'
    case 'move': case 'favourite-move': case 'workspace-move': return id(cmd.id) && (cmd.direction === 'up' || cmd.direction === 'down')
    default: return false
  }
}
export function isViewBounds(value: unknown): value is ViewBounds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const bounds = value as Record<string, unknown>
  return [bounds.x, bounds.y, bounds.width, bounds.height].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000) && (bounds.uiScale === undefined || bounds.uiScale === 1 || bounds.uiScale === 1.25 || bounds.uiScale === 1.5)
}
export function isWebURL(value: string): boolean {
  if (value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return false
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname } catch { return false }
}
