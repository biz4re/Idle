import { Suspense, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EmojiPicker } from './WorkspaceEmojiPicker'
import type { TabCommand } from '../../shared/ipc'
import { interfaceRect, interfaceViewport } from '../../shared/interface-scale'
import { useUIStore } from './store'
import { workspacePopoverBounds, type WorkspacePopoverMode } from '../../shared/workspace-popover'

export type WorkspaceActionMode = WorkspacePopoverMode
export interface WorkspaceTarget { id: string; anchor: HTMLButtonElement; mode: WorkspaceActionMode }

export function WorkspaceActions({ target, name, index, count, setMode, close, command }: { target: WorkspaceTarget; name: string; index: number; count: number; setMode: (mode: WorkspaceActionMode) => void; close: (restoreFocus?: boolean) => void; command: (command: TabCommand) => void }) {
  const popup = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(name)
  const [position, setPosition] = useState({ left: 8, top: 8, width: 200, height: 0 })
  useLayoutEffect(() => { setValue(name) }, [target.id, name])
  useLayoutEffect(() => {
    const anchor = target.anchor
    anchor.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const place = () => {
      if (!anchor.isConnected) { close(); return }
      const rect = anchor.getBoundingClientRect(); const sidebar = anchor.closest('.sidebar')?.getBoundingClientRect()
      if (!sidebar) { close(); return }
      const scale = useUIStore.getState().interfaceScale
      setPosition(workspacePopoverBounds(interfaceRect(rect, scale), interfaceRect(sidebar, scale), { width: interfaceViewport(window.innerWidth, scale), height: interfaceViewport(window.innerHeight, scale) }, target.mode))
    }
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !popup.current?.contains(event.target) && !anchor.contains(event.target)) close() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) } }
    place(); const frame = requestAnimationFrame(() => popup.current?.querySelector<HTMLElement>('input, button:not(:disabled)')?.focus())
    document.addEventListener('pointerdown', dismiss, true); window.addEventListener('keydown', escape, true); window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [target.id, target.anchor, target.mode])
  const move = (direction: 'up' | 'down') => { command({ type: 'workspace-move', id: target.id, direction }); close(true) }
  const keyMenu = (event: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (!buttons.length) return
    event.preventDefault(); const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  return createPortal(<div ref={popup} className={`workspace-action-popover ${target.mode === 'emoji' ? 'workspace-emoji-popup' : ''}`} style={{ ...position, height: target.mode === 'emoji' ? position.height : undefined }} role={target.mode === 'menu' ? 'menu' : 'dialog'} aria-label={target.mode === 'menu' ? `Actions for ${name}` : target.mode === 'rename' ? 'Rename Workspace' : 'Choose Workspace emoji'}>
    {target.mode === 'menu' && <div onKeyDown={keyMenu}><button role="menuitem" onClick={() => setMode('rename')}>Rename</button><button role="menuitem" onClick={() => setMode('emoji')}>Change Emoji</button><button role="menuitem" disabled={index <= 0} onClick={() => move('up')}>Move left</button><button role="menuitem" disabled={index >= count - 1} onClick={() => move('down')}>Move right</button><button role="menuitem" disabled={count < 2} onClick={() => { command({ type: 'workspace-delete', id: target.id }); close() }}>Delete</button></div>}
    {target.mode === 'rename' && <form onSubmit={(event) => { event.preventDefault(); const trimmed = value.trim(); if (!trimmed) return; command({ type: 'workspace-rename', id: target.id, name: trimmed }); close(true) }}><label htmlFor="workspace-rename-input">Workspace name</label><input id="workspace-rename-input" maxLength={80} value={value} onChange={(event) => setValue(event.target.value)} /><button type="submit" disabled={!value.trim()}>Save</button></form>}
    {target.mode === 'emoji' && <Suspense fallback={<div className="workspace-emoji-loading">Loading emojis…</div>}><EmojiPicker width="100%" height="100%" theme="auto" emojiStyle="native" suggestedEmojisMode="recent" autoFocusSearch previewConfig={{ showPreview: false }} onEmojiClick={(selection) => { command({ type: 'workspace-emoji', id: target.id, emoji: selection.emoji }); close(true) }} /></Suspense>}
  </div>, document.body)
}
