import { BROWSER_TINTS, useUIStore } from './store'

export function AppearanceControls() {
  const { appearance, setAppearance, browserTint, setBrowserTint } = useUIStore()
  return <><fieldset className="appearance-modes"><legend>Appearance</legend><div>{(['system', 'light', 'dark'] as const).map((mode) => <label key={mode}><input type="radio" name="appearance" checked={appearance === mode} onChange={() => setAppearance(mode)} />{mode.charAt(0).toUpperCase() + mode.slice(1)}</label>)}</div></fieldset><fieldset className="tint-selector"><legend>Browser tint</legend><div className="tint-options">{BROWSER_TINTS.map((tint) => <label key={tint} className="tint-option"><input type="radio" name="browser-tint" value={tint} checked={browserTint === tint} onChange={() => setBrowserTint(tint)} /><span className="tint-swatch" data-tint={tint} aria-hidden="true" /><span>{tint.charAt(0).toUpperCase() + tint.slice(1)}</span></label>)}</div></fieldset></>
}
