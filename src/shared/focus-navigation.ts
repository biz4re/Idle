// A focus cycle contains browser chrome followed by the visible page panes.
export function nextFocusTarget(panes: readonly string[], focusedPane: string | null, activePane: string | null, backwards: boolean): string | null {
  if (!panes.length) return null
  if (focusedPane === null) return backwards ? panes[panes.length - 1] ?? null : panes.includes(activePane ?? '') ? activePane : panes[0] ?? null
  const index = panes.indexOf(focusedPane)
  if (index < 0) return null
  return panes[index + (backwards ? -1 : 1)] ?? null
}

export function canRestorePane(profile: string, activeProfile: string, visiblePanes: readonly string[], pane: string, settingsOpen: boolean): boolean {
  return !settingsOpen && profile === activeProfile && visiblePanes.includes(pane)
}
