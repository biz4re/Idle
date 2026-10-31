import type { UpdateState } from '../shared/ipc'

export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  channel: string | null
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

// All state lives in the main process so reloading a window or switching profiles
// cannot trigger a second download or another notification.
export class UpdateService {
  private state: UpdateState
  private checking = false
  private installing = false
  private dismissed = false
  private startupTimer?: ReturnType<typeof setTimeout>
  private interval?: ReturnType<typeof setInterval>
  private updater: Updater
  private notify: (state: UpdateState) => void
  constructor(updater: Updater, enabled: boolean, version: string, notify: (state: UpdateState) => void) {
    this.updater = updater; this.notify = notify
    this.state = { status: enabled ? 'idle' : 'disabled', version, updateVersion: null, dismissed: false }
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = false
    updater.allowDowngrade = false
    const preview = /-developer-preview(?:\.|$)/.test(version)
    updater.allowPrerelease = preview
    if (preview) { updater.channel = 'developer-preview'; updater.allowDowngrade = false }
    updater.on('checking-for-update', () => this.set('checking'))
    updater.on('update-available', (info: { version: string }) => this.set('downloading', info.version))
    updater.on('update-not-available', () => this.set('current'))
    updater.on('update-downloaded', (info: { version: string }) => { if (this.state.status === 'ready' && this.state.updateVersion === info.version) return; this.dismissed = false; this.set('ready', info.version) })
    updater.on('error', (error: unknown) => { console.error('Update error:', error); if (this.installing) { this.installing = false; this.set('error') } else if (this.state.status !== 'ready') this.set('error') })
  }
  getState(): UpdateState { return { ...this.state, dismissed: this.dismissed } }
  private set(status: UpdateState['status'], updateVersion: string | null = null): void {
    this.state = { ...this.state, status, updateVersion, dismissed: this.dismissed }; this.notify(this.getState())
  }
  start(): void {
    if (this.state.status === 'disabled' || this.startupTimer) return
    this.startupTimer = setTimeout(() => { void this.check() }, 15_000)
    this.interval = setInterval(() => { void this.check() }, 6 * 60 * 60 * 1000)
  }
  stop(): void { if (this.startupTimer) clearTimeout(this.startupTimer); if (this.interval) clearInterval(this.interval) }
  async check(): Promise<UpdateState> {
    if (this.checking || ['disabled', 'downloading', 'ready', 'save-error'].includes(this.state.status)) return this.getState()
    this.checking = true
    try {
      const result = await this.updater.checkForUpdates()
      void result?.downloadPromise?.catch((error: unknown) => { console.error('Update download failed:', error); if (this.state.status !== 'error' && this.state.status !== 'ready') this.set('error') })
    } catch (error) { console.error('Update check failed:', error); if (this.state.status !== 'error') this.set('error') } finally { this.checking = false }
    return this.getState()
  }
  dismiss(): void { if (this.state.status === 'ready') { this.dismissed = true; this.notify(this.getState()) } }
  async install(save: () => Promise<void>): Promise<void> {
    if (this.installing || (this.state.status !== 'ready' && this.state.status !== 'save-error')) return
    this.installing = true
    try { await save(); this.updater.quitAndInstall(false, true) } catch (error) { this.installing = false; console.error('Unable to save before update:', error); this.set('save-error', this.state.updateVersion) }
  }
}
