import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig } from '@shared/types'

const configPath = () => join(app.getPath('userData'), 'config.json')

const defaults = (): AppConfig => ({
  vaultPath: join(app.getPath('desktop'), 'Notes'),
  theme: 'dark',
  accent: 'orange',
  fontSize: 16,
  autosave: true,
})

let cache: AppConfig | null = null

export async function loadConfig(): Promise<AppConfig> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(configPath(), 'utf8')
    cache = { ...defaults(), ...JSON.parse(raw) }
  } catch {
    cache = defaults()
    await saveConfig(cache)
  }
  return cache!
}

export async function saveConfig(next: AppConfig): Promise<void> {
  cache = next
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(next, null, 2), 'utf8')
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig()
  const next = { ...current, ...patch }
  await saveConfig(next)
  return next
}
