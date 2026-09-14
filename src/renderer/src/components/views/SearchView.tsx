import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, File02Icon, Search01Icon, SearchReplaceIcon } from '@hugeicons/core-free-icons'
import type { SearchHit } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { openNote } from '@/lib/actions'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editorStore'
import { useVaultStore, dirname, noteTitle } from '@/stores/vaultStore'
import { ViewShell } from './ViewShell'

/** Highlight every occurrence of the query inside a preview line. */
function Highlight({ text, query, matchCase }: { text: string; query: string; matchCase: boolean }) {
  if (!query) return <>{text}</>
  const hay = matchCase ? text : text.toLowerCase()
  const needle = matchCase ? query : query.toLowerCase()
  const parts: React.ReactNode[] = []
  let i = 0
  let idx = hay.indexOf(needle)
  while (idx !== -1) {
    parts.push(text.slice(i, idx))
    parts.push(
      <mark key={idx} className="bg-primary/25 text-primary rounded-sm px-0.5 font-semibold">
        {text.slice(idx, idx + query.length)}
      </mark>,
    )
    i = idx + query.length
    idx = hay.indexOf(needle, i)
  }
  parts.push(text.slice(i))
  return <>{parts}</>
}

function Field({
  icon,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  icon: typeof Search01Icon
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoFocus?: boolean
}) {
  return (
    <label className="bg-accent/40 focus-within:ring-primary/60 focus-within:bg-accent/60 flex h-11 items-center gap-3 rounded-lg px-3 ring-1 ring-transparent transition-colors">
      <HugeiconsIcon icon={icon} size={18} strokeWidth={1.8} className="text-muted-foreground shrink-0" />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="text-foreground placeholder:text-muted-foreground/70 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-muted-foreground hover:text-foreground text-xs"
          aria-label="Clear"
        >
          clear
        </button>
      )}
    </label>
  )
}

export function SearchView() {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([])
      setSearched(false)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const result = await window.api.vault.search(query)
      if (cancelled) return
      setHits(matchCase ? result.filter((h) => h.preview.includes(query)) : result)
      setSearched(true)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, matchCase])

  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>()
    for (const h of hits) (map.get(h.path) ?? map.set(h.path, []).get(h.path)!).push(h)
    return [...map.entries()]
  }, [hits])

  const runReplace = async (paths: string[]) => {
    if (!query) return
    setBusy(true)
    try {
      // make sure open buffers are on disk before rewriting them
      await useEditorStore.getState().saveAll()
      const result = await window.api.vault.replace(query, replacement, paths, matchCase)
      toast.success(
        `Replaced ${result.replacements} occurrence${result.replacements === 1 ? '' : 's'} in ${result.files} note${result.files === 1 ? '' : 's'}`,
      )
      for (const p of paths.length ? paths : groups.map(([p]) => p)) {
        if (useEditorStore.getState().docs[p]) await useEditorStore.getState().load(p, true)
      }
      await useVaultStore.getState().refresh()
      setHits(await window.api.vault.search(query))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ViewShell title="Find & Replace" description="Search every note in the vault. Replacement is literal (no regex).">
      <div className="flex flex-col gap-2">
        <Field icon={Search01Icon} value={query} onChange={setQuery} placeholder="Find in all notes…" autoFocus />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Field icon={SearchReplaceIcon} value={replacement} onChange={setReplacement} placeholder="Replace with…" />
          </div>
          <Button size="lg" disabled={busy || hits.length === 0} onClick={() => void runReplace([])}>
            Replace all
            {hits.length > 0 && (
              <span className="bg-primary-foreground/20 rounded-full px-1.5 text-xs">{hits.length}</span>
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between px-1 pt-1">
          <label className="text-foreground/80 flex cursor-pointer items-center gap-2 text-sm">
            <Switch size="sm" checked={matchCase} onCheckedChange={setMatchCase} /> Match case
          </label>
          {searched && (
            <span className="text-sm">
              <span className="text-foreground font-semibold">{hits.length}</span>{' '}
              <span className="text-muted-foreground">
                match{hits.length === 1 ? '' : 'es'} in{' '}
                <span className="text-foreground font-semibold">{groups.length}</span> note
                {groups.length === 1 ? '' : 's'}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {searched && hits.length === 0 && (
          <div className="text-muted-foreground border-border rounded-lg border border-dashed py-10 text-center text-sm">
            No matches for “{query}”.
          </div>
        )}
        {groups.map(([path, list]) => (
          <section key={path} className="border-border bg-card/40 overflow-hidden rounded-xl border">
            <div className="flex items-center gap-2 px-3 py-2">
              <HugeiconsIcon icon={File02Icon} size={16} strokeWidth={1.7} className="text-primary shrink-0" />
              <button
                type="button"
                onClick={() => openNote(path)}
                className="group flex min-w-0 flex-1 items-baseline gap-2 text-left"
              >
                <span className="text-foreground group-hover:text-primary truncate text-[15px] font-semibold">
                  {noteTitle(path)}
                </span>
                {dirname(path) && <span className="text-muted-foreground truncate text-xs">{dirname(path)}</span>}
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={14}
                  strokeWidth={2}
                  className="text-primary opacity-0 transition-opacity group-hover:opacity-100"
                />
              </button>
              <Badge variant="secondary">{list.length}</Badge>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void runReplace([path])}>
                Replace in note
              </Button>
            </div>
            <ul className="border-border divide-border flex flex-col divide-y border-t">
              {list.slice(0, 50).map((h) => (
                <li
                  key={h.line}
                  className={cn('hover:bg-accent/40 flex cursor-pointer gap-3 px-3 py-1.5 text-[13.5px]')}
                  onClick={() => openNote(path)}
                >
                  <span className="text-muted-foreground w-8 shrink-0 text-right font-mono text-xs leading-5 tabular-nums">
                    {h.line}
                  </span>
                  <span className="text-foreground/90 truncate">
                    <Highlight text={h.preview} query={query} matchCase={matchCase} />
                  </span>
                </li>
              ))}
              {list.length > 50 && (
                <li className="text-muted-foreground px-3 py-1.5 text-xs">+ {list.length - 50} more in this note</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </ViewShell>
  )
}
