import type { Api, AppConfig, TreeNode, VaultEvent } from '@shared/types'
import { indexNote } from '@shared/indexNote'

/**
 * In-memory stand-in for the Electron preload API so the renderer can be
 * opened in a plain browser (`pnpm dev` then visit the renderer URL).
 * Only used when `window.api` is missing.
 */
export function installMockApi() {
  const files = new Map<string, { content: string; mtime: number }>()
  const dirs = new Set<string>(['Daily Notes', 'Projects', 'Projects/CLI Tool', 'Templates'])
  const listeners = new Set<(e: VaultEvent) => void>()
  const blobs = new Map<string, boolean>()
  let config: AppConfig = { vaultPath: '/mock/Notes', theme: 'dark', accent: 'orange', fontSize: 16, autosave: true }

  const seed = (path: string, content: string) => files.set(path, { content, mtime: Date.now() })
  seed(
    'Home.md',
    `# Home\n\nWelcome to the **mock** vault. Inline math $E = mc^2$ and a [link](https://example.com).\n\nSee [[Architecture]] and [[Architecture|the CLI design]], or a new [[Reading list]].\n\n- [ ] Try the *slash* menu with \`/\`\n- [x] Done item\n\n> A quote\n\n---\n\n\`\`\`ts\nconst x: number = 1\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\n  A --> B\n\`\`\`\n`,
  )
  seed(
    'Daily Notes/Monday, April 28, 2026.md',
    '---\ntags: [daily, work]\nmood: 7\n---\n# Monday, April 28, 2026\n\n## Tasks\n\n- [ ] Review PR for #auth module\n- [x] Standup\n- [ ] Read chapter 5 of [[DDIA]]\n',
  )
  seed('Templates/Daily.md', '# {{title}}\n\n## Morning Pages\n\n## Tasks\n\n- [ ] \n\n## Notes\n')
  seed(
    'Templates/Meeting.md',
    '# Meeting {{date}}\n\n**Attendees:**\n\n## Agenda\n\n## Notes\n\n## Action items\n\n- [ ] \n',
  )
  seed('Projects/CLI Tool/Architecture.md', '# Architecture\n\nPlugin system.\n')

  const emit = (e: VaultEvent) => listeners.forEach((l) => l(e))

  const tree = (): TreeNode[] => {
    const root: TreeNode[] = []
    const dirNodes = new Map<string, TreeNode>()
    const ensureDir = (path: string): TreeNode[] => {
      if (!path) return root
      let node = dirNodes.get(path)
      if (!node) {
        const parent = ensureDir(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
        node = { name: path.slice(path.lastIndexOf('/') + 1), path, type: 'dir', mtime: 0, children: [] }
        dirNodes.set(path, node)
        parent.push(node)
      }
      return node.children!
    }
    for (const d of [...dirs].sort()) ensureDir(d)
    for (const [path, f] of files) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      ensureDir(dir).push({
        name: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
        path,
        type: 'file',
        mtime: f.mtime,
      })
    }
    const sort = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)))
      nodes.forEach((n) => n.children && sort(n.children))
    }
    sort(root)
    return root
  }

  const api: Api = {
    config: {
      get: async () => config,
      set: async (patch) => (config = { ...config, ...patch }),
    },
    vault: {
      pickFolder: async () => '/mock/Other',
      tree: async () => tree(),
      read: async (rel) => {
        const f = files.get(rel)
        if (!f) throw new Error('ENOENT ' + rel)
        return f
      },
      write: async (rel, content) => {
        const mtime = Date.now()
        files.set(rel, { content, mtime })
        return { mtime }
      },
      create: async (rel, content = '') => {
        if (!rel.endsWith('.md')) rel += '.md'
        let candidate = rel
        for (let i = 1; files.has(candidate); i++) candidate = rel.replace(/\.md$/, ` ${i}.md`)
        files.set(candidate, { content, mtime: Date.now() })
        emit({ type: 'add', path: candidate })
        return candidate
      },
      mkdir: async (rel) => {
        dirs.add(rel)
        emit({ type: 'addDir', path: rel })
        return rel
      },
      rename: async (from, to) => {
        const f = files.get(from)
        if (f) {
          if (!to.endsWith('.md')) to += '.md'
          files.delete(from)
          files.set(to, f)
        } else if (dirs.has(from)) {
          dirs.delete(from)
          dirs.add(to)
          for (const [k, v] of [...files]) {
            if (k.startsWith(from + '/')) {
              files.delete(k)
              files.set(to + k.slice(from.length), v)
            }
          }
        }
        return to
      },
      delete: async (rel) => {
        files.delete(rel)
        dirs.delete(rel)
        for (const k of [...files.keys()]) if (k.startsWith(rel + '/')) files.delete(k)
        emit({ type: 'unlink', path: rel })
      },
      search: async (query) => {
        const q = query.toLowerCase()
        const hits = []
        for (const [path, f] of files) {
          const lines = f.content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) hits.push({ path, line: i + 1, preview: lines[i].trim() })
          }
        }
        return hits
      },
      exists: async (rel) => files.has(rel) || dirs.has(rel),
      scan: async () =>
        [...files].map(([path, f]) => ({
          ...indexNote(f.content),
          path,
          name: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
          mtime: f.mtime,
        })),
      writeBinary: async (rel) => {
        blobs.set(rel, true)
        return rel
      },
      replace: async (find, replacement, paths, matchCase) => {
        const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
        let n = 0
        let count = 0
        for (const [path, f] of files) {
          if (paths.length && !paths.includes(path)) continue
          const c = f.content.match(re)?.length ?? 0
          if (!c) continue
          files.set(path, { content: f.content.replace(re, () => replacement), mtime: Date.now() })
          n++
          count += c
          emit({ type: 'change', path })
        }
        return { files: n, replacements: count }
      },
      onChanged: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    },
    shell: {
      openExternal: async (url) => void window.open(url, '_blank'),
      showInFolder: async () => {},
    },
    export: { file: async () => null },
    window: { minimize() {}, maximize() {}, close() {} },
    platform: 'win32',
  }
  ;(window as unknown as { api: Api }).api = api
}
