import { promises as fs } from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import type { NoteFile, NoteIndex, ReplaceResult, SearchHit, TreeNode } from '@shared/types'
import { indexNote } from '@shared/indexNote'

const WELCOME = `# Home

Welcome to your notes. Everything here is a plain \`.md\` file on disk.

## Getting started

- [ ] Press **Ctrl+P** to search or jump to any note
- [ ] Press **Ctrl+D** to open today's daily note
- [x] Notes are saved automatically

## Formatting

Inline math like $E = mc^2$, code blocks, and mermaid diagrams render in place:

\`\`\`mermaid
graph LR
  A[Write] --> B[Save]
  B --> C[Sync anywhere]
\`\`\`
`

export class Vault {
  constructor(public root: string) {}

  /** Ensure the vault folder exists with a minimal starter structure. */
  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    const entries = await fs.readdir(this.root)
    if (entries.length === 0) {
      await fs.mkdir(path.join(this.root, 'Daily Notes'), { recursive: true })
      await fs.mkdir(path.join(this.root, 'Templates'), { recursive: true })
      await fs.writeFile(path.join(this.root, 'Home.md'), WELCOME, 'utf8')
    }
  }

  /** Resolve a vault-relative path and refuse anything outside the root. */
  resolve(rel: string): string {
    const abs = path.resolve(this.root, rel)
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new Error(`Path escapes vault: ${rel}`)
    }
    return abs
  }

  toRel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/')
  }

  async tree(): Promise<TreeNode[]> {
    const walk = async (dir: string): Promise<TreeNode[]> => {
      const dirents = await fs.readdir(dir, { withFileTypes: true })
      const nodes: TreeNode[] = []
      for (const d of dirents) {
        if (d.name.startsWith('.')) continue
        // attachment folders hold images pasted into notes, not notes
        if (d.isDirectory() && d.name.toLowerCase() === 'attachments') continue
        const abs = path.join(dir, d.name)
        if (d.isDirectory()) {
          const stat = await fs.stat(abs)
          nodes.push({
            name: d.name,
            path: this.toRel(abs),
            type: 'dir',
            mtime: stat.mtimeMs,
            children: await walk(abs),
          })
        } else if (d.isFile() && /\.(md|markdown)$/i.test(d.name)) {
          const stat = await fs.stat(abs)
          nodes.push({
            name: d.name.replace(/\.(md|markdown)$/i, ''),
            path: this.toRel(abs),
            type: 'file',
            mtime: stat.mtimeMs,
          })
        }
      }
      return nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      })
    }
    return walk(this.root)
  }

  async read(rel: string): Promise<NoteFile> {
    const abs = this.resolve(rel)
    const [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
    return { content, mtime: stat.mtimeMs }
  }

  async write(rel: string, content: string): Promise<{ mtime: number }> {
    const abs = this.resolve(rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.${process.pid}.tmp`
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, abs)
    const stat = await fs.stat(abs)
    return { mtime: stat.mtimeMs }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(rel))
      return true
    } catch {
      return false
    }
  }

  /** Create a note; if the name is taken, append " 1", " 2", ... */
  async create(rel: string, content = ''): Promise<string> {
    if (!/\.md$/i.test(rel)) rel += '.md'
    const dir = path.posix.dirname(rel)
    const base = path.posix.basename(rel, '.md')
    let candidate = rel
    for (let i = 1; await this.exists(candidate); i++) {
      candidate = path.posix.join(dir, `${base} ${i}.md`)
    }
    await this.write(candidate, content)
    return candidate
  }

  async mkdir(rel: string): Promise<string> {
    let candidate = rel
    for (let i = 1; await this.exists(candidate); i++) candidate = `${rel} ${i}`
    await fs.mkdir(this.resolve(candidate), { recursive: true })
    return candidate
  }

  async rename(from: string, to: string): Promise<string> {
    const src = this.resolve(from)
    if (!/\.md$/i.test(to) && (await fs.stat(src)).isFile()) to += '.md'
    const dst = this.resolve(to)
    if (await this.exists(to)) throw new Error(`"${to}" already exists`)
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.rename(src, dst)
    return to
  }

  async delete(rel: string): Promise<void> {
    await shell.trashItem(this.resolve(rel))
  }

  async showInFolder(rel: string): Promise<void> {
    shell.showItemInFolder(this.resolve(rel))
  }

  async listNotes(): Promise<string[]> {
    const files: string[] = []
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file') files.push(n.path)
        else if (n.children) collect(n.children)
      }
    }
    collect(await this.tree())
    return files
  }

  /** Write a binary attachment (e.g. pasted image); returns the final relative path. */
  async writeBinary(rel: string, data: Uint8Array): Promise<string> {
    const dir = path.posix.dirname(rel)
    const ext = path.posix.extname(rel)
    const base = path.posix.basename(rel, ext)
    let candidate = rel
    for (let i = 1; await this.exists(candidate); i++) candidate = path.posix.join(dir, `${base}-${i}${ext}`)
    const abs = this.resolve(candidate)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, data)
    return candidate
  }

  /** Extract tags, links, tasks and headings from every note. */
  async scan(): Promise<NoteIndex[]> {
    const out: NoteIndex[] = []
    for (const rel of await this.listNotes()) {
      try {
        const abs = this.resolve(rel)
        const [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
        out.push({
          ...indexNote(content),
          path: rel,
          name: path.posix.basename(rel).replace(/\.md$/i, ''),
          mtime: stat.mtimeMs,
        })
      } catch {
        continue
      }
    }
    return out
  }

  async replace(find: string, replacement: string, paths: string[], matchCase: boolean): Promise<ReplaceResult> {
    if (!find) return { files: 0, replacements: 0 }
    const targets = paths.length ? paths : await this.listNotes()
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(escaped, matchCase ? 'g' : 'gi')
    let files = 0
    let replacements = 0
    for (const rel of targets) {
      const content = await fs.readFile(this.resolve(rel), 'utf8')
      const count = content.match(re)?.length ?? 0
      if (!count) continue
      await this.write(
        rel,
        content.replace(re, () => replacement),
      )
      files++
      replacements += count
    }
    return { files, replacements }
  }

  /** Naive full-text search; fine for personal vaults of a few thousand notes. */
  async search(query: string, limit = 500): Promise<SearchHit[]> {
    const q = query.toLowerCase()
    if (!q) return []
    const hits: SearchHit[] = []
    const files: string[] = []
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file') files.push(n.path)
        else if (n.children) collect(n.children)
      }
    }
    collect(await this.tree())
    for (const rel of files) {
      if (hits.length >= limit) break
      let content: string
      try {
        content = await fs.readFile(this.resolve(rel), 'utf8')
      } catch {
        continue
      }
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          hits.push({ path: rel, line: i + 1, preview: lines[i].trim().slice(0, 160) })
          if (hits.length >= limit) break
        }
      }
    }
    return hits
  }
}
