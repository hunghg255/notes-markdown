import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { File02Icon, Folder01Icon, FolderOpenIcon } from '@hugeicons/core-free-icons'
import type { TreeNode } from '@shared/types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { createFolder, createNote, deleteEntry, moveEntry, openNote, renameNote } from '@/lib/actions'
import { canDropInto, draggedPath, endTreeDrag, startTreeDrag } from '@/lib/dnd'
import { useTabsStore } from '@/stores/tabsStore'
import { dirname, useVaultStore } from '@/stores/vaultStore'
import { useUiStore } from '@/stores/uiStore'

interface Props {
  node: TreeNode
  depth: number
}

export function TreeItem({ node, depth }: Props) {
  const expanded = useVaultStore((s) => !!s.expanded[node.path])
  const toggleDir = useVaultStore((s) => s.toggleDir)
  const setSelectedDir = useVaultStore((s) => s.setSelectedDir)
  const selectedDir = useVaultStore((s) => s.selectedDir)
  const active = useTabsStore((s) => s.activeId === node.path)
  const [renaming, setRenaming] = useState(false)
  const [dropTarget, setDropTarget] = useState(false)
  const pinned = useUiStore((s) => s.pinned.includes(node.path))
  const togglePinned = useUiStore((s) => s.togglePinned)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isDir = node.type === 'dir'
  const isSelectedDir = isDir && selectedDir === node.path && !active

  // ----- drag & drop: any item can be dragged; dropping on a folder moves into it,
  // dropping on a file moves next to it (into the same folder) -----
  const dropDir = isDir ? node.path : dirname(node.path)
  const onDragStart = (e: React.DragEvent) => {
    if (renaming) return e.preventDefault()
    startTreeDrag(e, node.path)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (!canDropInto(dropDir)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (!dropTarget) {
      setDropTarget(true)
      // auto-expand the folder while hovering so nested targets are reachable
      if (isDir && !expanded && !hoverTimer.current) {
        hoverTimer.current = setTimeout(() => toggleDir(node.path), 600)
      }
    }
  }
  const clearHover = () => {
    setDropTarget(false)
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }
  const onDrop = (e: React.DragEvent) => {
    if (!canDropInto(dropDir)) return
    e.preventDefault()
    e.stopPropagation()
    const source = draggedPath(e)
    clearHover()
    endTreeDrag()
    if (source) void moveEntry(source, dropDir)
  }

  const onClick = () => {
    if (isDir) {
      toggleDir(node.path)
      setSelectedDir(node.path)
    } else {
      openNote(node.path)
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            onDoubleClick={() => setRenaming(true)}
            draggable={!renaming}
            onDragStart={onDragStart}
            onDragEnd={() => {
              clearHover()
              endTreeDrag()
            }}
            onDragOver={onDragOver}
            onDragLeave={clearHover}
            onDrop={onDrop}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[13.5px] transition-colors',
              'text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              active && 'bg-sidebar-accent text-sidebar-accent-foreground',
              isSelectedDir && 'text-sidebar-accent-foreground',
              dropTarget && 'bg-primary/20 ring-primary/60 text-sidebar-accent-foreground ring-1 ring-inset',
            )}
            style={{ paddingLeft: 10 + depth * 18 }}
            title={node.path}
          >
            <HugeiconsIcon
              icon={isDir ? (expanded ? FolderOpenIcon : Folder01Icon) : File02Icon}
              size={16}
              strokeWidth={1.6}
              className="text-muted-foreground shrink-0"
            />
            {renaming ? (
              <RenameInput
                initial={node.name}
                onDone={(name) => {
                  setRenaming(false)
                  if (name && name !== node.name) void renameNote(node.path, name)
                }}
              />
            ) : (
              <span className="truncate">{node.name}</span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {isDir && (
            <>
              <ContextMenuItem onSelect={() => void createNote(node.path)}>New note</ContextMenuItem>
              <ContextMenuItem onSelect={() => void createFolder(node.path)}>New folder</ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {!isDir && (
            <>
              <ContextMenuItem onSelect={() => openNote(node.path)}>Open</ContextMenuItem>
              <ContextMenuItem onSelect={() => togglePinned(node.path)}>
                {pinned ? 'Unpin' : 'Pin to sidebar'}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}>Rename</ContextMenuItem>
          <ContextMenuItem onSelect={() => void window.api.shell.showInFolder(node.path)}>
            Reveal in file manager
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void deleteEntry(node.path)}>
            Move to trash
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isDir && expanded && node.children?.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} />)}
    </>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      defaultValue={initial}
      className="bg-background ring-ring h-6 min-w-0 flex-1 rounded px-1 text-[13px] ring-1 outline-none"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onDone(e.currentTarget.value.trim())
        if (e.key === 'Escape') onDone(null)
      }}
      onBlur={(e) => onDone(e.currentTarget.value.trim())}
    />
  )
}
