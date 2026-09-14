import { syntaxTree } from '@codemirror/language'
import { Facet, StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'
import {
  BulletWidget,
  CheckboxWidget,
  CodeLangWidget,
  HrWidget,
  ImageWidget,
  MathWidget,
  MermaidWidget,
} from './widgets'

export interface LivePreviewOptions {
  /** vault-relative path of the note being edited (used to resolve relative links / images) */
  notePath: string
  openLink: (href: string, notePath: string) => void
  resolveImage: (src: string, notePath: string) => string
}

export const livePreviewConfig = Facet.define<LivePreviewOptions, LivePreviewOptions>({
  combine: (values) => values[0] ?? { notePath: '', openLink: () => {}, resolveImage: (s) => s },
})

const hide = Decoration.replace({})
const syntaxMark = Decoration.mark({ class: 'cm-syntax-mark' })
const headerMark = Decoration.mark({ class: 'cm-header-mark' })
const listMark = Decoration.mark({ class: 'cm-list-mark' })
const inlineCode = Decoration.mark({ class: 'cm-inline-code' })
const hashtag = Decoration.mark({ class: 'cm-hashtag' })
const taskDone = Decoration.mark({ class: 'cm-task-done' })
const fenceMark = Decoration.mark({ class: 'cm-codeblock-fence' })
const bulletWidget = Decoration.replace({ widget: new BulletWidget() })
const hrWidget = Decoration.replace({ widget: new HrWidget() })

const lineClass = (cls: string) => Decoration.line({ class: cls })
const headingLine = [1, 2, 3, 4, 5, 6].map((n) => lineClass(`cm-h${n}`))
const quoteLine = lineClass('cm-blockquote')
const codeLine = lineClass('cm-codeblock')
const codeLineStart = lineClass('cm-codeblock cm-codeblock-start')
const codeLineEnd = lineClass('cm-codeblock cm-codeblock-end')
const codeLineBoth = lineClass('cm-codeblock cm-codeblock-start cm-codeblock-end')
const tableLine = lineClass('cm-table-line')
const frontmatterLine = lineClass('cm-frontmatter')

function buildDecorations(state: EditorState): DecorationSet {
  const config = state.facet(livePreviewConfig)
  const decos: Range<Decoration>[] = []
  const doc = state.doc

  const ranges = state.selection.ranges.map((r) => ({
    from: doc.lineAt(r.from).from,
    to: doc.lineAt(r.to).to,
  }))
  /** true when a cursor / selection touches any line that the node occupies */
  const isActive = (from: number, to: number) => {
    const lineFrom = doc.lineAt(from).from
    const lineTo = doc.lineAt(to).to
    for (const r of ranges) if (r.from <= lineTo && r.to >= lineFrom) return true
    return false
  }

  const addLineDeco = (from: number, to: number, deco: Decoration) => {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      decos.push(deco.range(line.from))
      if (line.to >= to || line.to >= doc.length) break
      pos = line.to + 1
    }
  }

  const children = (node: SyntaxNode, name: string): SyntaxNode[] => {
    const out: SyntaxNode[] = []
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c)
    return out
  }

  const hideRange = (from: number, to: number) => {
    if (to > from) decos.push(hide.range(from, to))
  }

  /** hide a marker plus one following space, if present */
  const hideMarkAndSpace = (from: number, to: number) => {
    const next = doc.sliceString(to, to + 1)
    hideRange(from, next === ' ' ? to + 1 : to)
  }

  const handleNode = (ref: SyntaxNodeRef): boolean | void => {
    const { name, from, to } = ref
    const active = () => isActive(from, to)

    switch (name) {
      case 'ATXHeading1':
      case 'ATXHeading2':
      case 'ATXHeading3':
      case 'ATXHeading4':
      case 'ATXHeading5':
      case 'ATXHeading6': {
        const level = Number(name.slice(-1))
        addLineDeco(from, to, headingLine[level - 1])
        const marks = children(ref.node, 'HeaderMark')
        for (const m of marks) {
          if (level === 1 || active()) decos.push(headerMark.range(m.from, m.to))
          else hideMarkAndSpace(m.from, m.to)
        }
        return
      }
      case 'SetextHeading1':
      case 'SetextHeading2': {
        const level = Number(name.slice(-1))
        const firstLine = doc.lineAt(from)
        decos.push(headingLine[level - 1].range(firstLine.from))
        for (const m of children(ref.node, 'HeaderMark')) decos.push(headerMark.range(m.from, m.to))
        return
      }
      case 'Emphasis':
      case 'StrongEmphasis':
      case 'Strikethrough': {
        if (active()) return
        const markName = name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
        for (const m of children(ref.node, markName)) hideRange(m.from, m.to)
        return
      }
      case 'InlineCode': {
        const marks = children(ref.node, 'CodeMark')
        if (marks.length < 2) return
        const [open, close] = [marks[0], marks[marks.length - 1]]
        decos.push(inlineCode.range(open.to, close.from))
        if (!active()) {
          hideRange(open.from, open.to)
          hideRange(close.from, close.to)
        }
        return false
      }
      case 'Escape': {
        if (!active()) hideRange(from, from + 1)
        return
      }
      case 'HashTag': {
        decos.push(hashtag.range(from, to))
        return
      }
      case 'Link': {
        const marks = children(ref.node, 'LinkMark')
        const url = children(ref.node, 'URL')[0]
        if (marks.length < 2) return
        const textFrom = marks[0].to
        const textTo = marks[1].from
        const href = url ? doc.sliceString(url.from, url.to) : doc.sliceString(textFrom, textTo)
        if (textTo > textFrom) {
          decos.push(
            Decoration.mark({ class: 'cm-link-rendered', attributes: { 'data-href': href, title: href } }).range(
              textFrom,
              textTo,
            ),
          )
        }
        if (!active()) {
          hideRange(from, textFrom)
          hideRange(textTo, to)
          return false
        }
        return
      }
      case 'WikiLink': {
        const target = children(ref.node, 'WikiLinkTarget')[0]
        if (!target) return
        const alias = children(ref.node, 'WikiLinkAlias')[0]
        const shown = alias ?? target
        const href = 'wiki:' + doc.sliceString(target.from, target.to).trim()
        decos.push(
          Decoration.mark({
            class: 'cm-link-rendered cm-wikilink',
            attributes: { 'data-href': href, title: href.slice(5) },
          }).range(shown.from, shown.to),
        )
        if (!active()) {
          hideRange(from, shown.from)
          hideRange(shown.to, to)
          return false
        }
        for (const m of children(ref.node, 'WikiLinkMark')) decos.push(syntaxMark.range(m.from, m.to))
        return false
      }
      case 'WikiEmbed': {
        const target = children(ref.node, 'WikiLinkTarget')[0]
        if (!target) return
        const src = doc.sliceString(target.from, target.to).trim()
        if (active() || !/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(src)) {
          for (const m of children(ref.node, 'WikiLinkMark')) decos.push(syntaxMark.range(m.from, m.to))
          return false
        }
        const widget = new ImageWidget(src, src, config.resolveImage(src, config.notePath))
        const line = doc.lineAt(from)
        decos.push(Decoration.replace({ widget, block: line.from === from && line.to === to }).range(from, to))
        return false
      }
      case 'Autolink': {
        const marks = children(ref.node, 'LinkMark')
        const url = children(ref.node, 'URL')[0]
        const inner = url ?? { from: from + 1, to: to - 1 }
        const href = doc.sliceString(inner.from, inner.to)
        decos.push(
          Decoration.mark({ class: 'cm-link-rendered', attributes: { 'data-href': href } }).range(inner.from, inner.to),
        )
        if (!active()) for (const m of marks) hideRange(m.from, m.to)
        return false
      }
      case 'URL': {
        // bare URL (GFM autolink) — not inside a Link/Image
        const parent = ref.node.parent?.name
        if (parent === 'Link' || parent === 'Image' || parent === 'Autolink') return
        const href = doc.sliceString(from, to)
        decos.push(Decoration.mark({ class: 'cm-link-rendered', attributes: { 'data-href': href } }).range(from, to))
        return
      }
      case 'Image': {
        if (active()) return
        const url = children(ref.node, 'URL')[0]
        if (!url) return
        const marks = children(ref.node, 'LinkMark')
        const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : ''
        const src = doc.sliceString(url.from, url.to)
        const widget = new ImageWidget(src, alt, config.resolveImage(src, config.notePath))
        const line = doc.lineAt(from)
        const wholeLine = line.from === from && line.to === to
        decos.push(Decoration.replace({ widget, block: wholeLine }).range(from, to))
        return false
      }
      case 'ListItem': {
        const mark = children(ref.node, 'ListMark')[0]
        if (!mark) return
        const task = children(ref.node, 'Task')[0]
        const inBullet = ref.node.parent?.name === 'BulletList'
        if (task) {
          const marker = children(task, 'TaskMarker')[0]
          if (!marker) return
          const checked = /x/i.test(doc.sliceString(marker.from, marker.to))
          if (checked) decos.push(taskDone.range(marker.to, task.to))
          if (isActive(mark.from, marker.to)) {
            decos.push(listMark.range(mark.from, mark.to))
            decos.push(syntaxMark.range(marker.from, marker.to))
          } else {
            const after = doc.sliceString(marker.to, marker.to + 1) === ' ' ? marker.to + 1 : marker.to
            decos.push(
              Decoration.replace({ widget: new CheckboxWidget(checked, marker.from, marker.to) }).range(
                mark.from,
                after,
              ),
            )
          }
          return
        }
        if (inBullet && !isActive(mark.from, mark.to)) {
          const after = doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to
          decos.push(bulletWidget.range(mark.from, after))
        } else {
          decos.push(listMark.range(mark.from, mark.to))
        }
        return
      }
      case 'Blockquote': {
        addLineDeco(from, to, quoteLine)
        const act = active()
        for (const m of children(ref.node, 'QuoteMark')) {
          if (act) decos.push(syntaxMark.range(m.from, m.to))
          else hideMarkAndSpace(m.from, m.to)
        }
        return
      }
      case 'HorizontalRule': {
        if (active()) decos.push(syntaxMark.range(from, to))
        else decos.push(hrWidget.range(from, to))
        return false
      }
      case 'FencedCode': {
        const firstLine = doc.lineAt(from)
        const lastLine = doc.lineAt(to)
        const info = children(ref.node, 'CodeInfo')[0]
        const lang = info ? doc.sliceString(info.from, info.to).trim() : ''
        const marks = children(ref.node, 'CodeMark')
        const act = active()

        if (lang.toLowerCase() === 'mermaid' && !act && marks.length >= 2) {
          const src = doc.sliceString(firstLine.to + 1, Math.max(firstLine.to + 1, lastLine.from - 1))
          decos.push(
            Decoration.replace({ widget: new MermaidWidget(src), block: true }).range(firstLine.from, lastLine.to),
          )
          return false
        }

        if (firstLine.number === lastLine.number) {
          decos.push(codeLineBoth.range(firstLine.from))
        } else {
          decos.push(codeLineStart.range(firstLine.from))
          if (lastLine.number - firstLine.number > 1) addLineDeco(firstLine.to + 1, lastLine.from, codeLine)
          decos.push(codeLineEnd.range(lastLine.from))
        }
        for (const m of marks) {
          if (act) decos.push(fenceMark.range(m.from, m.to))
          else hideRange(m.from, m.to)
        }
        if (info) {
          if (act) decos.push(fenceMark.range(info.from, info.to))
          else hideRange(info.from, info.to)
        }
        if (lang) decos.push(Decoration.widget({ widget: new CodeLangWidget(lang), side: 1 }).range(firstLine.to))
        return
      }
      case 'CodeBlock': {
        addLineDeco(from, to, codeLine)
        return
      }
      case 'BlockMath': {
        const marks = children(ref.node, 'BlockMathMark')
        if (active() || marks.length < 2) {
          for (const m of marks) decos.push(syntaxMark.range(m.from, m.to))
          return
        }
        const src = doc.sliceString(marks[0].to, marks[1].from).trim()
        const firstLine = doc.lineAt(from)
        const lastLine = doc.lineAt(to)
        decos.push(
          Decoration.replace({ widget: new MathWidget(src, true), block: true }).range(firstLine.from, lastLine.to),
        )
        return false
      }
      case 'InlineMath': {
        const marks = children(ref.node, 'InlineMathMark')
        if (active() || marks.length < 2) {
          for (const m of marks) decos.push(syntaxMark.range(m.from, m.to))
          return
        }
        const src = doc.sliceString(marks[0].to, marks[1].from)
        decos.push(Decoration.replace({ widget: new MathWidget(src, false) }).range(from, to))
        return false
      }
      case 'Table': {
        addLineDeco(from, to, tableLine)
        return
      }
      case 'Frontmatter': {
        // the properties panel shows this block as a form; hide the raw YAML until the cursor enters it
        if (!active()) {
          decos.push(Decoration.replace({ block: true }).range(doc.lineAt(from).from, doc.lineAt(to).to))
          return false
        }
        addLineDeco(from, to, frontmatterLine)
        return false
      }
      default:
        return
    }
  }

  syntaxTree(state).iterate({ enter: handleNode })
  return Decoration.set(decos, true)
}

/**
 * Block-level replacements (mermaid, display math, images) must come from a
 * StateField rather than a ViewPlugin, so the whole decoration set lives here.
 * Recomputed on every doc / selection change; fast enough for note-sized files.
 */
export const livePreviewField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildDecorations(tr.state)
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

const linkClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false
    const target = (event.target as HTMLElement).closest?.('.cm-link-rendered') as HTMLElement | null
    if (!target) return false
    const href = target.getAttribute('data-href')
    if (!href) return false
    // only "open" when the link is rendered (cursor not on that line), or on ctrl/cmd-click
    const pos = view.posAtDOM(target)
    const line = view.state.doc.lineAt(pos)
    const cursorOnLine = view.state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from)
    if (cursorOnLine && !(event.ctrlKey || event.metaKey)) return false
    event.preventDefault()
    const config = view.state.facet(livePreviewConfig)
    config.openLink(href, config.notePath)
    return true
  },
})

export function livePreview(options: LivePreviewOptions) {
  return [livePreviewConfig.of(options), livePreviewField, linkClickHandler]
}

export function isDocActive(state: EditorState, from: number, to: number) {
  const line = state.doc.lineAt(from)
  const lineTo = state.doc.lineAt(to).to
  return state.selection.ranges.some((r) => r.from <= lineTo && r.to >= line.from)
}
