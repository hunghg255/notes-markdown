import { EditorView } from '@codemirror/view'
import { useUiStore } from '@/stores/uiStore'

/** In focus mode keep the cursor line vertically centred (typewriter scrolling). */
export const typewriterScroll = EditorView.updateListener.of((update) => {
  if (!useUiStore.getState().focusMode) return
  if (!update.selectionSet && !update.docChanged) return
  const head = update.state.selection.main.head
  // dispatching inside an update is not allowed; defer to the next frame
  requestAnimationFrame(() => {
    if (update.view.state.selection.main.head !== head) return
    update.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
  })
})
