import { getDomain } from 'tldts'

export function isCrossSiteLink(source: string, destination: string): boolean {
  try {
    const from = new URL(source); const to = new URL(destination)
    if (!['http:', 'https:'].includes(from.protocol) || !['http:', 'https:'].includes(to.protocol)) return false
    const fromSite = getDomain(from.hostname, { allowPrivateDomains: true })
    const toSite = getDomain(to.hostname, { allowPrivateDomains: true })
    return !!fromSite && !!toSite && fromSite !== toSite
  } catch { return false }
}

export function shouldPeekLink(mode: 'automatic' | 'manual', alt: boolean, source: string, destination: string): boolean {
  if (mode === 'automatic') return !alt && isCrossSiteLink(source, destination)
  if (!alt) return false
  try { return ['http:', 'https:'].includes(new URL(source).protocol) && ['http:', 'https:'].includes(new URL(destination).protocol) } catch { return false }
}
