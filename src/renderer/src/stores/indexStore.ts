import { create } from 'zustand'
import type { NoteIndex } from '@shared/types'

interface IndexState {
  notes: NoteIndex[]
  byPath: Record<string, NoteIndex>
  /** tag → note paths */
  tags: Record<string, string[]>
  loading: boolean
  refresh: () => Promise<void>
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useIndexStore = create<IndexState>((set) => ({
  notes: [],
  byPath: {},
  tags: {},
  loading: false,
  refresh: async () => {
    set({ loading: true })
    const notes = await window.api.vault.scan()
    const byPath: Record<string, NoteIndex> = {}
    const tags: Record<string, string[]> = {}
    for (const n of notes) {
      byPath[n.path] = n
      for (const t of n.tags) (tags[t] ??= []).push(n.path)
    }
    set({ notes, byPath, tags, loading: false })
  },
}))

/** Debounced refresh, used after saves and watcher events. */
export function scheduleIndexRefresh(delay = 400) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void useIndexStore.getState().refresh()
  }, delay)
}
