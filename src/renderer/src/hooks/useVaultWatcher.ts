import { useEffect } from 'react'
import { toast } from 'sonner'
import { editorStates } from '@/editor/stateCache'
import { useEditorStore } from '@/stores/editorStore'
import { scheduleIndexRefresh } from '@/stores/indexStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTabsStore } from '@/stores/tabsStore'
import { useVaultStore } from '@/stores/vaultStore'

/** Keeps the tree and open documents in sync with changes made outside the app. */
export function useVaultWatcher() {
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void useVaultStore.getState().refresh(), 150)
      scheduleIndexRefresh()
    }

    const unsubscribe = window.api.vault.onChanged(async (ev) => {
      const editor = useEditorStore.getState()
      const tabs = useTabsStore.getState()

      switch (ev.type) {
        case 'vaultChanged': {
          for (const t of tabs.tabs) {
            editor.unload(t.id)
            editorStates.forget(t.id)
          }
          tabs.closeAll()
          await useSettingsStore.getState().load()
          scheduleRefresh()
          return
        }
        case 'add':
        case 'addDir':
        case 'unlinkDir':
          scheduleRefresh()
          return
        case 'unlink': {
          scheduleRefresh()
          if (editor.docs[ev.path]) {
            editor.unload(ev.path)
            editorStates.forget(ev.path)
            tabs.close(ev.path)
            toast.info(`"${ev.path}" was removed on disk`)
          }
          return
        }
        case 'change': {
          scheduleRefresh()
          const doc = editor.docs[ev.path]
          if (!doc || doc.loading) return
          const file = await window.api.vault.read(ev.path).catch(() => null)
          if (!file) return
          if (file.content === doc.content) return // our own write, or no-op change
          const dirty = doc.content !== doc.saved
          if (!dirty) {
            await editor.load(ev.path, true)
            return
          }
          // toast.warning(`"${ev.path}" changed on disk`, {
          //   description: 'You have unsaved edits in this note.',
          //   duration: 10000,
          //   action: { label: 'Reload from disk', onClick: () => void editor.load(ev.path, true) },
          // })
        }
      }
    })

    return () => {
      unsubscribe()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [])
}
