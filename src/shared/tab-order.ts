export interface OrderedTab { id: string; pinned: boolean }

// A tab can move only within its contiguous pinned or unpinned group.
export function reorderTabs<T extends OrderedTab>(tabs: readonly T[], id: string, targetId: string, placement: 'before' | 'after'): T[] | null {
  const from = tabs.findIndex((tab) => tab.id === id)
  const target = tabs.findIndex((tab) => tab.id === targetId)
  if (from < 0 || target < 0) return null
  const item = tabs[from]
  if (!item || tabs.slice(Math.min(from, target), Math.max(from, target) + 1).some((tab) => tab.pinned !== item.pinned)) return null
  const result = [...tabs]
  result.splice(from, 1)
  const targetIndex = result.findIndex((tab) => tab.id === targetId)
  if (targetIndex < 0) return null
  result.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, item)
  return result
}

export function groupPinnedTabs<T extends OrderedTab>(tabs: readonly T[]): T[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)]
}
