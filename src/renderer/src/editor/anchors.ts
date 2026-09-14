import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * Heading the editor should jump to once a note is shown. Set by link
 * handlers, consumed by MarkdownEditor after the state for that path is active.
 */
let pending: { path: string; heading: string } | null = null

export function setPendingAnchor(path: string, heading: string) {
  pending = { path, heading }
}

export function takePendingAnchor(path: string): string | null {
  if (!pending || pending.path !== path) return null
  const h = pending.heading
  pending = null
  return h
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_~[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Find the first line whose heading text matches `heading` (case/format-insensitive). */
export function findHeadingLine(
  doc: { lines: number; line(n: number): { text: string; from: number } },
  heading: string,
) {
  const want = norm(heading)
  if (!want) return null
  let fallback: number | null = null
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line.text)
    if (!m) continue
    const text = norm(m[1])
    if (text === want) return line.from
    if (fallback === null && (text.startsWith(want) || text.includes(want))) fallback = line.from
  }
  return fallback
}

/** Move the cursor to the heading and scroll it to the top of the viewport. */
export function scrollToHeading(view: EditorView, heading: string): boolean {
  const pos = findHeadingLine(view.state.doc, heading)
  if (pos === null) return false
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }),
  })
  view.focus()
  return true
}
