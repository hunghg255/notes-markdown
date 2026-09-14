import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { formattingKeymap } from './commands'
import {
  emojiCompletion,
  slashCompletion,
  templateCompletion,
  wikiHeadingCompletion,
  wikiLinkCompletion,
} from './completions'
import { pasteImages } from './pasteImage'
import { typewriterScroll } from './typewriter'
import { outlineTracker } from './outlineTracker'
import { livePreview, type LivePreviewOptions } from './livePreview'
import { BlockMath, Frontmatter, HashTag, InlineMath, WikiLink } from './markdownExtensions'
import { editorHighlighting, editorTheme } from './theme'

export const markdownSupport = markdown({
  base: markdownLanguage,
  codeLanguages: languages,
  addKeymap: false,
  extensions: [GFM, Frontmatter, BlockMath, InlineMath, HashTag, WikiLink],
})

/** Extensions that are the same for every note. */
export const baseExtensions: Extension = [
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightSelectionMatches(),
  search({ top: false }),
  autocompletion({
    override: [wikiHeadingCompletion, wikiLinkCompletion, templateCompletion, slashCompletion, emojiCompletion],
    icons: false,
    activateOnTyping: true,
  }),
  EditorView.lineWrapping,
  pasteImages,
  typewriterScroll,
  outlineTracker,
  keymap.of([
    ...formattingKeymap,
    ...markdownKeymap,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...completionKeymap,
    indentWithTab,
  ]),
  markdownSupport,
  editorTheme,
  editorHighlighting,
]

export const previewCompartment = new Compartment()

export function createEditorState(doc: string, preview: LivePreviewOptions, extra: Extension = []): EditorState {
  // start below the YAML frontmatter (it is shown as a form by the properties panel)
  const fm = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(doc)
  return EditorState.create({
    doc,
    selection: { anchor: fm ? fm[0].length : 0 },
    extensions: [baseExtensions, previewCompartment.of(livePreview(preview)), extra],
  })
}
