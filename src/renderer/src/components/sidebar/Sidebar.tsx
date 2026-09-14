import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Calendar03Icon,
  FolderAddIcon,
  NeuralNetworkIcon,
  NoteAddIcon,
  Search01Icon,
  SearchReplaceIcon,
  Settings01Icon,
  SidebarLeftIcon,
  TaskDone01Icon,
  UnfoldMoreIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  createFolder,
  createNote,
  moveEntry,
  openDailyNote,
  openGraphView,
  openSearchView,
  openSettings,
  openTasksView,
} from '@/lib/actions'
import { PinnedSection, RecentSection, Section, TagsSection } from './SidebarSections'
import { canDropInto, draggedPath, endTreeDrag } from '@/lib/dnd'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { TreeItem } from './TreeItem'

const isMac = window.api.platform === 'darwin'
const modKey = isMac ? '⌘' : 'Ctrl'

export function Sidebar() {
  const tree = useVaultStore((s) => s.tree)
  const loading = useVaultStore((s) => s.loading)
  const setSelectedDir = useVaultStore((s) => s.setSelectedDir)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const openPalette = useUiStore((s) => s.openPalette)
  const [rootDrop, setRootDrop] = useState(false)

  // dropping on empty space in the tree moves the item to the vault root
  const onRootDragOver = (e: React.DragEvent) => {
    if (!canDropInto('')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setRootDrop(true)
  }
  const onRootDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setRootDrop(false)
    const source = draggedPath(e)
    endTreeDrag()
    if (source) void moveEntry(source, '')
  }

  return (
    <aside className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className={`app-drag flex h-10 shrink-0 items-center ${isMac ? 'justify-end pr-2 pl-20' : 'px-2'}`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="app-no-drag text-muted-foreground"
              onClick={toggleSidebar}
            >
              <HugeiconsIcon icon={SidebarLeftIcon} strokeWidth={1.6} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Toggle sidebar ({modKey}+\)</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex flex-col gap-1 px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={openPalette}
          className="bg-sidebar-accent/60 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-9 w-full items-center gap-2 rounded-lg px-3 text-[13.5px] transition-colors"
        >
          <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.8} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-[11px] tracking-wide opacity-70">{modKey} P</kbd>
        </button>
        <div className="flex items-center gap-0.5 pt-1">
          <IconAction label="New note" icon={NoteAddIcon} onClick={() => void createNote()} />
          <IconAction label="New folder" icon={FolderAddIcon} onClick={() => void createFolder()} />
          <IconAction
            label={`Today's daily note (${modKey}+D)`}
            icon={Calendar03Icon}
            onClick={() => void openDailyNote()}
          />
          <span className="bg-border mx-1 h-4 w-px" />
          <IconAction label="Tasks" icon={TaskDone01Icon} onClick={openTasksView} />
          <IconAction label="Graph" icon={NeuralNetworkIcon} onClick={openGraphView} />
          <IconAction label="Find & replace in all notes" icon={SearchReplaceIcon} onClick={openSearchView} />
        </div>
      </div>

      <ScrollArea
        className={cn('min-h-0 flex-1 px-2 transition-colors', rootDrop && 'bg-primary/10')}
        onDragOver={onRootDragOver}
        onDragLeave={() => setRootDrop(false)}
        onDrop={onRootDrop}
      >
        <div
          className="flex min-h-full flex-col pb-4"
          onClick={(e) => e.target === e.currentTarget && setSelectedDir('')}
        >
          <PinnedSection />
          <RecentSection />
          <TagsSection />
          <Section id="files" title="Files">
            {loading && tree.length === 0 && <p className="text-muted-foreground px-3 py-2 text-xs">Loading…</p>}
            {!loading && tree.length === 0 && (
              <p className="text-muted-foreground px-3 py-2 text-xs">No notes yet. Create one with the + button.</p>
            )}
            {tree.map((node) => (
              <TreeItem key={node.path} node={node} depth={0} />
            ))}
          </Section>
        </div>
      </ScrollArea>

      <LibraryMenu />
    </aside>
  )
}

function IconAction({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={onClick}>
          <HugeiconsIcon icon={icon} strokeWidth={1.6} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function LibraryMenu() {
  const vaultPath = useSettingsStore((s) => s.config.vaultPath)
  const update = useSettingsStore((s) => s.update)
  const name = vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? 'Library'

  const changeFolder = async () => {
    const picked = await window.api.vault.pickFolder()
    if (picked) await update({ vaultPath: picked })
  }

  return (
    <div className="border-sidebar-border border-t p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="text-sidebar-foreground/85 hover:bg-sidebar-accent flex h-9 w-full items-center gap-2 rounded-md px-2 text-[13.5px]"
          >
            <HugeiconsIcon icon={UnfoldMoreIcon} size={16} strokeWidth={1.8} className="text-muted-foreground" />
            <span className="truncate">{name}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-64">
          <DropdownMenuLabel className="truncate font-normal">
            <span className="text-muted-foreground text-xs">{vaultPath}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => void changeFolder()}>Change notes folder…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void window.api.shell.showInFolder('')}>
              Open in file manager
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openSettings}>
              <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.6} />
              Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
