import type { EditorState } from '@codemirror/state'

/** Per-note editor states so switching tabs keeps undo history & cursor. */
const states = new Map<string, EditorState>()

export const editorStates = {
  get: (path: string) => states.get(path),
  set: (path: string, state: EditorState) => states.set(path, state),
  forget: (path: string) => states.delete(path),
  rename(from: string, to: string) {
    const s = states.get(from)
    if (s) {
      states.delete(from)
      states.set(to, s)
    }
  },
}

import type { EditorView } from '@codemirror/view'

/** The single live editor view (set by MarkdownEditor) so panels can dispatch edits. */
export const liveView: { current: EditorView | null } = { current: null }
