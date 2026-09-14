import { EditorView } from '@codemirror/view'
import { create } from 'zustand'

interface OutlineState {
  /** 1-based line of the main cursor in the live editor */
  cursorLine: number
}

export const useOutlineStore = create<OutlineState>(() => ({ cursorLine: 1 }))

/** Keeps the cursor line in a store so the outline panel can highlight the current section. */
export const outlineTracker = EditorView.updateListener.of((update) => {
  if (!update.selectionSet && !update.docChanged && !update.focusChanged) return
  const line = update.state.doc.lineAt(update.state.selection.main.head).number
  if (useOutlineStore.getState().cursorLine !== line) useOutlineStore.setState({ cursorLine: line })
})
