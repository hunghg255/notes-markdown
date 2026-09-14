import { create } from 'zustand'
import type { AppConfig } from '@shared/types'

interface SettingsState {
  config: AppConfig
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<AppConfig>) => Promise<void>
}

const fallback: AppConfig = { vaultPath: '', theme: 'dark', accent: 'orange', fontSize: 16, autosave: true }

function applyTheme(theme: AppConfig['theme']) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
}

function applyAccent(accent: AppConfig['accent']) {
  document.documentElement.dataset.accent = accent
}

function applyFocusDim(on: boolean | undefined) {
  document.documentElement.dataset.focusDim = on ? 'on' : 'off'
}

export const useSettingsStore = create<SettingsState>((set) => ({
  config: fallback,
  loaded: false,
  load: async () => {
    const config = await window.api.config.get()
    applyTheme(config.theme)
    applyAccent(config.accent ?? 'orange')
    applyFocusDim(config.focusDim)
    set({ config, loaded: true })
  },
  update: async (patch) => {
    const config = await window.api.config.set(patch)
    if (patch.theme) applyTheme(config.theme)
    if (patch.accent) applyAccent(config.accent)
    if ('focusDim' in patch) applyFocusDim(config.focusDim)
    set({ config })
  },
}))

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  applyTheme(useSettingsStore.getState().config.theme)
})
