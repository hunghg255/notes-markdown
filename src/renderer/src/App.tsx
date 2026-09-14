import { useEffect } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { CommandPalette } from '@/components/palette/CommandPalette'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useVaultWatcher } from '@/hooks/useVaultWatcher'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useIndexStore } from '@/stores/indexStore'

export default function App() {
  const loaded = useSettingsStore((s) => s.loaded)
  useHotkeys()
  useVaultWatcher()

  useEffect(() => {
    void useSettingsStore.getState().load()
    void useVaultStore.getState().refresh()
    void useIndexStore.getState().refresh()
  }, [])

  if (!loaded) return <div className="bg-background h-full" />

  return (
    <TooltipProvider delayDuration={400}>
      <AppShell />
      <CommandPalette />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
