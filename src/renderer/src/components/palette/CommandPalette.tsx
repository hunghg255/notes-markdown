import { useEffect, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Calendar03Icon,
  File02Icon,
  FolderOpenIcon,
  NeuralNetworkIcon,
  NoteAddIcon,
  Search01Icon,
  SearchReplaceIcon,
  Settings01Icon,
  TaskDone01Icon,
  TextIcon,
} from '@hugeicons/core-free-icons'
import { Command as CommandPrimitive } from 'cmdk'
import type { SearchHit } from '@shared/types'
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import {
  createNote,
  openDailyNote,
  openGraphView,
  openNote,
  openSearchView,
  openSettings,
  openTasksView,
} from '@/lib/actions'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useVaultStore, dirname, noteTitle } from '@/stores/vaultStore'

const isMac = window.api.platform === 'darwin'
const mod = isMac ? '⌘' : 'Ctrl'

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen)
  const setOpen = useUiStore((s) => s.setPaletteOpen)
  const notes = useVaultStore((s) => s.notes)
  const update = useSettingsStore((s) => s.update)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
    }
  }, [open])

  // full-text search (debounced) once the query is long enough
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const result = await window.api.vault.search(query.trim())
      if (!cancelled) setHits(result)
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const run = (fn: () => unknown) => {
    setOpen(false)
    void fn()
  }

  const contentHits = useMemo(() => {
    // one hit per note, keep the first matching line
    const seen = new Set<string>()
    return hits.filter((h) => (seen.has(h.path) ? false : (seen.add(h.path), true))).slice(0, 20)
  }, [hits])

  const noteSet = useMemo(() => new Set(notes.map((n) => n.path)), [notes])
  const q = query.trim().toLowerCase()
  const noteMatches = useMemo(() => {
    if (!q) return notes.slice(0, 50)
    const score = (name: string, path: string) => {
      const n = name.toLowerCase()
      if (n === q) return 0
      if (n.startsWith(q)) return 1
      if (n.includes(q)) return 2
      if (path.toLowerCase().includes(q)) return 3
      return -1
    }
    return notes
      .map((n) => ({ n, s: score(n.name, n.path) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.n.name.localeCompare(b.n.name))
      .slice(0, 50)
      .map((x) => x.n)
  }, [notes, q])
  const actionMatches = (label: string) => !q || label.toLowerCase().includes(q)
  const canCreate = query.trim().length > 0 && !notes.some((n) => n.name.toLowerCase() === query.trim().toLowerCase())
  const nothing = noteMatches.length === 0 && contentHits.length === 0 && !canCreate

  // cmdk does not re-select the first item when we filter manually, so do it ourselves
  const firstValue = noteMatches[0]
    ? `${noteMatches[0].name} ${noteMatches[0].path}`
    : contentHits[0]
      ? `content:${contentHits[0].path}:${contentHits[0].line}`
      : canCreate
        ? `create:${query}`
        : 'action new note'
  const [selected, setSelected] = useState(firstValue)
  useEffect(() => setSelected(firstValue), [firstValue])

  const highlight = (text: string) => {
    if (!q) return text
    const idx = text.toLowerCase().indexOf(q)
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <span className="text-primary font-semibold">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    )
  }

  const item = 'h-10 px-3'

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search notes and run commands"
      className="sm:max-w-2xl"
    >
      <Command shouldFilter={false} value={selected} onValueChange={setSelected} className="rounded-2xl! p-0">
        <div className="border-border flex h-14 items-center gap-3 border-b px-4">
          <HugeiconsIcon icon={Search01Icon} size={20} strokeWidth={1.8} className="text-primary shrink-0" />
          <CommandPrimitive.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search notes, content, or run a command…"
            className="text-foreground placeholder:text-muted-foreground/70 h-full min-w-0 flex-1 bg-transparent text-base outline-none"
          />
          <kbd className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[11px]">esc</kbd>
        </div>
        <CommandList className="max-h-[420px] p-2">
          {nothing && (
            <div className="text-muted-foreground py-10 text-center text-sm">No notes or commands match “{query}”.</div>
          )}

          {noteMatches.length > 0 && (
            <CommandGroup heading="Notes">
              {noteMatches.map((n) => (
                <CommandItem
                  key={n.path}
                  value={`${n.name} ${n.path}`}
                  keywords={[n.name]}
                  onSelect={() => run(() => openNote(n.path))}
                  className={item}
                >
                  <HugeiconsIcon icon={File02Icon} strokeWidth={1.7} className="text-primary" />
                  <span className="text-foreground truncate text-[14.5px]">{highlight(n.name)}</span>
                  {dirname(n.path) && (
                    <span className="text-muted-foreground ml-auto truncate text-xs">{dirname(n.path)}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {contentHits.length > 0 && (
            <CommandGroup heading="In note content">
              {contentHits
                .filter((h) => noteSet.has(h.path))
                .map((h) => (
                  <CommandItem
                    key={`${h.path}:${h.line}`}
                    value={`content:${h.path}:${h.line}`}
                    onSelect={() => run(() => openNote(h.path))}
                    className="px-3 py-2"
                  >
                    <HugeiconsIcon
                      icon={TextIcon}
                      strokeWidth={1.7}
                      className="text-muted-foreground mt-0.5 self-start"
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-baseline gap-2">
                        <span className="text-foreground truncate text-[14.5px] font-medium">{noteTitle(h.path)}</span>
                        {dirname(h.path) && (
                          <span className="text-muted-foreground truncate text-xs">{dirname(h.path)}</span>
                        )}
                      </span>
                      <span className="text-foreground/70 truncate text-xs">{highlight(h.preview)}</span>
                    </div>
                  </CommandItem>
                ))}
            </CommandGroup>
          )}

          <CommandGroup heading="Actions">
            {canCreate && (
              <CommandItem
                value={`create:${query}`}
                onSelect={() => run(() => createNote(undefined, query.trim()))}
                className={item}
              >
                <HugeiconsIcon icon={NoteAddIcon} strokeWidth={1.7} className="text-primary" />
                <span className="text-foreground">
                  Create note <span className="font-semibold">“{query.trim()}”</span>
                </span>
              </CommandItem>
            )}
            {actionMatches('new note') && (
              <CommandItem value="action new note" onSelect={() => run(() => createNote())} className={item}>
                <HugeiconsIcon icon={NoteAddIcon} strokeWidth={1.7} className="text-primary" />
                <span className="text-foreground">New note</span>
                <CommandShortcut>{mod}+N</CommandShortcut>
              </CommandItem>
            )}
            {actionMatches('open today daily note') && (
              <CommandItem value="action today daily note" onSelect={() => run(() => openDailyNote())} className={item}>
                <HugeiconsIcon icon={Calendar03Icon} strokeWidth={1.7} className="text-primary" />
                <span className="text-foreground">Open today's daily note</span>
                <CommandShortcut>{mod}+D</CommandShortcut>
              </CommandItem>
            )}
            {actionMatches('tasks') && (
              <CommandItem value="action tasks" onSelect={() => run(openTasksView)} className={item}>
                <HugeiconsIcon icon={TaskDone01Icon} strokeWidth={1.7} className="text-primary" />
                <span className="text-foreground">Tasks</span>
              </CommandItem>
            )}
            {actionMatches('graph') && (
              <CommandItem value="action graph" onSelect={() => run(openGraphView)} className={item}>
                <HugeiconsIcon icon={NeuralNetworkIcon} strokeWidth={1.7} className="text-primary" />
                <span className="text-foreground">Graph</span>
              </CommandItem>
            )}
            {actionMatches('find replace') && (
              <CommandItem value="action find replace" onSelect={() => run(openSearchView)} className={item}>
                <HugeiconsIcon icon={SearchReplaceIcon} strokeWidth={1.7} className="text-primary" />
                <span className="text-foreground">Find & replace in vault</span>
              </CommandItem>
            )}
            {actionMatches('settings preferences') && (
              <CommandItem value="action settings preferences" onSelect={() => run(openSettings)} className={item}>
                <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.7} className="text-primary" />
                <span className="text-foreground">Settings</span>
              </CommandItem>
            )}
            {actionMatches('change notes folder vault') && (
              <CommandItem
                value="action change notes folder vault"
                onSelect={() =>
                  run(async () => {
                    const picked = await window.api.vault.pickFolder()
                    if (picked) await update({ vaultPath: picked })
                  })
                }
                className={item}
              >
                <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={1.7} className="text-primary" />
                <span className="text-foreground">Change notes folder…</span>
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
        <div className="border-border text-muted-foreground flex items-center gap-4 border-t px-4 py-2 text-[11px]">
          <span>
            <kbd className="bg-muted rounded px-1">↑</kbd> <kbd className="bg-muted rounded px-1">↓</kbd> navigate
          </span>
          <span>
            <kbd className="bg-muted rounded px-1">↵</kbd> open
          </span>
          <span className="ml-auto">{notes.length} notes</span>
        </div>
      </Command>
    </CommandDialog>
  )
}
