import { create } from 'zustand'
import type { TreeNode } from '@shared/types'

interface VaultState {
  tree: TreeNode[]
  /** flat list of note paths, derived from tree */
  notes: TreeNode[]
  expanded: Record<string, boolean>
  /** folder used as target for "new note" (relative path, '' = root) */
  selectedDir: string
  loading: boolean
  refresh: () => Promise<void>
  toggleDir: (path: string) => void
  expandTo: (notePath: string) => void
  setSelectedDir: (dir: string) => void
  createNote: (dir: string, name?: string, content?: string) => Promise<string>
  createFolder: (dir: string, name?: string) => Promise<string>
  rename: (from: string, to: string) => Promise<string>
  remove: (path: string) => Promise<void>
}

function flatten(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n)
    else if (n.children) flatten(n.children, out)
  }
  return out
}

const EXPANDED_KEY = 'notes.expanded'

function loadExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function persistExpanded(expanded: Record<string, boolean>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded))
  } catch {
    /* ignore */
  }
}

export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
export const noteTitle = (p: string) => basename(p).replace(/\.(md|markdown)$/i, '')

export const useVaultStore = create<VaultState>((set, get) => ({
  tree: [],
  notes: [],
  expanded: loadExpanded(),
  selectedDir: '',
  loading: true,
  refresh: async () => {
    const tree = await window.api.vault.tree()
    set({ tree, notes: flatten(tree), loading: false })
  },
  toggleDir: (path) => {
    const expanded = { ...get().expanded, [path]: !get().expanded[path] }
    persistExpanded(expanded)
    set({ expanded })
  },
  expandTo: (notePath) => {
    const expanded = { ...get().expanded }
    const parts = notePath.split('/')
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = joinPath(acc, parts[i])
      expanded[acc] = true
    }
    persistExpanded(expanded)
    set({ expanded })
  },
  setSelectedDir: (dir) => set({ selectedDir: dir }),
  createNote: async (dir, name = 'Untitled', content = '') => {
    const path = await window.api.vault.create(joinPath(dir, name), content)
    await get().refresh()
    get().expandTo(path)
    return path
  },
  createFolder: async (dir, name = 'New Folder') => {
    const path = await window.api.vault.mkdir(joinPath(dir, name))
    await get().refresh()
    get().expandTo(`${path}/x`)
    return path
  },
  rename: async (from, to) => {
    const result = await window.api.vault.rename(from, to)
    await get().refresh()
    return result
  },
  remove: async (path) => {
    await window.api.vault.delete(path)
    await get().refresh()
  },
}))
