import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  SidebarLeftIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { copyNoteAsHtml, copyNoteAsMarkdown, exportNote } from '@/lib/export'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  createNote,
  openGraphView,
  openSearchView,
  openTasksView,
} from '@/lib/actions'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useEditorStore } from '@/stores/editorStore'
import { useTabsStore } from '@/stores/tabsStore'
import { isViewTab, viewTitle } from '@/lib/views'
import { useUiStore } from '@/stores/uiStore'
import { noteTitle } from '@/stores/vaultStore'

const isMac = window.api.platform === 'darwin'

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const canBack = useTabsStore((s) => s.historyIndex > 0)
  const canForward = useTabsStore((s) => s.historyIndex < s.history.length - 1)
  const back = useTabsStore((s) => s.back)
  const forward = useTabsStore((s) => s.forward)
  const setActive = useTabsStore((s) => s.setActive)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  return (
    <div
      className={cn(
        'app-drag flex h-10 shrink-0 items-center gap-1 pl-2',
        // leave room for the Windows/Linux window controls overlay
        isMac ? 'pr-2' : 'pr-36',
        isMac && !sidebarOpen && 'pl-20',
      )}
    >
      {!sidebarOpen && (
        <Button variant="ghost" size="icon-sm" className="app-no-drag text-muted-foreground" onClick={toggleSidebar}>
          <HugeiconsIcon icon={SidebarLeftIcon} strokeWidth={1.6} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="app-no-drag text-muted-foreground"
        disabled={!canBack}
        onClick={back}
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.8} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="app-no-drag text-muted-foreground"
        disabled={!canForward}
        onClick={forward}
      >
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.8} />
      </Button>

      <div className="app-no-drag ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <TabItem key={tab.id} id={tab.id} active={tab.id === activeId} onActivate={() => setActive(tab.id)} />
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground shrink-0"
              onClick={() => void createNote()}
            >
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={1.8} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New note ({isMac ? '⌘' : 'Ctrl'}+N)</TooltipContent>
        </Tooltip>
      </div>
      <NoteMenu activeId={activeId} />
    </div>
  )
}

function NoteMenu({ activeId }: { activeId: string | null }) {
  const isNote = !!activeId && !isViewTab(activeId)
  const toggleFocus = useUiStore((s) => s.toggleFocusMode)
  const mod = isMac ? '⌘' : 'Ctrl'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="app-no-drag text-muted-foreground shrink-0" aria-label="More">
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={1.8} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={toggleFocus}>
            Focus mode
            <DropdownMenuShortcut>{mod}+Shift+F</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openTasksView}>Tasks</DropdownMenuItem>
          <DropdownMenuItem onSelect={openGraphView}>Graph</DropdownMenuItem>
          <DropdownMenuItem onSelect={openSearchView}>Find & replace in vault</DropdownMenuItem>
        </DropdownMenuGroup>
        {isNote && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => void exportNote(activeId, 'pdf')}>Export as PDF…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportNote(activeId, 'html')}>Export as HTML…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportNote(activeId, 'md')}>Export a copy (.md)…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyNoteAsHtml(activeId)}>Copy as rich text</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyNoteAsMarkdown(activeId)}>Copy as markdown</DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TabItem({ id, active, onActivate }: { id: string; active: boolean; onActivate: () => void }) {
  const dirty = useEditorStore((s) => {
    const d = s.docs[id]
    return !!d && d.content !== d.saved
  })
  const title = isViewTab(id) ? viewTitle(id) : noteTitle(id)
  const tabs = useTabsStore((s) => s.tabs)
  const idx = tabs.findIndex((t) => t.id === id)
  const hasOthers = tabs.length > 1
  const hasRight = idx !== -1 && idx < tabs.length - 1
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          tabIndex={0}
          onClick={onActivate}
          onKeyDown={(e) => e.key === 'Enter' && onActivate()}
          onAuxClick={(e) => e.button === 1 && void closeTab(id)}
          title={id}
          className={cn(
            'group flex h-8 max-w-56 shrink-0 cursor-default items-center gap-1 rounded-lg pr-1 pl-3 text-[13.5px] transition-colors select-none',
            active
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <span className="truncate">{title}</span>
          <button
            type="button"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              void closeTab(id)
            }}
            className={cn(
              'hover:bg-foreground/10 ml-1 flex size-5 shrink-0 items-center justify-center rounded-md',
              !active && !dirty && 'opacity-0 group-hover:opacity-100',
            )}
          >
            {dirty ? <span className="bg-primary block size-2 rounded-full group-hover:hidden" /> : null}
            <HugeiconsIcon
              icon={Cancel01Icon}
              size={12}
              strokeWidth={2}
              className={cn(dirty && 'hidden group-hover:block')}
            />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => void closeTab(id)}>
          Close
          <ContextMenuShortcut>{isMac ? '⌘' : 'Ctrl'}+W</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasOthers} onSelect={() => void closeOtherTabs(id)}>
          Close others
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasRight} onSelect={() => void closeTabsToRight(id)}>
          Close to the right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void closeOtherTabs(null)}>Close all</ContextMenuItem>
        {!isViewTab(id) && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void window.api.shell.showInFolder(id)}>
              Reveal in file manager
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
