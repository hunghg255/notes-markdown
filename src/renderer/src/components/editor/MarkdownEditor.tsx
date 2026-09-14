import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Button } from '@/components/ui/button'
import { createEditorState } from '@/editor/setup'
import { editorStates, liveView } from '@/editor/stateCache'
import { scrollToHeading, takePendingAnchor } from '@/editor/anchors'
import { closeTab } from '@/lib/actions'
import { cn } from '@/lib/utils'
import { openLinkFromEditor } from '@/lib/actions'
import { resolveImageSrc } from '@/lib/notes'
import { scheduleSave, useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'

const previewOptions = (path: string) => ({
  notePath: path,
  openLink: openLinkFromEditor,
  resolveImage: resolveImageSrc,
})

interface Props {
  path: string
}

export function MarkdownEditor({ path }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const pathRef = useRef('')
  const doc = useEditorStore((s) => s.docs[path])
  const load = useEditorStore((s) => s.load)
  const fontSize = useSettingsStore((s) => s.config.fontSize)
  const autosave = useSettingsStore((s) => s.config.autosave)
  const autosaveRef = useRef(autosave)
  autosaveRef.current = autosave

  useEffect(() => {
    void load(path)
  }, [path, load])

  // create the view once
  useEffect(() => {
    const view = new EditorView({
      parent: container.current!,
      state: EditorState.create({ doc: '' }),
      dispatchTransactions: (trs, v) => {
        v.update(trs)
        const current = pathRef.current
        editorStates.set(current, v.state)
        if (trs.some((tr) => tr.docChanged)) {
          const text = v.state.doc.toString()
          const store = useEditorStore.getState()
          store.setContent(current, text)
          store.setStats(text)
          if (autosaveRef.current) scheduleSave(current)
        }
      },
    })
    viewRef.current = view
    liveView.current = view
    return () => {
      view.destroy()
      viewRef.current = null
      liveView.current = null
    }
  }, [])

  // swap state when the path or the loaded document changes
  const loaded = doc && !doc.loading
  useEffect(() => {
    const view = viewRef.current
    if (!view || !loaded) return
    const switched = pathRef.current !== path
    pathRef.current = path

    let state = editorStates.get(path)
    if (!state) {
      state = createEditorState(doc.content, previewOptions(path))
      editorStates.set(path, state)
    } else if (state.doc.toString() !== doc.content) {
      // reloaded from disk (external change): keep history but replace text
      state = state.update({ changes: { from: 0, to: state.doc.length, insert: doc.content } }).state
      editorStates.set(path, state)
    }
    if (view.state !== state) {
      view.setState(state)
      useEditorStore.getState().setStats(state.doc.toString())
    }
    if (switched) view.focus()
    const anchor = takePendingAnchor(path)
    if (anchor) requestAnimationFrame(() => scrollToHeading(view, anchor))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, loaded, doc?.content])

  // Ctrl+S saves immediately
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void useEditorStore.getState().save(pathRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {doc?.error && (
        <div className="text-muted-foreground absolute inset-x-0 top-24 z-10 flex flex-col items-center gap-3 text-sm">
          <p>This note could not be read from disk.</p>
          <p className="max-w-md truncate font-mono text-xs opacity-70">{doc.error}</p>
          <Button variant="outline" size="sm" onClick={() => void closeTab(path)}>
            Close tab
          </Button>
        </div>
      )}
      <div
        ref={container}
        className={cn(
          'h-full min-h-0 flex-1 overflow-hidden select-text [&_.cm-editor]:h-full',
          doc?.error && 'invisible',
        )}
        style={{ ['--editor-font-size' as string]: `${fontSize}px` }}
      />
    </>
  )
}
