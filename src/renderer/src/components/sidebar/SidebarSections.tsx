import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, File02Icon, PinIcon, Tag01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { openNote, openTagView } from '@/lib/actions'
import { useIndexStore } from '@/stores/indexStore'
import { useTabsStore } from '@/stores/tabsStore'
import { useUiStore } from '@/stores/uiStore'
import { useVaultStore, noteTitle } from '@/stores/vaultStore'

/** Collapsible section header used above Pinned / Recent / Tags / Files. */
export function Section({
  id,
  title,
  count,
  children,
  defaultOpen = true,
}: {
  id: string
  title: string
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const collapsed = useUiStore((s) => s.sections[id] ?? !defaultOpen)
  const toggle = useUiStore((s) => s.toggleSection)
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => toggle(id)}
        className="text-muted-foreground hover:text-foreground flex h-7 w-full items-center gap-1 px-2 text-[11px] font-semibold tracking-wider uppercase"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={12}
          strokeWidth={2}
          className={cn('transition-transform', !collapsed && 'rotate-90')}
        />
        <span>{title}</span>
        {count !== undefined && <span className="ml-auto font-normal tabular-nums opacity-60">{count}</span>}
      </button>
      {!collapsed && <div className="flex flex-col gap-px pb-2">{children}</div>}
    </div>
  )
}

function NoteRow({ path, icon }: { path: string; icon: typeof File02Icon }) {
  const active = useTabsStore((s) => s.activeId === path)
  return (
    <button
      type="button"
      onClick={() => openNote(path)}
      title={path}
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-md px-2 pl-4 text-left text-[13px] transition-colors',
        'text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        active && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={1.6} className="text-muted-foreground shrink-0" />
      <span className="truncate">{noteTitle(path)}</span>
    </button>
  )
}

export function PinnedSection() {
  const pinned = useUiStore((s) => s.pinned)
  const notes = useVaultStore((s) => s.notes)
  const existing = pinned.filter((p) => notes.some((n) => n.path === p))
  if (existing.length === 0) return null
  return (
    <Section id="pinned" title="Pinned" count={existing.length}>
      {existing.map((p) => (
        <NoteRow key={p} path={p} icon={PinIcon} />
      ))}
    </Section>
  )
}

export function RecentSection() {
  const recent = useUiStore((s) => s.recent)
  const notes = useVaultStore((s) => s.notes)
  const existing = recent.filter((p) => notes.some((n) => n.path === p)).slice(0, 5)
  if (existing.length === 0) return null
  return (
    <Section id="recent" title="Recent" defaultOpen={false}>
      {existing.map((p) => (
        <NoteRow key={p} path={p} icon={File02Icon} />
      ))}
    </Section>
  )
}

export function TagsSection() {
  const tags = useIndexStore((s) => s.tags)
  const activeId = useTabsStore((s) => s.activeId)
  const entries = Object.entries(tags).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  if (entries.length === 0) return null
  return (
    <Section id="tags" title="Tags" count={entries.length} defaultOpen={false}>
      <div className="flex flex-wrap gap-1 px-2 py-1">
        {entries.map(([tag, paths]) => (
          <button
            key={tag}
            type="button"
            onClick={() => openTagView(tag)}
            className={cn(
              'bg-link/10 text-link hover:bg-link/20 flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] transition-colors',
              activeId === `view:tag:${tag}` && 'ring-link/60 ring-1',
            )}
          >
            <HugeiconsIcon icon={Tag01Icon} size={11} strokeWidth={2} />
            {tag}
            <span className="opacity-60">{paths.length}</span>
          </button>
        ))}
      </div>
    </Section>
  )
}
