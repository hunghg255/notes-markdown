import { EditorView, WidgetType } from '@codemirror/view'
import katex from 'katex'
import DOMPurify from 'dompurify'

export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markerFrom: number,
    readonly markerTo: number,
  ) {
    super()
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.markerFrom === this.markerFrom
  }

  toDOM(view: EditorView) {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'cm-task-checkbox'
    input.checked = this.checked
    input.setAttribute('aria-label', 'Toggle task')
    input.addEventListener('mousedown', (e) => e.preventDefault())
    input.addEventListener('click', (e) => {
      e.preventDefault()
      view.dispatch({
        changes: { from: this.markerFrom, to: this.markerTo, insert: this.checked ? '[ ]' : '[x]' },
      })
    })
    return input
  }

  ignoreEvent() {
    return true
  }
}

export class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-list-bullet'
    span.textContent = '•'
    return span
  }
  ignoreEvent() {
    return false
  }
}

export class HrWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'cm-hr-widget'
    return hr
  }
}

const katexCache = new Map<string, string>()

function renderKatex(src: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + src
  let html = katexCache.get(key)
  if (html === undefined) {
    try {
      html = katex.renderToString(src, { displayMode: display, throwOnError: true, output: 'htmlAndMathml' })
      html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      html = `<span class="cm-math-error">${escapeHtml(msg)}</span>`
    }
    if (katexCache.size > 500) katexCache.clear()
    katexCache.set(key, html)
  }
  return html
}

export class MathWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly display: boolean,
  ) {
    super()
  }
  eq(other: MathWidget) {
    return other.src === this.src && other.display === this.display
  }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? 'cm-math-block' : 'cm-math-inline'
    el.innerHTML = renderKatex(this.src, this.display)
    return el
  }
  ignoreEvent() {
    return false
  }
}

const mermaidCache = new Map<string, string>()
// beautiful-mermaid is ~2.7MB, so it is only loaded the first time a diagram is shown
let mermaidModule: Promise<typeof import('beautiful-mermaid')> | null = null
const loadMermaid = () => (mermaidModule ??= import('beautiful-mermaid'))

async function renderMermaid(src: string, dark: boolean): Promise<string> {
  const key = (dark ? 'D' : 'L') + src
  let svg = mermaidCache.get(key)
  if (svg === undefined) {
    try {
      const { renderMermaidSVG } = await loadMermaid()
      svg = renderMermaidSVG(src, {
        bg: 'var(--code-bg)',
        fg: 'var(--foreground)',
        line: 'var(--muted-foreground)',
        accent: 'var(--primary)',
        muted: 'var(--muted-foreground)',
        surface: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
        transparent: true,
      })
      svg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      svg = `<pre class="cm-math-error">${escapeHtml(msg)}</pre>`
    }
    if (mermaidCache.size > 100) mermaidCache.clear()
    mermaidCache.set(key, svg)
  }
  return svg
}

export class MermaidWidget extends WidgetType {
  constructor(readonly src: string) {
    super()
  }
  eq(other: MermaidWidget) {
    return other.src === this.src
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div')
    el.className = 'cm-mermaid-widget'
    const dark = document.documentElement.classList.contains('dark')
    const cached = mermaidCache.get((dark ? 'D' : 'L') + this.src)
    if (cached !== undefined) {
      el.innerHTML = cached
    } else {
      el.textContent = 'Rendering diagram…'
      void renderMermaid(this.src, dark).then((svg) => {
        if (!el.isConnected) return
        el.innerHTML = svg
        view.requestMeasure()
      })
    }
    return el
  }
  get estimatedHeight() {
    return 200
  }
  ignoreEvent() {
    return false
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly resolved: string,
  ) {
    super()
  }
  eq(other: ImageWidget) {
    return other.resolved === this.resolved && other.alt === this.alt
  }
  toDOM() {
    const img = document.createElement('img')
    img.className = 'cm-image-widget'
    img.src = this.resolved
    img.alt = this.alt
    img.draggable = false
    img.onerror = () => {
      const span = document.createElement('span')
      span.className = 'cm-image-broken'
      span.textContent = `⚠ image not found: ${this.src}`
      img.replaceWith(span)
    }
    return img
  }
  get estimatedHeight() {
    return 200
  }
  ignoreEvent() {
    return false
  }
}

export class CodeLangWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(other: CodeLangWidget) {
    return other.lang === this.lang
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-code-lang'
    span.textContent = this.lang
    return span
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
