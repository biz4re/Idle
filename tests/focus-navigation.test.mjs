import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canRestorePane, nextFocusTarget } from '../src/shared/focus-navigation.ts'
import { browserShortcut } from '../src/main/shortcuts.ts'
import { isTabCommand } from '../src/main/security.ts'

test('focus traversal stays within the visible panes and reaches chrome in both directions', () => {
  const panes = ['first', 'second', 'third']
  assert.equal(nextFocusTarget(panes, null, 'second', false), 'second')
  assert.equal(nextFocusTarget(panes, 'second', 'second', false), 'third')
  assert.equal(nextFocusTarget(panes, 'third', 'third', false), null)
  assert.equal(nextFocusTarget(panes, null, 'second', true), 'third')
  assert.equal(nextFocusTarget(panes, 'first', 'first', true), null)
  assert.equal(nextFocusTarget(panes, 'inactive-profile-pane', 'first', false), null)
  assert.equal(nextFocusTarget([], null, null, false), null)
})
test('F6 focus commands preserve modifiers and validate page focus requests', () => {
  const input = { type: 'keyDown', key: 'F6', code: 'F6', meta: false, control: false, alt: false, shift: false, isAutoRepeat: false }
  for (const mac of [false, true]) {
    assert.equal(browserShortcut(input, mac), 'focus-next')
    assert.equal(browserShortcut({ ...input, shift: true }, mac), 'focus-previous')
    assert.equal(browserShortcut({ ...input, control: true }, mac), null)
    assert.equal(browserShortcut({ ...input, isComposing: true }, mac), null)
  }
  assert.equal(isTabCommand({ type: 'focus-page', id: 'active-pane' }), true)
  assert.equal(isTabCommand({ type: 'focus-page', id: '' }), false)
})

test('focus restoration cannot enter hidden panes, inactive profiles or settings', () => {
  assert.equal(canRestorePane('work', 'work', ['a', 'b'], 'b', false), true)
  assert.equal(canRestorePane('personal', 'work', ['a', 'b'], 'b', false), false)
  assert.equal(canRestorePane('work', 'work', ['a'], 'b', false), false)
  assert.equal(canRestorePane('work', 'work', ['b'], 'b', true), false)
})
