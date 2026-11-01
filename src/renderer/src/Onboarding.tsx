import { useState } from 'react'
import idleIcon from '../../../resources/icon.png'
import { AppearanceControls } from './AppearanceControls'
import { useUIStore } from './store'

export function Onboarding({ finish }: { finish: () => void }) {
  const [personalise, setPersonalise] = useState(false)
  return <main className="onboarding" aria-label="Welcome to Idle"><div className="onboarding-inner">
    {!personalise ? <><img className="onboarding-ghost" src={idleIcon} alt="" /><h1>Make yourself at home.</h1><p>A quieter place to explore the web.</p><button className="onboarding-primary" autoFocus onClick={() => setPersonalise(true)}>Get started</button></> : <><h1>Make Idle yours.</h1><p>Choose a look you like. You can change it anytime in Settings.</p><div className="settings-section"><AppearanceControls /></div><div className="onboarding-actions"><button onClick={() => { const ui = useUIStore.getState(); ui.setAppearance('system'); ui.setBrowserTint('default'); finish() }}>Skip</button><button className="onboarding-primary" autoFocus onClick={finish}>Start browsing</button></div></>}
  </div></main>
}
