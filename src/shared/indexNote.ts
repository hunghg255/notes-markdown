import type { NoteIndex } from './types'

const TAG_RE = /(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu
const WIKI_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g
const MDLINK_RE = /\[[^\]]*\]\(([^)\s]+\.md)\)/gi
const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/

export function indexNote(content: string): Omit<NoteIndex, 'path' | 'name' | 'mtime'> {
  const tags = new Set<string>()
  const links = new Set<string>()
  const tasks: NoteIndex['tasks'] = []
  const headings: NoteIndex['headings'] = []
  let excerpt = ''
  let inFence = false
  let inFrontmatter = false
  let inTagList = false
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i === 0 && line === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (line === '---') inFrontmatter = false
      else if (inTagList && /^\s+-\s+/.test(line)) {
        // block list continuation:  - tag
        const t = line
          .replace(/^\s+-\s+/, '')
          .trim()
          .replace(/^['"]|['"]$/g, '')
        if (t) tags.add(t.replace(/^#/, ''))
      } else {
        inTagList = false
        // frontmatter `tags: [a, b]` / `tags: a, b` / `tags:` followed by a block list
        const m = /^tags:\s*(.*)$/.exec(line)
        if (m) {
          const inline = m[1].trim().replace(/^\[|\]$/g, '')
          if (inline)
            for (const t of inline.split(','))
              if (t.trim())
                tags.add(
                  t
                    .trim()
                    .replace(/^['"]|['"]$/g, '')
                    .replace(/^#/, ''),
                )
              else inTagList = true
        }
      }
      continue
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const h = HEADING_RE.exec(line)
    if (h) {
      headings.push({ level: h[1].length, text: h[2].trim(), line: i + 1 })
    } else if (!excerpt && line.trim() && !/^\s*[-*+>]|^\s*\d+[.)]/.test(line)) {
      excerpt = line.trim().slice(0, 160)
    }
    const t = TASK_RE.exec(line)
    if (t) tasks.push({ line: i + 1, text: t[2].trim(), done: t[1] !== ' ' })
    for (const m of line.matchAll(TAG_RE)) if (!/^\d+$/.test(m[2])) tags.add(m[2])
    for (const m of line.matchAll(WIKI_RE)) links.add(m[1].trim())
    for (const m of line.matchAll(MDLINK_RE)) links.add(decodeURI(m[1]).replace(/\.md$/i, ''))
  }
  return { tags: [...tags], links: [...links], tasks, headings, excerpt }
}
