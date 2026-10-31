export interface PeekRect { x: number; y: number; width: number; height: number }

export function peekBounds(area: PeekRect): { toolbar: PeekRect; page: PeekRect } {
  const margin = Math.min(24, Math.floor(Math.min(area.width, area.height) / 8))
  const height = Math.max(0, area.height - margin * 2)
  const available = Math.max(0, area.width - margin * 2)
  const controls = Math.min(40, height)
  return {
    toolbar: { x: area.x + margin, y: area.y + margin, width: Math.min(76, available), height: controls },
    page: { x: area.x + margin, y: area.y + margin + controls, width: available, height: height - controls },
  }
}
