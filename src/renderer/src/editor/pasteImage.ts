import { EditorView } from '@codemirror/view'
import { toast } from 'sonner'
import { livePreviewConfig } from './livePreview'

const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

function imageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return []
  return [...dt.files].filter((f) => f.type.startsWith('image/'))
}

/**
 * Save pasted / dropped images into `<note folder>/attachments/` and insert a
 * markdown image link at the cursor.
 */
async function saveImages(view: EditorView, files: File[], pos: number) {
  const { notePath } = view.state.facet(livePreviewConfig)
  if (!notePath) return
  const dir = dirname(notePath)
  const inserts: string[] = []
  for (const file of files) {
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const base = file.name && file.name !== 'image.png' ? file.name.replace(/\.[^.]+$/, '') : `pasted-${stamp}`
    const rel = `${dir ? dir + '/' : ''}attachments/${base}.${ext}`
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const saved = await window.api.vault.writeBinary(rel, data)
      // path relative to the note folder
      const relToNote = dir ? saved.slice(dir.length + 1) : saved
      inserts.push(`![${base}](${encodeURI(relToNote)})`)
    } catch (e) {
      toast.error(`Could not save image: ${String(e)}`)
    }
  }
  if (inserts.length === 0) return
  const text = inserts.join('\n')
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: 'input.paste',
  })
}

export const pasteImages = EditorView.domEventHandlers({
  paste(event, view) {
    const files = imageFiles(event.clipboardData)
    if (files.length === 0) return false
    event.preventDefault()
    void saveImages(view, files, view.state.selection.main.head)
    return true
  },
  drop(event, view) {
    const files = imageFiles(event.dataTransfer)
    if (files.length === 0) return false
    event.preventDefault()
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
    void saveImages(view, files, pos)
    return true
  },
})
