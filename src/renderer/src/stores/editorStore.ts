import { create } from 'zustand'
import { computeStats, type DocStats } from '@/lib/stats'
import { scheduleIndexRefresh } from './indexStore'

export interface OpenDoc {
  path: string
  content: string
  /** content as last written to / read from disk */
  saved: string
  mtime: number
  loading: boolean
  error?: string
}

interface EditorState {
  docs: Record<string, OpenDoc>
  stats: DocStats
  load: (path: string, force?: boolean) => Promise<OpenDoc | null>
  setContent: (path: string, content: string) => void
  save: (path: string) => Promise<void>
  saveAll: () => Promise<void>
  unload: (path: string) => void
  rename: (from: string, to: string) => void
  setStats: (text: string) => void
  isDirty: (path: string) => boolean
  /** mtime seen on disk by our own write, used to ignore watcher echoes */
  ownWrites: Record<string, number>
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useEditorStore = create<EditorState>((set, get) => ({
  docs: {},
  stats: { words: 0, characters: 0, paragraphs: 0, minutes: 0 },
  ownWrites: {},
  load: async (path, force = false) => {
    const existing = get().docs[path]
    if (existing && !force) return existing
    set((s) => ({
      docs: {
        ...s.docs,
        [path]: existing ?? { path, content: '', saved: '', mtime: 0, loading: true },
      },
    }))
    try {
      const file = await window.api.vault.read(path)
      const doc: OpenDoc = { path, content: file.content, saved: file.content, mtime: file.mtime, loading: false }
      set((s) => ({ docs: { ...s.docs, [path]: doc } }))
      return doc
    } catch (e) {
      const doc: OpenDoc = { path, content: '', saved: '', mtime: 0, loading: false, error: String(e) }
      set((s) => ({ docs: { ...s.docs, [path]: doc } }))
      return null
    }
  },
  setContent: (path, content) => {
    const doc = get().docs[path]
    if (!doc || doc.content === content) return
    set((s) => ({ docs: { ...s.docs, [path]: { ...doc, content } } }))
  },
  save: async (path) => {
    const doc = get().docs[path]
    if (!doc || doc.loading || doc.content === doc.saved) return
    const content = doc.content
    const { mtime } = await window.api.vault.write(path, content)
    scheduleIndexRefresh()
    set((s) => {
      const current = s.docs[path]
      if (!current) return {}
      return {
        docs: { ...s.docs, [path]: { ...current, saved: content, mtime } },
        ownWrites: { ...s.ownWrites, [path]: mtime },
      }
    })
  },
  saveAll: async () => {
    const { docs, save } = get()
    await Promise.all(Object.keys(docs).map((p) => save(p)))
  },
  unload: (path) => {
    const timer = saveTimers.get(path)
    if (timer) clearTimeout(timer)
    saveTimers.delete(path)
    set((s) => {
      const docs = { ...s.docs }
      delete docs[path]
      return { docs }
    })
  },
  rename: (from, to) => {
    set((s) => {
      const docs: Record<string, OpenDoc> = {}
      for (const [k, v] of Object.entries(s.docs)) {
        const nk = k === from ? to : k.startsWith(from + '/') ? to + k.slice(from.length) : k
        docs[nk] = { ...v, path: nk }
      }
      return { docs }
    })
  },
  setStats: (text) => set({ stats: computeStats(text) }),
  isDirty: (path) => {
    const doc = get().docs[path]
    return !!doc && doc.content !== doc.saved
  },
}))

/** Debounced autosave used by the editor's update listener. */
export function scheduleSave(path: string, delay = 500) {
  const existing = saveTimers.get(path)
  if (existing) clearTimeout(existing)
  saveTimers.set(
    path,
    setTimeout(() => {
      saveTimers.delete(path)
      void useEditorStore.getState().save(path)
    }, delay),
  )
}

export function flushSave(path: string) {
  const existing = saveTimers.get(path)
  if (existing) clearTimeout(existing)
  saveTimers.delete(path)
  return useEditorStore.getState().save(path)
}
