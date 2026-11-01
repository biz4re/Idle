export type BrowserShortcut = 'focus-next' | 'focus-previous' | 'settings' | 'address' | 'new-tab' | 'close-tab' | 'reopen' | 'reload' | 'hard-reload' | 'find' | 'find-next' | 'find-previous' | 'back' | 'forward' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'next-tab' | 'previous-tab' | 'dismiss' | 'downloads' | 'history' | 'favourite' | 'print' | 'devtools' | 'profile-1' | 'profile-2' | 'workspace-next' | 'workspace-previous' | 'sidebar' | 'toggle-split' | 'save-later' | 'command-menu' | `tab-${number}`
export interface ShortcutInput { type: string; key: string; code: string; meta: boolean; control: boolean; alt: boolean; shift: boolean; isAutoRepeat: boolean; isComposing?: boolean }
type Platform = 'mac' | 'windows'
type Binding = { action: BrowserShortcut; key: string; modifiers?: readonly ('meta' | 'control' | 'alt' | 'shift' | 'primary')[]; platforms?: readonly Platform[]; accelerator?: string }
const common: Binding[] = [
  { action: 'settings', key: ',', accelerator: 'CommandOrControl+,' },
  { action: 'address', key: 'l', accelerator: 'CommandOrControl+L' }, { action: 'new-tab', key: 't', accelerator: 'CommandOrControl+T' },
  { action: 'close-tab', key: 'w', accelerator: 'CommandOrControl+W' }, { action: 'reopen', key: 't', modifiers: ['shift'], accelerator: 'CommandOrControl+Shift+T' },
  { action: 'reload', key: 'r', accelerator: 'CommandOrControl+R' }, { action: 'hard-reload', key: 'r', modifiers: ['shift'], accelerator: 'CommandOrControl+Shift+R' },
  { action: 'find', key: 'f', accelerator: 'CommandOrControl+F' }, { action: 'find-next', key: 'g', accelerator: 'CommandOrControl+G' }, { action: 'find-previous', key: 'g', modifiers: ['shift'], accelerator: 'CommandOrControl+Shift+G' },
  { action: 'profile-1', key: '1', modifiers: ['shift'], accelerator: 'CommandOrControl+Shift+1' }, { action: 'profile-2', key: '2', modifiers: ['shift'], accelerator: 'CommandOrControl+Shift+2' },
  { action: 'sidebar', key: '\\', accelerator: 'CommandOrControl+\\' }, { action: 'toggle-split', key: '\\', modifiers: ['shift'], accelerator: 'CommandOrControl+Shift+\\' },
  { action: 'save-later', key: 'l', modifiers: ['shift'], accelerator: 'CommandOrControl+Shift+L' }, { action: 'command-menu', key: 'k', accelerator: 'CommandOrControl+K' },
  { action: 'favourite', key: 'd', accelerator: 'CommandOrControl+D' }, { action: 'print', key: 'p', accelerator: 'CommandOrControl+P' },
  { action: 'zoom-in', key: '=', accelerator: 'CommandOrControl+=' }, { action: 'zoom-in', key: '+', modifiers: ['shift'] }, { action: 'zoom-out', key: '-', accelerator: 'CommandOrControl+-' }, { action: 'zoom-reset', key: '0', accelerator: 'CommandOrControl+0' },
  ...Array.from({ length: 9 }, (_, i): Binding => ({ action: `tab-${i + 1}`, key: String(i + 1), accelerator: `CommandOrControl+${i + 1}` })),
]
export const shortcutRegistry: readonly Binding[] = [
  ...common.map((binding) => ({ ...binding, modifiers: ['primary', ...(binding.modifiers ?? [])] as Binding['modifiers'] })),
  { action: 'focus-next', key: 'f6', accelerator: 'F6' }, { action: 'focus-previous', key: 'f6', modifiers: ['shift'], accelerator: 'Shift+F6' },
  { action: 'workspace-next', key: 'arrowright', modifiers: ['primary', 'alt'], accelerator: 'CommandOrControl+Alt+Right' }, { action: 'workspace-previous', key: 'arrowleft', modifiers: ['primary', 'alt'], accelerator: 'CommandOrControl+Alt+Left' },
  { action: 'downloads', key: 'l', modifiers: ['meta', 'alt'], platforms: ['mac'], accelerator: 'Command+Alt+L' },
  { action: 'next-tab', key: 'tab', modifiers: ['control'], accelerator: 'Control+Tab' }, { action: 'previous-tab', key: 'tab', modifiers: ['control', 'shift'], accelerator: 'Control+Shift+Tab' },
  { action: 'previous-tab', key: '[', modifiers: ['meta', 'shift'], platforms: ['mac'] }, { action: 'next-tab', key: ']', modifiers: ['meta', 'shift'], platforms: ['mac'] },
  { action: 'back', key: '[', modifiers: ['meta'], platforms: ['mac'], accelerator: 'Command+[' }, { action: 'forward', key: ']', modifiers: ['meta'], platforms: ['mac'], accelerator: 'Command+]' },
  { action: 'back', key: 'arrowleft', modifiers: ['alt'], platforms: ['windows'], accelerator: 'Alt+Left' }, { action: 'forward', key: 'arrowright', modifiers: ['alt'], platforms: ['windows'], accelerator: 'Alt+Right' },
  { action: 'address', key: 'd', modifiers: ['alt'], platforms: ['windows'] }, 
  { action: 'close-tab', key: 'f4', modifiers: ['control'], platforms: ['windows'] }, { action: 'reload', key: 'f5', platforms: ['windows'] }, { action: 'hard-reload', key: 'f5', modifiers: ['control'], platforms: ['windows'] }, { action: 'hard-reload', key: 'f5', modifiers: ['shift'], platforms: ['windows'] },
  { action: 'next-tab', key: 'pagedown', modifiers: ['control'], platforms: ['windows'] }, { action: 'previous-tab', key: 'pageup', modifiers: ['control'], platforms: ['windows'] },
  { action: 'history', key: 'h', modifiers: ['control'], platforms: ['windows'], accelerator: 'Ctrl+H' }, { action: 'history', key: 'y', modifiers: ['meta'], platforms: ['mac'], accelerator: 'Command+Y' },
  { action: 'downloads', key: 'j', modifiers: ['control'], platforms: ['windows'], accelerator: 'Ctrl+J' }, { action: 'downloads', key: 'j', modifiers: ['meta', 'shift'], platforms: ['mac'], accelerator: 'Command+Shift+J' },
  { action: 'devtools', key: 'i', modifiers: ['control', 'shift'], platforms: ['windows'], accelerator: 'Ctrl+Shift+I' }, { action: 'devtools', key: 'i', modifiers: ['meta', 'alt'], platforms: ['mac'], accelerator: 'Command+Alt+I' }, { action: 'devtools', key: 'f12', platforms: ['windows'] },
  { action: 'dismiss', key: 'escape' },
]
export function browserShortcut(input: ShortcutInput, mac: boolean): BrowserShortcut | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing || input.key === 'Process' || input.key === 'Dead') return null
  const platform: Platform = mac ? 'mac' : 'windows'
  const key = input.key.toLowerCase()
  return shortcutRegistry.find((binding) => {
    if (binding.platforms && !binding.platforms.includes(platform)) return false
    if (binding.key !== key && !(binding.key === '\\' && input.code === 'Backslash') && !((binding.action === 'profile-1' || binding.action === 'profile-2') && input.code === `Digit${binding.key}`) && !(binding.key === '+' && input.code === 'Equal' && input.shift) && !(input.shift && ((binding.key === '[' && input.code === 'BracketLeft') || (binding.key === ']' && input.code === 'BracketRight')))) return false
    const modifiers = binding.modifiers ?? []
    return (['meta', 'control', 'alt', 'shift'] as const).every((modifier) => input[modifier] === (modifiers.includes(modifier) || (modifiers as readonly string[]).includes('primary') && modifier === (mac ? 'meta' : 'control')))
  })?.action ?? null
}
export function shortcutAccelerator(action: BrowserShortcut, mac: boolean): string | undefined {
  return shortcutRegistry.find((binding) => binding.action === action && binding.accelerator && (!binding.platforms || binding.platforms.includes(mac ? 'mac' : 'windows')))?.accelerator
}
