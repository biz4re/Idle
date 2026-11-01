import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { INTERFACE_SCALES, interfaceScale, interfaceViewport, interfaceRect } from '../src/shared/interface-scale.ts'
import { isViewBounds } from '../src/main/security.ts'

test('interface scale and view geometry remain bounded and independent', () => {
  assert.deepEqual(INTERFACE_SCALES, [1, 1.25, 1.5])
  assert.equal(interfaceScale(99), 1)
  assert.equal(interfaceScale('1.25'), 1.25)
  assert.equal(interfaceViewport(900, 1.5), 600)
  assert.deepEqual(interfaceRect({ left: 30, right: 180, top: 60, bottom: 120, width: 150 }, 1.5), { left: 20, right: 120, top: 40, bottom: 80, width: 100 })
  assert.equal(isViewBounds({ x: 10, y: 20, width: 500, height: 300, uiScale: 1.5 }), true)
  assert.equal(isViewBounds({ x: 10, y: 20, width: 500, height: 300, uiScale: 5 }), false)
  assert.equal(isViewBounds({ x: 10, y: 20, width: 500, height: 300 }), true)
})
test('landing secondary text meets contrast on its current dark surfaces', () => {
  const css = readFileSync(new URL('../website/src/styles/global.css', import.meta.url), 'utf8')
  const value = (selector, property) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matches = [...css.matchAll(new RegExp(`${escaped}\\{[^}]*?${property}:\\s*(#[0-9a-f]{6})`, 'gi'))]
    return matches.at(-1)?.[1]
  }
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  for (const [textSelector, backgroundSelector] of [['.hero-copy>p', '.hero'], ['.intro p', '.intro'], ['.feature-copy p', '.feature-sage'], ['.feature-copy p', '.feature-cream'], ['.feature-copy p', '.feature-lavender'], ['.closing p', '.closing']]) {
    const foreground = value(textSelector, 'color'); const background = value(backgroundSelector, 'background')
    assert.ok(foreground && background, `${textSelector} on ${backgroundSelector}`)
    assert.ok((luminance(foreground) + 0.05) / (luminance(background) + 0.05) >= 4.5, `${textSelector} on ${backgroundSelector}`)
  }
})
