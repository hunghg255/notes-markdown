import { useMemo } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { LeftToRightListBulletIcon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { indexNote } from '@shared/indexNote'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { scrollToHeading } from '@/editor/anchors'
import { useOutlineStore } from '@/editor/outlineTracker'
import { liveView } from '@/editor/stateCache'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'

const strip = (s: string) =>
  s
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, t: string, a?: string) => (a ?? t).trim())
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')

/** Floating table of contents for the active note (top-right of the editor). */
export function OutlinePanel({ path }: { path: string }) {
  const content = useEditorStore((s) => s.docs[path]?.content ?? '')
  const cursorLine = useOutlineStore((s) => s.cursorLine)
  const collapsed = useUiStore((s) => s.sections.outline ?? false)
  const toggle = useUiStore((s) => s.toggleSection)
  const focusMode = useUiStore((s) => s.focusMode)

  const headings = useMemo(() => indexNote(content).headings, [content])
  if (focusMode || headings.length < 2) return null

  // the current section is the last heading at or above the cursor
  let activeIdx = -1
  for (let i = 0; i < headings.length; i++) if (headings[i].line <= cursorLine) activeIdx = i
  const minLevel = Math.min(...headings.map((h) => h.level))

  if (collapsed) {
    return (
      <div className="absolute top-3 right-4 z-10 hidden @[1000px]:block">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => toggle('outline')}
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-8 items-center justify-center rounded-md"
              aria-label="Show outline"
            >
              <HugeiconsIcon icon={LeftToRightListBulletIcon} size={18} strokeWidth={1.7} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Outline</TooltipContent>
        </Tooltip>
      </div>
    )
  }

  return (
    <aside className="absolute top-3 right-4 z-10 hidden w-56 @[1000px]:block">
      <div className="text-muted-foreground flex h-8 items-center justify-between pr-1 pl-2 text-[11px] font-semibold tracking-wider uppercase">
        <span>Outline</span>
        <button
          type="button"
          onClick={() => toggle('outline')}
          className="hover:text-foreground flex size-6 items-center justify-center rounded"
          aria-label="Hide outline"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
        </button>
      </div>
      <nav className="max-h-[70vh] overflow-y-auto pr-1">
        <ul className="border-border flex flex-col border-l">
          {headings.map((h, i) => (
            <li key={`${h.line}-${h.text}`}>
              <button
                type="button"
                onClick={() => {
                  const view = liveView.current
                  if (view) scrollToHeading(view, h.text)
                }}
                title={h.text}
                className={cn(
                  '-ml-px block w-full truncate border-l py-1 pr-2 text-left text-[12.5px] transition-colors',
                  i === activeIdx
                    ? 'border-primary text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )}
                style={{ paddingLeft: 10 + (h.level - minLevel) * 12 }}
              >
                {strip(h.text)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
