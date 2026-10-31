import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { UpdateService } from '../src/main/update-service.ts'
import { verifyUpdateSignature } from '../src/main/update-signature.ts'

class FakeUpdater extends EventEmitter {
  calls = 0
  installs = 0
  checkForUpdates() { this.calls++; this.emit('checking-for-update'); return Promise.resolve(null) }
  quitAndInstall() { this.installs++ }
}

test('updater checks once, downloads and keeps a dismissed update ready', async () => {
  const updater = new FakeUpdater(); const states = []
  const service = new UpdateService(updater, true, '1.0.0', (state) => states.push(state))
  assert.equal(updater.autoInstallOnAppQuit, false)
  await Promise.all([service.check(), service.check()])
  assert.equal(updater.calls, 1)
  updater.emit('update-available', { version: '1.1.0' })
  await service.check(); assert.equal(updater.calls, 1)
  updater.emit('update-downloaded', { version: '1.1.0' })
  service.dismiss(); await service.check()
  assert.equal(updater.calls, 1)
  assert.deepEqual(service.getState(), { status: 'ready', version: '1.0.0', updateVersion: '1.1.0', dismissed: true })
  assert.equal(states.filter((state) => state.status === 'ready' && !state.dismissed).length, 1)
  let saved = false
  await service.install(async () => { saved = true })
  assert.equal(saved, true); assert.equal(updater.installs, 1)
})

test('disabled builds do not check, and preview builds stay on their channel without downgrades', async () => {
  const updater = new FakeUpdater()
  const service = new UpdateService(updater, false, '1.2.0-developer-preview.1', () => {})
  service.start(); await service.check()
  assert.equal(updater.calls, 0); assert.equal(updater.allowPrerelease, true)
  assert.equal(updater.channel, 'developer-preview'); assert.equal(updater.allowDowngrade, false)
  service.stop()
})

test('errors are retryable and a failed save cannot install', async () => {
  const updater = new FakeUpdater(); const service = new UpdateService(updater, true, '1.0.0', () => {})
  updater.checkForUpdates = async () => { throw new Error('offline') }
  await service.check(); assert.equal(service.getState().status, 'error')
  updater.emit('update-downloaded', { version: '1.1.0' })
  await service.install(async () => { throw new Error('disk full') })
  assert.equal(updater.installs, 0); assert.equal(service.getState().status, 'save-error')
  await service.install(async () => {})
  assert.equal(updater.installs, 1)
})

test('a background download rejection changes state without an unhandled rejection', async () => {
  const updater = new FakeUpdater(); const service = new UpdateService(updater, true, '1.0.0', () => {})
  let rejectDownload
  updater.checkForUpdates = async () => { updater.emit('update-available', { version: '1.1.0' }); return { downloadPromise: new Promise((_, reject) => { rejectDownload = reject }) } }
  await service.check()
  rejectDownload(new Error('offline'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(service.getState().status, 'error')
})

test('signature verification rejects a missing or mismatched publisher', async () => {
  assert.ok(await verifyUpdateSignature([], process.execPath))
  if (process.platform === 'win32') assert.ok(await verifyUpdateSignature(['Idle test publisher that does not exist'], process.execPath))
})
