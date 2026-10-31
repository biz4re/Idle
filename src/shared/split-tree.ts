export type SplitTree = { type: 'leaf'; tabId: string } | { type: 'split'; orientation: 'horizontal' | 'vertical'; ratio: number; first: SplitTree; second: SplitTree }

export function splitTabIds(tree: SplitTree): string[] {
  return tree.type === 'leaf' ? [tree.tabId] : [...splitTabIds(tree.first), ...splitTabIds(tree.second)]
}

/** Validate persisted data without trusting its structure, IDs, ratios, or depth. */
export function restoreSplitTree(value: unknown, allowed: ReadonlySet<string>): SplitTree | null {
  const seen = new Set<string>()
  function visit(node: unknown, depth: number): SplitTree | null {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 4) return null
    const entry = node as Record<string, unknown>
    if (entry.type === 'leaf') {
      if (typeof entry.tabId !== 'string' || !allowed.has(entry.tabId) || seen.has(entry.tabId) || seen.size >= 4) return null
      seen.add(entry.tabId)
      return { type: 'leaf', tabId: entry.tabId }
    }
    if (entry.type !== 'split' || (entry.orientation !== 'horizontal' && entry.orientation !== 'vertical') || typeof entry.ratio !== 'number' || !Number.isFinite(entry.ratio) || entry.ratio < 0.1 || entry.ratio > 0.9) return null
    const first = visit(entry.first, depth + 1)
    const second = visit(entry.second, depth + 1)
    if (!first) return second
    if (!second) return first
    return { type: 'split', orientation: entry.orientation, ratio: entry.ratio, first, second }
  }
  return visit(value, 0)
}

export function removeSplitTab(tree: SplitTree | null, tabId: string): SplitTree | null {
  if (!tree) return null
  if (tree.type === 'leaf') return tree.tabId === tabId ? null : tree
  const first = removeSplitTab(tree.first, tabId)
  const second = removeSplitTab(tree.second, tabId)
  return first && second ? { ...tree, first, second } : first ?? second
}

export function splitPane(tree: SplitTree, targetId: string, newId: string, orientation: 'horizontal' | 'vertical', before = false): SplitTree | null {
  const ids = splitTabIds(tree)
  if (ids.length >= 4 || ids.includes(newId) || !ids.includes(targetId)) return null
  function visit(node: SplitTree): SplitTree {
    if (node.type === 'leaf') return node.tabId === targetId ? { type: 'split', orientation, ratio: 0.5, first: before ? { type: 'leaf', tabId: newId } : node, second: before ? node : { type: 'leaf', tabId: newId } } : node
    return { ...node, first: visit(node.first), second: visit(node.second) }
  }
  return visit(tree)
}
