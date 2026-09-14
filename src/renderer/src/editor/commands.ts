import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'

/** Wrap / unwrap each selection range with `mark` (e.g. `**`). */
function toggleInline(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const { from, to } = range
      const before = state.sliceDoc(Math.max(0, from - mark.length), from)
      const after = state.sliceDoc(to, to + mark.length)
      if (before === mark && after === mark) {
        // unwrap
        return {
          changes: [
            { from: from - mark.length, to: from, insert: '' },
            { from: to, to: to + mark.length, insert: '' },
          ],
          range: EditorSelection.range(from - mark.length, to - mark.length),
        }
      }
      const text = state.sliceDoc(from, to)
      if (text.startsWith(mark) && text.endsWith(mark) && text.length >= mark.length * 2) {
        const inner = text.slice(mark.length, text.length - mark.length)
        return {
          changes: { from, to, insert: inner },
          range: EditorSelection.range(from, from + inner.length),
        }
      }
      if (from === to) {
        // expand to the word under the cursor
        const line = state.doc.lineAt(from)
        let s = from
        let e = to
        while (s > line.from && /\w/.test(line.text[s - line.from - 1])) s--
        while (e < line.to && /\w/.test(line.text[e - line.from])) e++
        const word = state.sliceDoc(s, e)
        return {
          changes: { from: s, to: e, insert: `${mark}${word}${mark}` },
          range: EditorSelection.range(s + mark.length, e + mark.length),
        }
      }
      return {
        changes: { from, to, insert: `${mark}${text}${mark}` },
        range: EditorSelection.range(from + mark.length, to + mark.length),
      }
    })
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

export const toggleBold = toggleInline('**')
export const toggleItalic = toggleInline('_')
export const toggleStrike = toggleInline('~~')
export const toggleCode = toggleInline('`')

export const insertLink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const isUrl = /^https?:\/\//.test(text)
    const insert = isUrl ? `[](${text})` : `[${text}](url)`
    const cursorFrom = isUrl ? range.from + 1 : range.from + text.length + 3
    const cursorTo = isUrl ? cursorFrom : cursorFrom + 3
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(cursorFrom, cursorTo),
    }
  })
  dispatch(state.update(changes, { userEvent: 'input' }))
  return true
}

/** Toggle `- [ ]` / `- [x]` / plain line for every selected line. */
export const toggleTask: StateCommand = ({ state, dispatch }) => {
  const seen = new Set<number>()
  const changes: { from: number; to: number; insert: string }[] = []
  for (const range of state.selection.ranges) {
    for (let pos = range.from; ;) {
      const line = state.doc.lineAt(pos)
      if (!seen.has(line.number)) {
        seen.add(line.number)
        const m = /^(\s*)([-*+]|\d+[.)])?\s*(\[( |x|X)\]\s*)?/.exec(line.text)!
        const indent = m[1]
        const bullet = m[2] ?? '-'
        const hasTask = !!m[3]
        const checked = hasTask && /x/i.test(m[4]!)
        const rest = line.text.slice(m[0].length)
        let insert: string
        if (!hasTask) insert = `${indent}${bullet} [ ] ${rest}`
        else if (!checked) insert = `${indent}${bullet} [x] ${rest}`
        else insert = `${indent}${bullet} ${rest}`
        changes.push({ from: line.from, to: line.to, insert })
      }
      if (line.to >= range.to) break
      pos = line.to + 1
    }
  }
  dispatch(state.update({ changes, userEvent: 'input' }))
  return true
}

export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const line = state.doc.lineAt(state.selection.main.head)
    const stripped = line.text.replace(/^#{1,6}\s+/, '')
    const insert = level === 0 ? stripped : `${'#'.repeat(level)} ${stripped}`
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert },
        selection: EditorSelection.cursor(line.from + insert.length),
        userEvent: 'input',
      }),
    )
    return true
  }
}

export const formattingKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-e', run: toggleCode },
  { key: 'Mod-Shift-x', run: toggleStrike },
  { key: 'Mod-k', run: insertLink },
  { key: 'Mod-Enter', run: toggleTask },
  { key: 'Mod-l', run: toggleTask },
  // Ctrl+Alt+N so Ctrl+0 / Ctrl+= / Ctrl+- stay free for UI zoom
  { key: 'Mod-Alt-1', run: setHeading(1) },
  { key: 'Mod-Alt-2', run: setHeading(2) },
  { key: 'Mod-Alt-3', run: setHeading(3) },
  { key: 'Mod-Alt-4', run: setHeading(4) },
  { key: 'Mod-Alt-0', run: setHeading(0) },
]
