// One short-lived guard per accepted click, scoped to the source tab and exact URL.
export class PeekNavigationGuard {
  private pending = new Map<string, { url: string; expires: number }>()
  arm(tabId: string, url: string, now = Date.now()): void { this.pending.set(tabId, { url, expires: now + 1500 }) }
  consume(tabId: string, url: string, now = Date.now()): boolean {
    const pending = this.pending.get(tabId)
    if (!pending) return false
    if (now > pending.expires) { this.pending.delete(tabId); return false }
    if (pending.url !== url) return false
    this.pending.delete(tabId)
    return true
  }
  clear(tabId: string): void { this.pending.delete(tabId) }
}
