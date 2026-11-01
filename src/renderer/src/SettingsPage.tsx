import { useEffect, useRef } from 'react'
import { CircleHelp, Keyboard, LayoutGrid, Palette, Settings2, Shield, X } from 'lucide-react'
import { shortcutAccelerator, type BrowserShortcut } from '../../main/shortcuts'
import { INTERFACE_SCALES } from '../../shared/interface-scale'
import { useUIStore } from './store'
import { AppearanceControls } from './AppearanceControls'
import type { BrowserState, UpdateState } from '../../shared/ipc'

export type SettingsCategory = 'general' | 'appearance' | 'spaces' | 'privacy' | 'shortcuts' | 'about'
const sections = [
  { id: 'general', label: 'General', icon: Settings2, description: 'Everyday preferences for Idle.' },
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'How Idle looks on your device.' },
  { id: 'spaces', label: 'Tabs & Spaces', icon: LayoutGrid, description: 'Choose how you explore links in your Spaces.' },
  { id: 'privacy', label: 'Privacy & Security', icon: Shield, description: 'Your browsing data and site permissions.' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard, description: 'Move around Idle from your keyboard.' },
  { id: 'about', label: 'About Idle', icon: CircleHelp, description: 'Version and update information.' },
] as const
const shortcuts: [string, BrowserShortcut][] = [['Settings', 'settings'], ['New tab', 'new-tab'], ['Close tab', 'close-tab'], ['Reopen closed tab', 'reopen'], ['Address bar', 'address'], ['Find in page', 'find'], ['Command menu', 'command-menu'], ['Toggle sidebar', 'sidebar'], ['Toggle split view', 'toggle-split'], ['Next focus area (chrome and panes)', 'focus-next'], ['Previous focus area (chrome and panes)', 'focus-previous'], ['Next Workspace', 'workspace-next'], ['Previous Workspace', 'workspace-previous']]

export function SettingsPage({ category, setCategory, close, browser, update }: { category: SettingsCategory; setCategory: (category: SettingsCategory) => void; close: () => void; browser: BrowserState; update: UpdateState }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const { interfaceScale, setInterfaceScale } = useUIStore()
  useEffect(() => { heading.current?.focus() }, [])
  const current = sections.find((item) => item.id === category) ?? sections[0]
  const mac = navigator.platform.toLowerCase().includes('mac')
  const updateText: Record<UpdateState['status'], string> = { disabled: 'Automatic updates are unavailable in this build.', idle: 'Updates have not been checked yet.', checking: 'Checking for updates…', downloading: 'Downloading update…', current: 'Idle is up to date.', ready: `Version ${update.updateVersion} is ready to install.`, error: 'Could not check or download an update. Please try again.', 'save-error': 'Could not save browsing state. Please try again.' }
  return <main className="settings-page" aria-label="Settings" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
    <nav className="settings-nav" aria-label="Settings categories"><div className="settings-nav-title">Settings</div>{sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" className="settings-nav-item" aria-current={category === id ? 'page' : undefined} onClick={() => setCategory(id)}><Icon size={16} aria-hidden="true" /><span>{label}</span></button>)}</nav>
    <section className="settings-content" aria-labelledby="settings-heading"><div className="settings-content-inner"><div className="settings-heading-row"><div><h1 ref={heading} tabIndex={-1} id="settings-heading">{current.label}</h1><p>{current.description}</p></div><button type="button" className="icon-button settings-close" aria-label="Close Settings" title="Close Settings" onClick={close}><X size={17} /></button></div>
      {category === 'general' && <p className="settings-empty">There are no general preferences to configure yet.</p>}
      {category === 'appearance' && <section className="settings-section"><AppearanceControls /><label htmlFor="interface-scale">Interface size</label><select id="interface-scale" value={interfaceScale} onChange={(event) => setInterfaceScale(Number(event.target.value))}>{INTERFACE_SCALES.map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}</select><p>Changes browser controls without changing webpage zoom.</p></section>}
      {category === 'privacy' && <p className="settings-empty">Site permissions are requested when a website needs access.</p>}
      {category === 'spaces' && <section className="settings-section"><h2>Peek</h2><p>Open a temporary preview of a link without leaving your tab.</p><fieldset><legend>Open Peek</legend><label><input type="radio" name="peek-mode" checked={browser.peekMode === 'automatic'} onChange={() => window.idle.tabCommand({ type: 'peek-mode', mode: 'automatic' })} /> Automatic</label><label><input type="radio" name="peek-mode" checked={browser.peekMode === 'manual'} onChange={() => window.idle.tabCommand({ type: 'peek-mode', mode: 'manual' })} /> Manual (Alt/Option-click)</label></fieldset></section>}
      {category === 'shortcuts' && <dl className="settings-shortcuts">{shortcuts.map(([label, action]) => { const key = shortcutAccelerator(action, mac); return key ? <div key={action}><dt>{label}</dt><dd><kbd>{key.replaceAll('CommandOrControl', mac ? '⌘' : 'Ctrl').replaceAll('Command', '⌘').replaceAll('Control', 'Ctrl')}</kbd></dd></div> : null })}</dl>}
      {category === 'about' && <section className="settings-section"><h2>Idle {update.version}</h2><p role="status">{updateText[update.status]}</p><div className="settings-actions"><button type="button" onClick={() => window.idle.tabCommand({ type: 'open-welcome', reuseEmpty: false })}>Welcome to Idle</button><button type="button" disabled={['disabled', 'checking', 'downloading', 'ready'].includes(update.status)} onClick={() => void window.idle.update('check')}>Check for updates</button>{(update.status === 'ready' || update.status === 'save-error') && <button type="button" onClick={() => void window.idle.update('install')}>Restart to update</button>}</div></section>}
    </div></section>
  </main>
}
