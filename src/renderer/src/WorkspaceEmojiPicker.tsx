import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { interfaceRect, interfaceViewport } from '../../shared/interface-scale'
import { useUIStore } from './store'

export const EmojiPicker = lazy(() => import('emoji-picker-react'))

export function WorkspaceEmojiPicker({ value, onChange }: { value: string; onChange: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8, width: 200, height: 320 })
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const place = () => {
      const button = trigger.current?.getBoundingClientRect()
      const sidebar = trigger.current?.closest('.sidebar')?.getBoundingClientRect()
      if (!button || !sidebar) return
      const scale = useUIStore.getState().interfaceScale; const anchor = interfaceRect(button, scale); const area = interfaceRect(sidebar, scale)
      const viewportWidth = interfaceViewport(window.innerWidth, scale); const viewportHeight = interfaceViewport(window.innerHeight, scale)
      const width = Math.min(280, area.width - 16, viewportWidth - 16)
      const height = Math.min(340, viewportHeight - 16)
      const left = Math.max(8, Math.min(area.left + 8, viewportWidth - width - 8))
      const top = anchor.bottom + 6 + height <= viewportHeight - 8 ? anchor.bottom + 6 : Math.max(8, anchor.top - height - 6)
      setPosition({ left, top, width, height })
    }
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    place(); document.addEventListener('pointerdown', dismiss, true); window.addEventListener('keydown', escape, true); window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])
  return <>
    <button ref={trigger} type="button" className="workspace-emoji-trigger" aria-label="Choose Workspace emoji" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>{value}</button>
    {open && createPortal(<div ref={popup} className="workspace-emoji-popup" style={position} role="dialog" aria-label="Choose Workspace emoji"><Suspense fallback={<div className="workspace-emoji-loading">Loading emojis…</div>}><EmojiPicker width="100%" height="100%" theme="auto" emojiStyle="native" suggestedEmojisMode="recent" autoFocusSearch previewConfig={{ showPreview: false }} onEmojiClick={(selection) => { onChange(selection.emoji); setOpen(false); trigger.current?.focus() }} /></Suspense></div>, document.body)}
  </>
}
