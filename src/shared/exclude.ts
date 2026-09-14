/**
 * VS Code `files.exclude`-style matching for vault entries.
 *
 * - `*` / `?` never cross a `/`; `**` matches any depth; `{a,b}` is alternation.
 * - A pattern without `/` matches the entry name at any depth (`node_modules`, `*.draft.md`).
 * - A pattern with `/` matches the whole vault-relative path (`Archive/**`, `Projects/Old`).
 * - Matching is case-insensitive, like the `.md` extension check in the vault walker.
 */

export type ExcludeMatcher = (rel: string, name: string) => boolean

const NOTE_EXT = /\.(md|markdown)$/i

function normalise(pattern: string): string {
  return pattern
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '')
    .replace(/\/+$/, '')
}

function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else if (i === glob.length - 1 && glob[i - 2] === '/') {
          // trailing `/**` — already emitted the `/`, allow matching the dir itself
          re = re.slice(0, -1) + '(?:/.*)?'
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') re += '[^/]'
    else if (c === '{') re += '(?:'
    else if (c === '}') re += ')'
    else if (c === ',') re += '|'
    else if (c === '/') re += '/'
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

export function compileExcludes(patterns: string[] | undefined): ExcludeMatcher {
  const byName: RegExp[] = []
  const byPath: RegExp[] = []
  for (const raw of patterns ?? []) {
    const p = normalise(raw)
    if (!p) continue
    try {
      ;(p.includes('/') ? byPath : byName).push(globToRegExp(p))
    } catch {
      // malformed pattern: skip rather than break the whole tree
    }
  }
  if (byName.length === 0 && byPath.length === 0) return () => false

  return (rel, name) => {
    if (byName.length) {
      const segments = rel.split('/')
      const candidates = [...segments, name]
      if (NOTE_EXT.test(name)) candidates.push(name.replace(NOTE_EXT, ''))
      for (const re of byName) if (candidates.some((s) => re.test(s))) return true
    }
    for (const re of byPath) {
      if (re.test(rel)) return true
      if (NOTE_EXT.test(rel) && re.test(rel.replace(NOTE_EXT, ''))) return true
    }
    return false
  }
}
