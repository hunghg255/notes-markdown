import type { DragEvent } from 'react'
import { useUiStore } from '@/stores/uiStore'

export const DND_TYPE = 'application/x-note-path'

export function startTreeDrag(e: DragEvent, path: string) {
  e.dataTransfer.setData(DND_TYPE, path)
  e.dataTransfer.effectAllowed = 'move'
  useUiStore.getState().setDragging(path)
}

export function endTreeDrag() {
  useUiStore.getState().setDragging(null)
}

/** Can the item currently being dragged be dropped into `targetDir`? */
export function canDropInto(targetDir: string): boolean {
  const dragging = useUiStore.getState().dragging
  if (dragging === null) return false
  const parent = dragging.includes('/') ? dragging.slice(0, dragging.lastIndexOf('/')) : ''
  if (parent === targetDir) return false
  if (dragging === targetDir || targetDir.startsWith(dragging + '/')) return false
  return true
}

export function draggedPath(e: DragEvent): string | null {
  return e.dataTransfer.getData(DND_TYPE) || useUiStore.getState().dragging
}
