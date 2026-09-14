import { create } from 'zustand'

export const SETTINGS_TAB = 'settings'

export interface Tab {
  /** note path, or SETTINGS_TAB */
  id: string
}

interface TabsState {
  tabs: Tab[]
  activeId: string | null
  history: string[]
  historyIndex: number
  open: (id: string, opts?: { replace?: boolean }) => void
  close: (id: string) => void
  closeAll: () => void
  setActive: (id: string) => void
  back: () => void
  forward: () => void
  next: () => void
  prev: () => void
  /** keep tabs in sync when a note is renamed / moved on disk */
  renamePath: (from: string, to: string) => void
}

const TABS_KEY = 'notes.tabs'

function loadPersisted(): Pick<TabsState, 'tabs' | 'activeId'> {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.tabs)) return { tabs: parsed.tabs, activeId: parsed.activeId ?? null }
    }
  } catch {
    /* ignore */
  }
  return { tabs: [], activeId: null }
}

function persist(state: Pick<TabsState, 'tabs' | 'activeId'>) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: state.tabs, activeId: state.activeId }))
  } catch {
    /* ignore */
  }
}

function pushHistory(state: TabsState, id: string) {
  const history = state.history.slice(0, state.historyIndex + 1)
  if (history[history.length - 1] !== id) history.push(id)
  return { history, historyIndex: history.length - 1 }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  ...loadPersisted(),
  history: [],
  historyIndex: -1,
  open: (id, opts) => {
    const state = get()
    let tabs = state.tabs
    if (!tabs.some((t) => t.id === id)) {
      if (opts?.replace && state.activeId && state.activeId !== SETTINGS_TAB) {
        tabs = tabs.map((t) => (t.id === state.activeId ? { id } : t))
      } else {
        const idx = state.activeId ? tabs.findIndex((t) => t.id === state.activeId) : -1
        tabs = [...tabs.slice(0, idx + 1), { id }, ...tabs.slice(idx + 1)]
      }
    }
    const next = { tabs, activeId: id, ...pushHistory(state, id) }
    persist(next)
    set(next)
  },
  close: (id) => {
    const state = get()
    const idx = state.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const tabs = state.tabs.filter((t) => t.id !== id)
    let activeId = state.activeId
    if (activeId === id) {
      const neighbour = tabs[idx] ?? tabs[idx - 1]
      activeId = neighbour?.id ?? null
    }
    const history = state.history.filter((h) => h !== id)
    const next = {
      tabs,
      activeId,
      history,
      historyIndex: Math.min(state.historyIndex, history.length - 1),
    }
    persist(next)
    set(next)
  },
  closeAll: () => {
    const next = { tabs: [], activeId: null, history: [], historyIndex: -1 }
    persist(next)
    set(next)
  },
  setActive: (id) => {
    const state = get()
    if (!state.tabs.some((t) => t.id === id)) return
    const next = { activeId: id, ...pushHistory(state, id) }
    persist({ tabs: state.tabs, activeId: id })
    set(next)
  },
  back: () => {
    const state = get()
    if (state.historyIndex <= 0) return
    const historyIndex = state.historyIndex - 1
    const id = state.history[historyIndex]
    const tabs = state.tabs.some((t) => t.id === id) ? state.tabs : [...state.tabs, { id }]
    persist({ tabs, activeId: id })
    set({ historyIndex, activeId: id, tabs })
  },
  forward: () => {
    const state = get()
    if (state.historyIndex >= state.history.length - 1) return
    const historyIndex = state.historyIndex + 1
    const id = state.history[historyIndex]
    const tabs = state.tabs.some((t) => t.id === id) ? state.tabs : [...state.tabs, { id }]
    persist({ tabs, activeId: id })
    set({ historyIndex, activeId: id, tabs })
  },
  next: () => {
    const { tabs, activeId, setActive } = get()
    if (tabs.length < 2) return
    const idx = tabs.findIndex((t) => t.id === activeId)
    setActive(tabs[(idx + 1) % tabs.length].id)
  },
  prev: () => {
    const { tabs, activeId, setActive } = get()
    if (tabs.length < 2) return
    const idx = tabs.findIndex((t) => t.id === activeId)
    setActive(tabs[(idx - 1 + tabs.length) % tabs.length].id)
  },
  renamePath: (from, to) => {
    const state = get()
    const map = (id: string) => (id === from ? to : id.startsWith(from + '/') ? to + id.slice(from.length) : id)
    const next = {
      tabs: state.tabs.map((t) => ({ id: map(t.id) })),
      activeId: state.activeId ? map(state.activeId) : null,
      history: state.history.map(map),
    }
    persist(next)
    set(next)
  },
}))
