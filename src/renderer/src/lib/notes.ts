import { dirname } from '@/stores/vaultStore'

export const DAILY_DIR = 'Daily Notes'
export const TEMPLATES_DIR = 'Templates'

export function dailyNoteTitle(date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function dailyNotePath(date = new Date()): string {
  return `${DAILY_DIR}/${dailyNoteTitle(date)}.md`
}

/** Normalise `a/b/../c` style paths (vault-relative, forward slashes). */
export function normalizePath(p: string): string {
  const parts: string[] = []
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

export function resolveRelative(fromNote: string, target: string): string {
  if (target.startsWith('/')) return normalizePath(target)
  return normalizePath(`${dirname(fromNote)}/${target}`)
}

export const isExternalUrl = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href)

export function resolveImageSrc(src: string, notePath: string): string {
  if (isExternalUrl(src)) return src
  const rel = resolveRelative(notePath, decodeURI(src))
  return `vault://local/${rel.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Resolve a `[[wiki link]]` target to a note path. Matches by note title
 * (case-insensitive) or by vault-relative path; prefers notes in the same
 * folder as `fromNote`. Returns null when no note matches.
 */
export function resolveWikiTarget(
  target: string,
  fromNote: string,
  notes: { name: string; path: string }[],
): string | null {
  const [rawName] = target.split('#')
  const name = rawName.trim().replace(/\.md$/i, '')
  if (!name) return null
  const lower = name.toLowerCase()
  const exactPath = notes.find((n) => n.path.replace(/\.md$/i, '').toLowerCase() === lower)
  if (exactPath) return exactPath.path
  const byName = notes.filter((n) => n.name.toLowerCase() === lower)
  if (byName.length === 0) return null
  const dir = dirname(fromNote)
  return (byName.find((n) => dirname(n.path) === dir) ?? byName[0]).path
}
