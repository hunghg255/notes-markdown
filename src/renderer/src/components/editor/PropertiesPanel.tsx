import { useMemo, useState } from 'react'
import YAML from 'yaml'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, ArrowRight01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { liveView } from '@/editor/stateCache'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'

type Scalar = string | number | boolean | null
type PropValue = Scalar | Scalar[]

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** Parse the YAML frontmatter block at the top of a note, if any. */
function parseFrontmatter(content: string): { end: number; data: Record<string, PropValue> } | null {
  const m = FM_RE.exec(content)
  if (!m) return null
  try {
    const data = YAML.parse(m[1])
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { end: m[0].length, data: {} }
    return { end: m[0].length, data: data as Record<string, PropValue> }
  } catch {
    return null
  }
}

function writeFrontmatter(content: string, data: Record<string, PropValue>) {
  const view = liveView.current
  const existing = parseFrontmatter(content)
  const body = Object.keys(data).length ? `---\n${YAML.stringify(data).trimEnd()}\n---\n` : ''
  const to = existing ? existing.end : 0
  if (view) {
    view.dispatch({ changes: { from: 0, to, insert: body } })
  }
}

function parseInput(raw: string): PropValue {
  const t = raw.trim()
  if (t === '') return ''
  if (t === 'true') return true
  if (t === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t.includes(','))
    return t
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return t
}

const display = (v: PropValue) => (Array.isArray(v) ? v.join(', ') : v === null ? '' : String(v))

export function PropertiesPanel({ path }: { path: string }) {
  const content = useEditorStore((s) => s.docs[path]?.content ?? '')
  const focusMode = useUiStore((s) => s.focusMode)
  const collapsed = useUiStore((s) => s.sections.properties ?? false)
  const toggle = useUiStore((s) => s.toggleSection)
  const fm = useMemo(() => parseFrontmatter(content), [content])
  const [newKey, setNewKey] = useState('')
  const [adding, setAdding] = useState(false)

  if (focusMode) return null
  const data = fm?.data ?? {}
  const keys = Object.keys(data)
  if (!fm && !adding) {
    return (
      <div className="pointer-events-none absolute top-10 right-0 left-0 z-10 mx-auto flex max-w-[760px] justify-start px-8">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-muted-foreground/60 hover:text-muted-foreground pointer-events-auto text-xs"
        >
          + properties
        </button>
      </div>
    )
  }

  const update = (key: string, value: PropValue) => writeFrontmatter(content, { ...data, [key]: value })
  const remove = (key: string) => {
    const next = { ...data }
    delete next[key]
    writeFrontmatter(content, next)
  }
  const add = () => {
    const k = newKey.trim()
    if (k && !(k in data)) writeFrontmatter(content, { ...data, [k]: '' })
    setNewKey('')
    setAdding(false)
  }

  return (
    <div className="properties-panel border-border mx-auto w-full max-w-[760px] shrink-0 px-8 pt-12">
      <div className="border-border rounded-lg border text-sm">
        <button
          type="button"
          onClick={() => toggle('properties')}
          className="text-muted-foreground flex w-full items-center gap-1 px-3 py-1.5 text-xs font-semibold tracking-wider uppercase"
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            strokeWidth={2}
            className={cn('transition-transform', !collapsed && 'rotate-90')}
          />
          Properties <span className="font-normal opacity-60">{keys.length}</span>
        </button>
        {!collapsed && (
          <div className="border-border flex flex-col border-t">
            {keys.map((key) => (
              <PropertyRow
                key={key}
                name={key}
                value={data[key]}
                onChange={(v) => update(key, v)}
                onRemove={() => remove(key)}
              />
            ))}
            {adding ? (
              <div className="flex items-center gap-2 px-3 py-1.5">
                <input
                  autoFocus
                  value={newKey}
                  placeholder="property name"
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') add()
                    if (e.key === 'Escape') setAdding(false)
                  }}
                  onBlur={add}
                  className="bg-transparent text-sm outline-none"
                />
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground justify-start rounded-t-none"
                onClick={() => setAdding(true)}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                Add property
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PropertyRow({
  name,
  value,
  onChange,
  onRemove,
}: {
  name: string
  value: PropValue
  onChange: (v: PropValue) => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== display(value)) onChange(parseInput(draft))
    setDraft(null)
  }
  const isBool = typeof value === 'boolean'
  return (
    <div className="group border-border flex items-center gap-3 px-3 py-1 [&:not(:last-child)]:border-b">
      <span className="text-muted-foreground w-28 shrink-0 truncate text-xs" title={name}>
        {name}
      </span>
      {isBool ? (
        <input
          type="checkbox"
          className="task-checkbox"
          checked={value as boolean}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : (
        <input
          value={draft ?? display(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setDraft(null)
          }}
          placeholder="empty"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      )}
      {Array.isArray(value) && <span className="text-muted-foreground text-[10px] uppercase">list</span>}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove property"
        className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
