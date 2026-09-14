import type { MarkdownConfig } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

const DOLLAR = 36

/** `$...$` and `$$...$$` inline math. */
export const InlineMath: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: tags.special(tags.content) },
    { name: 'InlineMathMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Escape',
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1
        const double = cx.char(pos + 1) === DOLLAR
        const len = double ? 2 : 1
        const contentStart = pos + len
        if (contentStart >= cx.end) return -1
        // single `$` must be followed by a non-space char (avoid "$5 and $6")
        if (!double && /\s/.test(String.fromCharCode(cx.char(contentStart)))) return -1
        for (let i = contentStart; i < cx.end; i++) {
          if (cx.char(i) === 92 /* \ */) {
            i++
            continue
          }
          if (cx.char(i) !== DOLLAR) continue
          if (double && cx.char(i + 1) !== DOLLAR) continue
          if (i === contentStart) return -1
          if (!double && /\s/.test(String.fromCharCode(cx.char(i - 1)))) continue
          const end = i + len
          return cx.addElement(
            cx.elt('InlineMath', pos, end, [
              cx.elt('InlineMathMark', pos, contentStart),
              cx.elt('InlineMathMark', i, end),
            ]),
          )
        }
        return -1
      },
    },
  ],
}

/** `$$` on its own line ... `$$` block math. */
export const BlockMath: MarkdownConfig = {
  defineNodes: [
    { name: 'BlockMath', block: true, style: tags.special(tags.content) },
    { name: 'BlockMathMark', style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      parse(cx, line) {
        const text = line.text.slice(line.pos)
        if (!text.startsWith('$$')) return false
        const start = cx.lineStart + line.pos
        const rest = text.slice(2).trim()
        // single line `$$ x $$`
        if (rest.length >= 2 && rest.endsWith('$$')) {
          const end = cx.lineStart + line.text.length
          cx.addElement(
            cx.elt('BlockMath', start, end, [
              cx.elt('BlockMathMark', start, start + 2),
              cx.elt('BlockMathMark', end - 2, end),
            ]),
          )
          cx.nextLine()
          return true
        }
        const marks = [cx.elt('BlockMathMark', start, start + 2)]
        while (cx.nextLine()) {
          const t = line.text.slice(line.basePos)
          const idx = t.indexOf('$$')
          if (idx !== -1 && t.slice(idx + 2).trim() === '') {
            const mFrom = cx.lineStart + line.basePos + idx
            marks.push(cx.elt('BlockMathMark', mFrom, mFrom + 2))
            const end = cx.lineStart + line.text.length
            cx.addElement(cx.elt('BlockMath', start, end, marks))
            cx.nextLine()
            return true
          }
        }
        cx.addElement(cx.elt('BlockMath', start, cx.prevLineEnd(), marks))
        return true
      },
      endLeaf(_cx, line) {
        return line.text.slice(line.pos).startsWith('$$')
      },
    },
  ],
}

const HASH = 35

/** `#tag` inline tags (not headings: those are parsed at block level). */
export const HashTag: MarkdownConfig = {
  defineNodes: [{ name: 'HashTag', style: tags.labelName }],
  parseInline: [
    {
      name: 'HashTag',
      after: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== HASH) return -1
        const prev = pos > cx.offset ? cx.char(pos - 1) : 32
        if (!/\s/.test(String.fromCharCode(prev)) && pos !== cx.offset) return -1
        let i = pos + 1
        while (i < cx.end && /[\p{L}\p{N}_\-/]/u.test(String.fromCharCode(cx.char(i)))) i++
        if (i === pos + 1) return -1
        // pure numbers like "#1" are not tags
        if (/^\d+$/.test(cx.slice(pos + 1, i))) return -1
        return cx.addElement(cx.elt('HashTag', pos, i))
      },
    },
  ],
}

/** YAML frontmatter fenced by `---` at the very start of the document. */
export const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: tags.meta },
    { name: 'FrontmatterMark', style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || line.text !== '---') return false
        const marks = [cx.elt('FrontmatterMark', 0, 3)]
        while (cx.nextLine()) {
          if (line.text === '---') {
            const end = cx.lineStart + 3
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, end))
            cx.addElement(cx.elt('Frontmatter', 0, end, marks))
            cx.nextLine()
            return true
          }
        }
        cx.addElement(cx.elt('Frontmatter', 0, cx.prevLineEnd(), marks))
        return true
      },
    },
  ],
}

const LBRACKET = 91
const BANG = 33

/**
 * `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]` wiki links and `![[image.png]]` embeds.
 * Registered before the standard Link parser so `[[` is not consumed as a link.
 */
export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: tags.link },
    { name: 'WikiEmbed', style: tags.link },
    { name: 'WikiLinkMark', style: tags.processingInstruction },
    { name: 'WikiLinkTarget', style: tags.link },
    { name: 'WikiLinkAlias', style: tags.link },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG
        const start = embed ? pos + 1 : pos
        if (next !== LBRACKET && !embed) return -1
        if (cx.char(start) !== LBRACKET || cx.char(start + 1) !== LBRACKET) return -1
        const contentStart = start + 2
        let pipe = -1
        for (let i = contentStart; i < cx.end - 1; i++) {
          const c = cx.char(i)
          if (c === 10 || c === LBRACKET) return -1 // no newlines / nested brackets
          if (c === 124 /* | */ && pipe === -1) pipe = i
          if (c === 93 /* ] */ && cx.char(i + 1) === 93) {
            if (i === contentStart) return -1
            const end = i + 2
            const children = [cx.elt('WikiLinkMark', pos, contentStart)]
            if (pipe !== -1) {
              children.push(cx.elt('WikiLinkTarget', contentStart, pipe))
              children.push(cx.elt('WikiLinkMark', pipe, pipe + 1))
              children.push(cx.elt('WikiLinkAlias', pipe + 1, i))
            } else {
              children.push(cx.elt('WikiLinkTarget', contentStart, i))
            }
            children.push(cx.elt('WikiLinkMark', i, end))
            return cx.addElement(cx.elt(embed ? 'WikiEmbed' : 'WikiLink', pos, end, children))
          }
        }
        return -1
      },
    },
  ],
}
