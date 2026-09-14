import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { NoteTask } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { openNote } from '@/lib/actions'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editorStore'
import { useIndexStore } from '@/stores/indexStore'
import { noteTitle, dirname } from '@/stores/vaultStore'
import { ViewShell } from './ViewShell'

/** Flip `[ ]` ↔ `[x]` on one line of a note on disk (or in the open buffer). */
async function toggleTaskOnDisk(path: string, task: NoteTask) {
  const editor = useEditorStore.getState()
  const open = editor.docs[path]
  const content = open ? open.content : (await window.api.vault.read(path)).content
  const lines = content.split('\n')
  const line = lines[task.line - 1]
  if (line === undefined) return
  lines[task.line - 1] = task.done ? line.replace(/\[(x|X)\]/, '[ ]') : line.replace(/\[ \]/, '[x]')
  const next = lines.join('\n')
  if (open) {
    // keep the editor buffer in sync; it will autosave
    editor.setContent(path, next)
    await editor.save(path)
  } else {
    await window.api.vault.write(path, next)
  }
  await useIndexStore.getState().refresh()
}

/** Remove markdown inline syntax for display in lists. */
export function stripInline(text: string): string {
  return text
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, t: string, a?: string) => (a ?? t).trim())
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)/g, '$2')
    .replace(/(\*|_)(.*?)/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
}

export function TasksView() {
  const notes = useIndexStore((s) => s.notes)
  const [showDone, setShowDone] = useState(false)

  const groups = useMemo(() => {
    return notes
      .filter((n) => !n.path.startsWith('Templates/'))
      .map((n) => ({ note: n, tasks: n.tasks.filter((t) => t.text.trim() && (showDone || !t.done)) }))
      .filter((g) => g.tasks.length > 0)
      .sort((a, b) => b.note.mtime - a.note.mtime)
  }, [notes, showDone])

  const openCount = groups.reduce((acc, g) => acc + g.tasks.filter((t) => !t.done).length, 0)

  return (
    <ViewShell
      title="Tasks"
      description={`${openCount} open task${openCount === 1 ? '' : 's'} across ${groups.length} note${groups.length === 1 ? '' : 's'}`}
      actions={
        <Button variant="outline" size="sm" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Hide completed' : 'Show completed'}
        </Button>
      }
    >
      {groups.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing to do</EmptyTitle>
            <EmptyDescription>Add a task anywhere with `- [ ] …` and it shows up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {groups.map(({ note, tasks }) => (
        <section key={note.path} className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => openNote(note.path)}
            className="hover:text-link flex items-baseline gap-2 text-left text-sm font-semibold"
          >
            {noteTitle(note.path)}
            {dirname(note.path) && (
              <span className="text-muted-foreground text-xs font-normal">{dirname(note.path)}</span>
            )}
          </button>
          <ul className="flex flex-col">
            {tasks.map((task) => (
              <li key={task.line} className="group flex items-start gap-2 py-1 text-[15px]">
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => void toggleTaskOnDisk(note.path, task).catch((e) => toast.error(String(e)))}
                  className="task-checkbox mt-1"
                />
                <span className={cn('flex-1', task.done && 'text-muted-foreground line-through')}>
                  {stripInline(task.text)}
                </span>
                <span className="text-muted-foreground text-xs opacity-0 group-hover:opacity-100">L{task.line}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </ViewShell>
  )
}
