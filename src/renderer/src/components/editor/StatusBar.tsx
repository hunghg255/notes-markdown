import { useEditorStore } from '@/stores/editorStore'

export function StatusBar({ path }: { path: string }) {
  const stats = useEditorStore((s) => s.stats)
  const dirty = useEditorStore((s) => {
    const d = s.docs[path]
    return !!d && d.content !== d.saved
  })
  return (
    <div className="text-muted-foreground pointer-events-none absolute right-6 bottom-3 flex items-center gap-4 text-xs">
      {dirty && <span className="text-primary">unsaved</span>}
      <span>
        <span className="text-foreground/80">{stats.words}</span> words
      </span>
      <span>
        <span className="text-foreground/80">{stats.characters}</span> characters
      </span>
      <span>
        <span className="text-foreground/80">{stats.paragraphs}</span> paragraphs
      </span>
    </div>
  )
}
