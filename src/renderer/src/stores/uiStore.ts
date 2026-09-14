import { create } from 'zustand'

interface UiState {
  sidebarOpen: boolean
  paletteOpen: boolean
  focusMode: boolean
  /** path currently being dragged in the sidebar tree, if any */
  dragging: string | null
  pinned: string[]
  recent: string[]
  /** collapsed state of sidebar sections */
  sections: Record<string, boolean>
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  toggleFocusMode: () => void
  openPalette: () => void
  setPaletteOpen: (open: boolean) => void
  setDragging: (path: string | null) => void
  togglePinned: (path: string) => void
  pushRecent: (path: string) => void
  renamePath: (from: string, to: string) => void
  forgetPath: (path: string) => void
  toggleSection: (id: string) => void
}

const KEY = 'notes.ui'

interface Persisted {
  sidebarOpen: boolean
  pinned: string[]
  recent: string[]
  sections: Record<string, boolean>
}

function load(): Persisted {
  const fallback: Persisted = { sidebarOpen: true, pinned: [], recent: [], sections: {} }
  try {
    const legacy = localStorage.getItem('notes.sidebarOpen')
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? { ...fallback, ...JSON.parse(raw) } : fallback
    if (legacy === 'false' && !raw) parsed.sidebarOpen = false
    return parsed
  } catch {
    return fallback
  }
}

function persist(state: UiState) {
  try {
    const data: Persisted = {
      sidebarOpen: state.sidebarOpen,
      pinned: state.pinned,
      recent: state.recent,
      sections: state.sections,
    }
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

const mapPath = (from: string, to: string) => (p: string) =>
  p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p

export const useUiStore = create<UiState>((set, get) => ({
  ...load(),
  paletteOpen: false,
  focusMode: false,
  dragging: null,
  toggleSidebar: () => get().setSidebarOpen(!get().sidebarOpen),
  setSidebarOpen: (open) => {
    set({ sidebarOpen: open })
    persist(get())
  },
  toggleFocusMode: () => set({ focusMode: !get().focusMode }),
  openPalette: () => set({ paletteOpen: true }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setDragging: (path) => set({ dragging: path }),
  togglePinned: (path) => {
    const pinned = get().pinned.includes(path) ? get().pinned.filter((p) => p !== path) : [...get().pinned, path]
    set({ pinned })
    persist(get())
  },
  pushRecent: (path) => {
    const recent = [path, ...get().recent.filter((p) => p !== path)].slice(0, 8)
    set({ recent })
    persist(get())
  },
  renamePath: (from, to) => {
    const m = mapPath(from, to)
    set({ pinned: get().pinned.map(m), recent: get().recent.map(m) })
    persist(get())
  },
  forgetPath: (path) => {
    const keep = (p: string) => p !== path && !p.startsWith(path + '/')
    set({ pinned: get().pinned.filter(keep), recent: get().recent.filter(keep) })
    persist(get())
  },
  toggleSection: (id) => {
    set({ sections: { ...get().sections, [id]: !get().sections[id] } })
    persist(get())
  },
}))
