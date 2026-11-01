import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, Bookmark, ChevronDown, Folder, Globe2, MoreHorizontal, PanelLeft, X } from 'lucide-react'
import { ProfileSegment } from '../../../src/renderer/src/ProfileSegment'
import { AppearanceControls } from '../../../src/renderer/src/AppearanceControls'
import '../../../src/renderer/src/styles.css'
import './preview.css'

type Profile = 'Personal' | 'Work'
type Page = { id: string; title: string; domain: string; detail: string }
const pages: Record<Profile, Record<string, Page[]>> = {
  Personal: { Explore: [{ id: 'slow', title: 'A slower internet', domain: 'somewhere.good', detail: 'A little room to explore.' }, { id: 'ideas', title: 'Little ideas', domain: 'ideas.example', detail: 'Good things take time.' }, { id: 'weekend', title: 'Weekend reading', domain: 'journal.example', detail: 'A quiet corner of the web.' }], Inspiration: [{ id: 'notes', title: 'Field notes', domain: 'notes.example', detail: 'Keep the interesting things close.' }] },
  Work: { Projects: [{ id: 'project', title: 'Project notes', domain: 'work.example', detail: 'A space for focused work.' }, { id: 'research', title: 'Research', domain: 'research.example', detail: 'Keep your references in view.' }], Planning: [{ id: 'plans', title: 'Weekly planning', domain: 'planning.example', detail: 'Make space for what matters.' }] },
}
function Preview() {
  const mode = new URLSearchParams(location.search).get('mode') ?? 'tabs'
  const [profile, setProfile] = useState<Profile>('Personal')
  const [spaces, setSpaces] = useState<Record<Profile, string>>({ Personal: 'Explore', Work: 'Projects' })
  const [selected, setSelected] = useState<Record<Profile, Record<string, string>>>({ Personal: { Explore: 'slow', Inspiration: 'notes' }, Work: { Projects: 'project', Planning: 'plans' } })
  const [split, setSplit] = useState(mode === 'split')
  const [peek, setPeek] = useState(false)
  const [library, setLibrary] = useState(mode === 'later')
  const [saved, setSaved] = useState(false)
  const [group, setGroup] = useState(true)
  const [settings, setSettings] = useState(mode === 'appearance')
  const workspace = spaces[profile]; const available = pages[profile][workspace] ?? []
  const active = available.find((page) => page.id === selected[profile][workspace]) ?? available[0]
  const second = available.find((page) => page.id !== active?.id)
  const selectPage = (id: string) => setSelected((state) => ({ ...state, [profile]: { ...state[profile], [workspace]: id } }))
  return <div className="app-shell demo-app">
    <aside className="sidebar" aria-label="Preview sidebar"><div className="sidebar-titlebar"><div className="profile-quick-switch" role="radiogroup" aria-label="Switch preview Profile">{(['Personal', 'Work'] as const).map((item) => <ProfileSegment key={item} type="button" icon={item === 'Work' ? 'work' : 'personal'} role="radio" aria-checked={profile === item} onClick={() => { setProfile(item); setPeek(false) }}>{item}</ProfileSegment>)}</div><button className="icon-button" aria-label="Preview settings" onClick={() => setSettings(!settings)}><MoreHorizontal /></button></div>
      <div className="sidebar-scroll"><nav className="workspace-dock" aria-label="Preview Workspaces"><div className="workspace-dock-scroll">{Object.keys(pages[profile]).map((item, index) => <button key={item} className={`workspace-dock-item ${workspace === item ? 'active' : ''}`} aria-label={item} title={item} aria-current={workspace === item ? 'page' : undefined} onClick={() => { setSpaces((state) => ({ ...state, [profile]: item })); setPeek(false) }}>{index === 0 ? '🌿' : '✨'}</button>)}</div></nav><div className="sidebar-heading"><span className="sidebar-heading-name">{workspace}</span></div><div className="tab-list"><section className="tab-group-card" style={{ '--group-color': '#789b8e' } as React.CSSProperties}><div className="tab-group-heading"><button className="group-toggle" onClick={() => setGroup(!group)} aria-expanded={group}><Folder className="group-folder" /><span className="group-name">Open tabs</span><small>{available.length}</small><ChevronDown /></button></div>{group && <div className="group-tabs">{available.map((page) => <div key={page.id} className={`tab ${page.id === active?.id ? 'active' : ''}`}><button className="tab-select" aria-current={page.id === active?.id ? 'page' : undefined} onClick={() => { selectPage(page.id); setPeek(false) }}><Globe2 /><span className="tab-label">{page.title}</span></button></div>)}</div>}</section></div></div>
      {library && <section className="demo-library" aria-label="Preview Library"><strong>Library</strong><button className="icon-button" aria-label="Close Library" onClick={() => setLibrary(false)}><X /></button><p>Later</p><span>{saved ? active?.title : 'Saved pages appear here.'}</span></section>}<button className="library-trigger" onClick={() => setLibrary(!library)} aria-expanded={library}><Bookmark /><span>Library</span></button>
    </aside><div className="browser-pane"><header className="toolbar"><PanelLeft /><span className="window-title" /><button className="icon-button" title="Toggle split view" aria-label="Toggle split view" aria-pressed={split} onClick={() => setSplit(!split)}>◫</button><button className="icon-button" aria-label="Save to Later" aria-pressed={saved} onClick={() => { setSaved(!saved); setLibrary(true) }}><Bookmark /></button></header>
    {settings ? <main className="settings-page"><section className="settings-content"><div className="settings-content-inner"><div className="settings-heading-row"><div><h1>Appearance</h1><p>Choose a look for Idle.</p></div><button className="icon-button" onClick={() => setSettings(false)} aria-label="Close preview settings"><X /></button></div><div className="settings-section"><AppearanceControls /></div></div></section></main> : <div className={`canvas-frame ${split && second ? 'split-canvas' : ''}`}><div className="demo-pages">{[active, ...(split && second ? [second] : [])].filter((p): p is Page => !!p).map((page) => <section className="split-pane-frame demo-page" key={page.id}><div className="pane-toolbar"><button className="icon-button" disabled aria-label="Back"><ArrowLeft /></button><button className="icon-button" disabled aria-label="Forward"><ArrowRight /></button><div className="pane-breadcrumbs"><span className="breadcrumb-workspace">{workspace} &nbsp; ›</span><span className="pane-host"><Globe2 /> {page.domain}</span></div><button className="icon-button" onClick={() => setPeek(true)} aria-label="Open link preview"><MoreHorizontal /></button></div><div className="demo-page-content"><small>YOUR SPACE TO WANDER</small><h2>{page.detail}</h2><p>This is an interactive preview of Idle. Try switching tabs, Workspaces or Profiles.</p><button onClick={() => setPeek(true)}>Preview a link ↗</button></div></section>)}</div>{peek && <div className="demo-peek-overlay"><section className="demo-peek" role="dialog" aria-label="Peek preview"><button className="icon-button" onClick={() => setPeek(false)} aria-label="Close Peek"><X /></button><small>PEEK</small><h2>A little look around.</h2><p>Preview a link without leaving your tab.</p><button onClick={() => setPeek(false)}>Done</button></section></div>}</div>}
    </div><span className="demo-label">Interactive preview · changes stay here</span>
  </div>
}
createRoot(document.getElementById('preview-root')!).render(<Preview />)
