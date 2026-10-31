import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserShortcut, shortcutRegistry, shortcutAccelerator } from '../src/main/shortcuts.ts'
const base = { type: 'keyDown', key: '', code: '', meta: false, control: false, alt: false, shift: false, isAutoRepeat: false }
test('registry has no overlapping bindings on either platform', () => {
  for (const mac of [false, true]) {
    const seen = new Set()
    for (const b of shortcutRegistry) {
      if (b.platforms && !b.platforms.includes(mac ? 'mac' : 'windows')) continue
      const mods = (b.modifiers ?? []).map(m => m === 'primary' ? (mac ? 'meta' : 'control') : m).sort()
      const signature = `${mods.join('+')}:${b.key}`
      assert.equal(seen.has(signature), false, `${mac ? 'mac' : 'windows'} ${signature}`)
      seen.add(signature)
      const input = { ...base, key: b.key, meta: mods.includes('meta'), control: mods.includes('control'), alt: mods.includes('alt'), shift: mods.includes('shift') }
      assert.equal(browserShortcut(input, mac), b.action)
    }
  }
})
test('platform-specific actions and native input remain distinct', () => {
  const key = (key, modifiers, mac = false) => browserShortcut({ ...base, key, ...modifiers }, mac)
  assert.equal(key('ArrowLeft', { alt: true }), 'back')
  assert.equal(key('[', { control: true }), null)
  assert.equal(key('[', { meta: true }, true), 'back')
  assert.equal(key('h', { control: true }), 'history')
  assert.equal(key('y', { meta: true }, true), 'history')
  assert.equal(key('c', { control: true }), null)
  assert.equal(key(',', { control: true }), 'settings')
  assert.equal(key(',', { meta: true }, true), 'settings')
  assert.equal(key('q', { meta: true }, true), null)
  assert.equal(key('t', { control: true, isComposing: true }), null)
  assert.equal(key('Process', { control: true }), null)
  assert.equal(shortcutAccelerator('back', false), 'Alt+Left')
})
