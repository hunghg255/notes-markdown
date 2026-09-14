import { type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { search as searchEmoji } from 'node-emoji'
import { useVaultStore } from '@/stores/vaultStore'
import { livePreviewConfig } from './livePreview'
import { useIndexStore } from '@/stores/indexStore'
import { resolveWikiTarget } from '@/lib/notes'

/** `:smile` → 😄 */
export function emojiCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/:[a-z0-9_+-]{2,}$/i)
  if (!word) return null
  const query = word.text.slice(1).toLowerCase()
  const options: Completion[] = searchEmoji(query)
    .slice(0, 30)
    .map((e) => ({
      label: `:${e.name}:`,
      detail: e.emoji,
      apply: e.emoji,
      type: 'emoji',
    }))
  if (options.length === 0) return null
  return { from: word.from, options, filter: false }
}

interface SlashCommand {
  label: string
  detail: string
  /** text inserted in place of the `/query`; `$` marks the cursor position */
  template: string
}

const slashCommands: SlashCommand[] = [
  { label: 'h1', detail: 'Heading 1', template: '# $' },
  { label: 'h2', detail: 'Heading 2', template: '## $' },
  { label: 'h3', detail: 'Heading 3', template: '### $' },
  { label: 'todo', detail: 'Task list', template: '- [ ] $' },
  { label: 'bullet', detail: 'Bullet list', template: '- $' },
  { label: 'numbered', detail: 'Numbered list', template: '1. $' },
  { label: 'quote', detail: 'Blockquote', template: '> $' },
  { label: 'code', detail: 'Code block', template: '```\n$\n```' },
  { label: 'mermaid', detail: 'Mermaid diagram', template: '```mermaid\ngraph LR\n  A[$] --> B\n```' },
  { label: 'math', detail: 'Math block', template: '$$\n$\n$$' },
  { label: 'table', detail: 'Table', template: '| $ |  |\n| --- | --- |\n|  |  |' },
  { label: 'hr', detail: 'Divider', template: '---\n$' },
  { label: 'link', detail: 'Link', template: '[$](url)' },
  { label: 'image', detail: 'Image', template: '![$](path/to/image.png)' },
  { label: 'date', detail: 'Today', template: `${new Date().toISOString().slice(0, 10)}$` },
  { label: 'template', detail: 'Insert a template from Templates/', template: '/template $' },
]

/** `/todo` at the start of a line → snippet */
export function slashCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/^\s*\/[a-z0-9]*$/i)
  if (!word) return null
  const from = word.from + word.text.indexOf('/')
  const options: Completion[] = slashCommands.map((cmd) => ({
    label: `/${cmd.label}`,
    detail: cmd.detail,
    type: 'keyword',
    apply: (view, _completion, applyFrom, applyTo) => {
      const cursorOffset = cmd.template.indexOf('$')
      const insert = cmd.template.replace('$', '')
      view.dispatch({
        changes: { from: applyFrom, to: applyTo, insert },
        selection: { anchor: applyFrom + (cursorOffset === -1 ? insert.length : cursorOffset) },
        userEvent: 'input.complete',
      })
    },
  }))
  return { from, options, validFor: /^\/[a-z0-9]*$/i }
}

/** `[[qu` → note titles from the vault */
export function wikiLinkCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\[\[([^\[\]|#]*)$/)
  if (!word) return null
  const from = word.from + 2
  const query = word.text.slice(2).toLowerCase()
  const notes = useVaultStore.getState().notes
  const options: Completion[] = notes
    .filter((n) => !query || n.name.toLowerCase().includes(query) || n.path.toLowerCase().includes(query))
    .sort((a, b) => {
      const sa = a.name.toLowerCase().startsWith(query) ? 0 : 1
      const sb = b.name.toLowerCase().startsWith(query) ? 0 : 1
      return sa - sb || a.name.localeCompare(b.name)
    })
    .slice(0, 40)
    .map((n) => {
      const dir = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''
      return {
        label: n.name,
        detail: dir || undefined,
        type: 'text',
        apply: (view, _c, applyFrom, applyTo) => {
          // close the link if the user has not typed `]]` yet
          const after = view.state.sliceDoc(applyTo, applyTo + 2)
          const insert = n.name + (after === ']]' ? '' : ']]')
          view.dispatch({
            changes: { from: applyFrom, to: applyTo, insert },
            selection: { anchor: applyFrom + insert.length + (after === ']]' ? 2 : 0) },
            userEvent: 'input.complete',
          })
        },
      }
    })
  if (options.length === 0) return null
  return { from, options, filter: false, validFor: /^[^\[\]|#]*$/ }
}

/** Fill `{{title}}`, `{{date}}`, `{{time}}`, `{{datetime}}` placeholders. */
export function applyTemplateVars(text: string, title: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const vars: Record<string, string> = {
    title,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    datetime: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
    weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
  }
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => vars[key] ?? m)
}

/** `/template` → pick a note from `Templates/` and insert its content. */
export function templateCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/^\s*\/template\s*([^\n]*)$/i)
  if (!word) return null
  const from = word.from + word.text.indexOf('/')
  const query = (word.text.split(/\s+/)[1] ?? '').toLowerCase()
  const templates = useVaultStore.getState().notes.filter((n) => n.path.startsWith('Templates/'))
  const options: Completion[] = templates
    .filter((n) => !query || n.name.toLowerCase().includes(query))
    .map((n) => ({
      label: `/template ${n.name}`,
      detail: 'Insert template',
      type: 'keyword',
      apply: (view, _c, applyFrom, applyTo) => {
        const { notePath } = view.state.facet(livePreviewConfig)
        const title = notePath.slice(notePath.lastIndexOf('/') + 1).replace(/\.md$/i, '')
        void window.api.vault.read(n.path).then((file) => {
          const text = applyTemplateVars(file.content.replace(/\n$/, ''), title)
          view.dispatch({
            changes: { from: applyFrom, to: applyTo, insert: text },
            selection: { anchor: applyFrom + text.length },
            userEvent: 'input.complete',
          })
        })
      },
    }))
  if (options.length === 0) return null
  return { from, options, filter: false, validFor: /^\/template[^\n]*$/i }
}

/** `[[Note#he` → headings of that note (from the vault index). */
export function wikiHeadingCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\[\[([^\[\]|#]*)#([^\[\]|#]*)$/)
  if (!word) return null
  const m = /\[\[([^\[\]|#]*)#([^\[\]|#]*)$/.exec(word.text)!
  const { notePath } = context.state.facet(livePreviewConfig)
  const target = m[1].trim() ? resolveWikiTarget(m[1], notePath, useVaultStore.getState().notes) : notePath
  if (!target) return null
  const headings = useIndexStore.getState().byPath[target]?.headings ?? []
  const query = m[2].toLowerCase()
  const from = word.from + word.text.lastIndexOf('#') + 1
  const options: Completion[] = headings
    .filter((h) => !query || h.text.toLowerCase().includes(query))
    .map((h) => ({
      label: h.text,
      detail: 'h' + h.level,
      type: 'text',
      apply: (view, _c, applyFrom, applyTo) => {
        const after = view.state.sliceDoc(applyTo, applyTo + 2)
        const insert = h.text + (after === ']]' ? '' : ']]')
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert },
          selection: { anchor: applyFrom + insert.length + (after === ']]' ? 2 : 0) },
          userEvent: 'input.complete',
        })
      },
    }))
  if (options.length === 0) return null
  return { from, options, filter: false, validFor: /^[^\[\]|#]*$/ }
}
