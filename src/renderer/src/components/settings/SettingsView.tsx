import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { scheduleIndexRefresh } from '@/stores/indexStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { ACCENTS, type Accent, type Theme } from '@shared/types'
import { cn } from '@/lib/utils'

export function SettingsView() {
  const config = useSettingsStore((s) => s.config)
  const update = useSettingsStore((s) => s.update)

  const changeFolder = async () => {
    const picked = await window.api.vault.pickFolder()
    if (picked) await update({ vaultPath: picked })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-8 pt-20 pb-24">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Preferences are stored in your user profile; notes stay in the folder below.
          </p>
        </div>

        <Section title="Storage" description="Every note is a plain Markdown file inside this folder.">
          <Row label="Notes folder" hint={config.vaultPath}>
            <Button variant="outline" size="sm" onClick={() => void changeFolder()}>
              Change…
            </Button>
          </Row>
          <Row label="Autosave" hint="Write changes to disk 500ms after you stop typing. Ctrl+S always saves.">
            <Switch checked={config.autosave} onCheckedChange={(v) => void update({ autosave: v })} />
          </Row>
          <Row
            label="Exclude files & folders"
            hint="One glob per line, like VS Code's files.exclude. Matches are hidden from the sidebar, search and Ctrl+P."
            stack
          >
            <ExcludeEditor />
          </Row>
        </Section>

        <Section title="Appearance">
          <Row label="Theme">
            <Select value={config.theme} onValueChange={(v) => void update({ theme: v as Theme })}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Accent color" hint="Links, checkboxes, selection and highlights.">
            <div className="flex items-center gap-2">
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  title={ACCENT_LABELS[accent]}
                  aria-label={ACCENT_LABELS[accent]}
                  aria-pressed={config.accent === accent}
                  onClick={() => void update({ accent })}
                  className={cn(
                    'size-6 rounded-full border-2 border-transparent transition-transform hover:scale-110',
                    config.accent === accent && 'border-foreground scale-110',
                  )}
                  style={{ backgroundColor: ACCENT_SWATCH[accent] }}
                />
              ))}
            </div>
          </Row>
          <Row label="Dim text in focus mode" hint="Off by default. Slightly fades lines away from the cursor while in focus mode (Ctrl+Shift+F).">
            <Switch checked={config.focusDim === true} onCheckedChange={(v) => void update({ focusDim: v })} />
          </Row>
          <Row label="Editor font size">
            <Input
              type="number"
              min={12}
              max={28}
              className="w-24"
              value={config.fontSize}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (n >= 12 && n <= 28) void update({ fontSize: n })
              }}
            />
          </Row>
        </Section>

        <Section title="Shortcuts">
          <ShortcutList />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      <div className="border-border flex flex-col rounded-lg border">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  stack,
  children,
}: {
  label: string
  hint?: string
  /** render the control below the label at full width instead of on the right */
  stack?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'px-4 py-3 [&:not(:first-child)]:border-t',
        stack ? 'flex flex-col gap-3' : 'flex items-center justify-between gap-6',
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && (
          <div className={cn('text-muted-foreground text-xs', !stack && 'truncate')} title={hint}>
            {hint}
          </div>
        )}
      </div>
      <div className={stack ? 'w-full' : 'shrink-0'}>{children}</div>
    </div>
  )
}

const parsePatterns = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** Multi-line editor for `excludePatterns`; commits on blur so the tree isn't rebuilt on every keystroke. */
function ExcludeEditor() {
  const patterns = useSettingsStore((s) => s.config.excludePatterns)
  const update = useSettingsStore((s) => s.update)
  const [text, setText] = useState(() => (patterns ?? []).join('\n'))

  // keep the draft in sync when the config changes elsewhere (e.g. vault switch reloads settings)
  useEffect(() => {
    setText((patterns ?? []).join('\n'))
  }, [patterns])

  const commit = async () => {
    const next = parsePatterns(text)
    const current = patterns ?? []
    if (next.length === current.length && next.every((p, i) => p === current[i])) return
    await update({ excludePatterns: next })
    await useVaultStore.getState().refresh()
    scheduleIndexRefresh(0)
  }

  return (
    <Textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void commit()}
      placeholder={'node_modules\n*.draft.md\nArchive/**'}
      spellCheck={false}
      rows={4}
      className="min-h-24 font-mono text-xs md:text-xs"
    />
  )
}

const ACCENT_LABELS: Record<Accent, string> = {
  orange: 'Orange',
  blue: 'Blue',
  green: 'Green',
  purple: 'Purple',
  rose: 'Rose',
}

// preview swatches (same hues as the CSS variables in index.css)
const ACCENT_SWATCH: Record<Accent, string> = {
  orange: 'oklch(0.72 0.19 45)',
  blue: 'oklch(0.68 0.17 255)',
  green: 'oklch(0.7 0.17 150)',
  purple: 'oklch(0.7 0.18 295)',
  rose: 'oklch(0.7 0.19 10)',
}

const shortcuts: [string, string][] = [
  ['Ctrl+P', 'Search notes / command palette'],
  ['Ctrl+N', 'New note'],
  ['Ctrl+D', "Today's daily note"],
  ['Ctrl+S', 'Save now'],
  ['Ctrl+W', 'Close tab'],
  ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous tab'],
  ['Ctrl+\\', 'Toggle sidebar'],
  ['Ctrl+B / Ctrl+I / Ctrl+E', 'Bold / italic / inline code'],
  ['Ctrl+K', 'Insert link'],
  ['Ctrl+Enter', 'Toggle task checkbox'],
  ['Ctrl+Alt+1…4, Ctrl+Alt+0', 'Heading level / paragraph'],
  ['Ctrl+= / Ctrl+- / Ctrl+0', 'Zoom in / out / reset'],
  ['Ctrl+F', 'Find in note'],
  ['[[', 'Link to another note (wiki-link)'],
  ['Ctrl+Shift+F', 'Focus mode (Esc to leave)'],
  ['/template', 'Insert a template from Templates/'],
  ['Ctrl+V with an image', 'Save to attachments/ and embed'],
  ['/ at line start', 'Slash commands'],
  [':emoji', 'Emoji autocomplete'],
]

function ShortcutList() {
  return (
    <div className="flex flex-col">
      {shortcuts.map(([keys, desc]) => (
        <div
          key={keys}
          className="flex items-center justify-between gap-4 px-4 py-2 text-sm [&:not(:first-child)]:border-t"
        >
          <span className="text-muted-foreground">{desc}</span>
          <kbd className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
        </div>
      ))}
    </div>
  )
}
