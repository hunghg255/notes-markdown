import DOMPurify from 'dompurify'
import katex from 'katex'
import { marked } from 'marked'
import { toast } from 'sonner'
import { useEditorStore } from '@/stores/editorStore'
import { noteTitle } from '@/stores/vaultStore'
import { resolveImageSrc } from './notes'

/** Markdown → sanitized HTML fragment (wiki links become plain text, math via KaTeX). */
export function renderMarkdown(markdown: string, notePath: string): string {
  let src = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  // ![[img]] embeds → standard images, [[Note|alias]] → alias text
  src = src.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_m, t: string) => `![](${t.trim()})`)
  src = src.replace(
    /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
    (_m, t: string, alias?: string) => `<span class="wikilink">${(alias ?? t).trim()}</span>`,
  )
  // math: protect from marked, render with katex
  const math: string[] = []
  const stash = (html: string) => `@@MATH${math.push(html) - 1}@@`
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) =>
    stash(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false })),
  )
  src = src.replace(/\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$/g, (_m, tex: string) =>
    stash(katex.renderToString(tex, { throwOnError: false })),
  )
  let html = marked.parse(src, { gfm: true, breaks: false, async: false }) as string
  html = html.replace(/@@MATH(\d+)@@/g, (_m, i: string) => math[Number(i)])
  html = html.replace(
    /<img([^>]*?)src="([^"]+)"/g,
    (_m, attrs: string, s: string) => `<img${attrs}src="${resolveImageSrc(s, notePath)}"`,
  )
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], ADD_TAGS: ['math', 'semantics', 'annotation'] })
}

const DOC_CSS = `
  :root { color-scheme: light; }
  body { font: 15px/1.7 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 760px; margin: 40px auto; padding: 0 24px; }
  h1 { font-size: 2em; margin: 0.6em 0 0.4em; } h2 { font-size: 1.5em; margin: 1.2em 0 0.4em; } h3 { font-size: 1.25em; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; background: #f2f2f2; padding: 0.15em 0.4em; border-radius: 4px; }
  pre { background: #f2f2f2; padding: 12px 16px; border-radius: 8px; overflow-x: auto; } pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 1em; color: #555; font-style: italic; }
  img { max-width: 100%; border-radius: 8px; } a, .wikilink { color: #d9531e; }
  table { border-collapse: collapse; } td, th { border: 1px solid #ddd; padding: 4px 10px; }
  input[type=checkbox] { margin-right: 0.5em; } hr { border: none; border-top: 1px solid #ddd; }
`

export function wrapHtmlDocument(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${DOC_CSS}</style></head><body>${body}</body></html>`
}

async function contentOf(path: string): Promise<string> {
  const doc = useEditorStore.getState().docs[path]
  if (doc) {
    await useEditorStore.getState().save(path)
    return doc.content
  }
  return (await window.api.vault.read(path)).content
}

export async function exportNote(path: string, kind: 'pdf' | 'html' | 'md') {
  try {
    const content = await contentOf(path)
    const title = noteTitle(path)
    const payload = kind === 'md' ? content : wrapHtmlDocument(title, renderMarkdown(content, path))
    const saved = await window.api.export.file(kind, title, payload)
    if (saved) toast.success(`Exported ${saved}`)
  } catch (e) {
    toast.error(String(e))
  }
}

export async function copyNoteAsHtml(path: string) {
  try {
    const content = await contentOf(path)
    const html = renderMarkdown(content, path)
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([content], { type: 'text/plain' }),
      }),
    ])
    toast.success('Copied as rich text')
  } catch (e) {
    toast.error(String(e))
  }
}

export async function copyNoteAsMarkdown(path: string) {
  await navigator.clipboard.writeText(await contentOf(path))
  toast.success('Copied markdown')
}
