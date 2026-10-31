export type BrowserShortcut = 'address' | 'new-tab' | 'close-tab' | 'reopen' | 'reload' | 'find' | 'back' | 'forward' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'next-tab' | 'previous-tab' | 'dismiss' | 'sidebar' | 'saved-search' | 'downloads' | `tab-${number}`
export interface ShortcutInput { type: string; key: string; code: string; meta: boolean; control: boolean; alt: boolean; shift: boolean; isAutoRepeat: boolean }
export function browserShortcut(input: ShortcutInput, mac: boolean): BrowserShortcut | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.alt) return null
  const key = input.key.toLowerCase()
  if (key === 'escape' && !input.meta && !input.control && !input.shift) return 'dismiss'
  if (key === 'tab' && input.control && !input.meta) return input.shift ? 'previous-tab' : 'next-tab'
  if (!(mac ? input.meta && !input.control : input.control && !input.meta)) return null
  if (input.shift && (key === '[' || input.code === 'BracketLeft')) return 'previous-tab'
  if (input.shift && (key === ']' || input.code === 'BracketRight')) return 'next-tab'
  if (input.shift && key === 's') return 'sidebar'
  if (input.shift && key === 'f') return 'saved-search'
  if (input.shift && key === 't') return 'reopen'
  if (input.shift && (key === '+' || input.code === 'Equal')) return 'zoom-in'
  if (input.shift) return null
  if (/^[1-9]$/.test(key)) return `tab-${key}` as BrowserShortcut
  const keys: Record<string, BrowserShortcut> = { l: 'address', t: 'new-tab', w: 'close-tab', r: 'reload', f: 'find', '[': 'back', ']': 'forward', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset' }
  return keys[key] ?? null
}
