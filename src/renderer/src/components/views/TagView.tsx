import { Badge } from '@/components/ui/badge'
import { openNote, openTagView } from '@/lib/actions'
import { useIndexStore } from '@/stores/indexStore'
import { dirname, noteTitle } from '@/stores/vaultStore'
import { ViewShell } from './ViewShell'

export function TagView({ tag }: { tag: string }) {
  const paths = useIndexStore((s) => s.tags[tag] ?? [])
  const byPath = useIndexStore((s) => s.byPath)
  const notes = paths.map((p) => byPath[p]).filter(Boolean)

  return (
    <ViewShell title={`#${tag}`} description={`${notes.length} note${notes.length === 1 ? '' : 's'}`}>
      <div className="flex flex-col gap-2">
        {notes.map((n) => (
          <button
            key={n.path}
            type="button"
            onClick={() => openNote(n.path)}
            className="border-border hover:bg-accent/50 flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">{noteTitle(n.path)}</span>
              {dirname(n.path) && <span className="text-muted-foreground text-xs">{dirname(n.path)}</span>}
            </div>
            {n.excerpt && <p className="text-muted-foreground line-clamp-2 text-sm">{n.excerpt}</p>}
            <div className="flex flex-wrap gap-1 pt-1">
              {n.tags.map((t) => (
                <Badge
                  key={t}
                  variant={t === tag ? 'default' : 'secondary'}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    openTagView(t)
                  }}
                >
                  #{t}
                </Badge>
              ))}
            </div>
          </button>
        ))}
      </div>
    </ViewShell>
  )
}
