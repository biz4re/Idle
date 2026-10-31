import { ipcRenderer } from 'electron'

// Runs in an isolated world; no browser API is exposed to the page.
window.addEventListener('click', (event) => {
  if (!event.isTrusted || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return
  const link = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement && node.hasAttribute('href'))
  if (!link || link.hasAttribute('download') || (link.target && link.target.toLowerCase() !== '_self') || link.hasAttribute('ping') || link.relList.contains('external') || link.closest('[contenteditable="true"]')) return
  const url = link.href
  if (!/^https?:/i.test(url)) return
  // Capture the accepted click before website handlers can also navigate the source.
  try {
    if (ipcRenderer.sendSync('idle:peek-link', { url, alt: event.altKey }) === true) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  } catch { /* leave normal navigation intact */ }
}, true)
