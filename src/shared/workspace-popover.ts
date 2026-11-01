export type WorkspacePopoverMode = 'menu' | 'rename' | 'emoji'
type Rect = { left: number; right: number; top: number; bottom: number; width: number }

export function workspacePopoverBounds(anchor: Rect, sidebar: Rect, viewport: { width: number; height: number }, mode: WorkspacePopoverMode) {
  const width = Math.max(1, Math.min(mode === 'emoji' ? 280 : 220, sidebar.width - 16, viewport.width - 16))
  const height = Math.max(1, Math.min(mode === 'emoji' ? 340 : mode === 'menu' ? 188 : 82, viewport.height - 16))
  const left = Math.max(8, Math.min(anchor.left, sidebar.right - width - 8, viewport.width - width - 8))
  const top = anchor.bottom + 6 + height <= viewport.height - 8 ? anchor.bottom + 6 : Math.max(8, anchor.top - height - 6)
  return { left, top, width, height }
}
