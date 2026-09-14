import { useEffect } from 'react'
import { closeTab, createNote, openDailyNote } from '@/lib/actions'
import { useTabsStore } from '@/stores/tabsStore'
import { useUiStore } from '@/stores/uiStore'

/** App-wide shortcuts (editor-local ones live in editor/commands.ts). */
export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const tabs = useTabsStore.getState()
      const ui = useUiStore.getState()
      if (key === 'escape' && ui.focusMode && !mod) {
        ui.toggleFocusMode()
        return
      }
      if (!mod) return

      // UI zoom: Ctrl+= / Ctrl++ / numpad + → in, Ctrl+- → out, Ctrl+0 → reset
      const code = e.code
      if (key === '=' || key === '+' || code === 'NumpadAdd') {
        e.preventDefault()
        void window.api.window.zoom('in')
        return
      }
      if (key === '-' || key === '_' || code === 'NumpadSubtract') {
        e.preventDefault()
        void window.api.window.zoom('out')
        return
      }
      if (key === '0' && !e.altKey) {
        e.preventDefault()
        void window.api.window.zoom('reset')
        return
      }

      if (key === 'f' && e.shiftKey) {
        e.preventDefault()
        ui.toggleFocusMode()
      } else if (key === 'p' && !e.shiftKey) {
        e.preventDefault()
        ui.openPalette()
      } else if (key === 'n' && !e.shiftKey) {
        e.preventDefault()
        void createNote()
      } else if (key === 'd' && !e.shiftKey) {
        e.preventDefault()
        void openDailyNote()
      } else if (key === 'w') {
        e.preventDefault()
        if (tabs.activeId) void closeTab(tabs.activeId)
      } else if (key === '\\') {
        e.preventDefault()
        ui.toggleSidebar()
      } else if (key === 'tab') {
        e.preventDefault()
        if (e.shiftKey) tabs.prev()
        else tabs.next()
      } else if (e.altKey && key === 'arrowleft') {
        e.preventDefault()
        tabs.back()
      } else if (e.altKey && key === 'arrowright') {
        e.preventDefault()
        tabs.forward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
