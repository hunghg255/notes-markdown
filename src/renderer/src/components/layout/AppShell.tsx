import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import { OutlinePanel } from '@/components/editor/OutlinePanel'
import { PropertiesPanel } from '@/components/editor/PropertiesPanel'
import { StatusBar } from '@/components/editor/StatusBar'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { SettingsView } from '@/components/settings/SettingsView'
import { TabBar } from '@/components/tabs/TabBar'
import { GraphView } from '@/components/views/GraphView'
import { SearchView } from '@/components/views/SearchView'
import { TagView } from '@/components/views/TagView'
import { TasksView } from '@/components/views/TasksView'
import { createNote, openDailyNote } from '@/lib/actions'
import { VIEW } from '@/lib/views'
import { cn } from '@/lib/utils'
import { SETTINGS_TAB, useTabsStore } from '@/stores/tabsStore'
import { useUiStore } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'
import logo from '@resources/logo.png'

export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const focusMode = useUiStore((s) => s.focusMode)

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
      {sidebarOpen && !focusMode && (
        <>
          <ResizablePanel id="sidebar" defaultSize={280} minSize={200} maxSize={480} className="min-w-0">
            <Sidebar />
          </ResizablePanel>
          <ResizableHandle className="bg-border/60 hover:bg-primary/60 transition-colors" />
        </>
      )}
      <ResizablePanel id="main" className="min-w-0">
        <Workspace />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function renderView(id: string) {
  if (id === SETTINGS_TAB) return <SettingsView />
  if (id === VIEW.tasks) return <TasksView />
  if (id === VIEW.graph) return <GraphView />
  if (id === VIEW.search) return <SearchView />
  if (id.startsWith('view:tag:')) return <TagView key={id} tag={id.slice('view:tag:'.length)} />
  return null
}

function Workspace() {
  const activeId = useTabsStore((s) => s.activeId)
  const focusMode = useUiStore((s) => s.focusMode)
  const view = activeId ? renderView(activeId) : null
  return (
    <div className={cn('bg-background relative flex h-full flex-col', focusMode && 'focus-mode')}>
      {!focusMode && <TabBar />}
      {focusMode && <div className="app-drag h-10 shrink-0" />}
      <div className="@container relative flex min-h-0 flex-1 flex-col">
        {activeId === null && <EmptyState />}
        {view}
        {activeId && !view && (
          <>
            <PropertiesPanel path={activeId} />
            <MarkdownEditor path={activeId} />
            <OutlinePanel path={activeId} />
            <StatusBar path={activeId} />
          </>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-4">
      <img src={logo} alt="" draggable={false} className="size-20 rounded-2xl opacity-90" />
      <p className="text-sm">No note open</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void createNote()}>
          New note
        </Button>
        <Button variant="outline" size="sm" onClick={() => void openDailyNote()}>
          Today's note
        </Button>
      </div>
      <p className="text-xs opacity-70">Press Ctrl+P to search</p>
    </div>
  )
}
