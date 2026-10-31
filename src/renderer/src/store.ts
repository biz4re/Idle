import { create } from 'zustand'
import { interfaceScale, interfaceViewport } from '../../shared/interface-scale'

export const MIN_SIDEBAR_WIDTH = 200
export const MAX_SIDEBAR_WIDTH = 400
export function clampSidebarWidth(width: number, viewportWidth: number): number {
  const max = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - 320))
  return Math.min(max, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}
function savedSidebarWidth(): number {
  try {
    const value = Number(localStorage.getItem('idle.sidebarWidth'))
    return Number.isFinite(value) && value >= MIN_SIDEBAR_WIDTH && value <= MAX_SIDEBAR_WIDTH ? value : 232
  } catch { return 232 }
}
interface UIState {
  interfaceScale: number
  setInterfaceScale: (scale: number) => void
  sidebarOpen: boolean
  sidebarWidth: number
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  saveSidebarWidth: () => void
}
export const useUIStore = create<UIState>((set, get) => ({
  interfaceScale: (() => { try { return interfaceScale(localStorage.getItem('idle.interfaceScale')) } catch { return 1 } })(),
  setInterfaceScale: (value) => { const scale = interfaceScale(value); try { localStorage.setItem('idle.interfaceScale', String(scale)) } catch { /* storage may be unavailable */ } set({ interfaceScale: scale }) },
  sidebarOpen: true,
  sidebarWidth: savedSidebarWidth(),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width, interfaceViewport(window.innerWidth, get().interfaceScale)) }),
  saveSidebarWidth: () => { const width = get().sidebarWidth; try { localStorage.setItem('idle.sidebarWidth', String(width)) } catch { /* storage may be unavailable */ } window.idle.tabCommand({ type: 'sidebar-width', width }) },
}))
