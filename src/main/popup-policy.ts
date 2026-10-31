import { isWebURL } from './security.ts'

export type PopupRoute = 'tab' | 'window' | 'external' | 'deny'

export function popupRoute(url: string, disposition: string, hasPostBody: boolean): PopupRoute {
  if (!isWebURL(url) && url !== 'about:blank') return 'external'
  // Preserve opener-dependent scripts, blank windows and form POST bodies.
  if (url === 'about:blank' || hasPostBody || disposition === 'default' || disposition === 'new-window' || disposition === 'other') return 'window'
  return disposition === 'foreground-tab' || disposition === 'background-tab' ? 'tab' : 'deny'
}
