import { toast } from 'sonner'
import { editorStates, liveView } from '@/editor/stateCache'
import { scrollToHeading, setPendingAnchor, takePendingAnchor } from '@/editor/anchors'
import { applyTemplateVars } from '@/editor/completions'
import { useEditorStore, flushSave } from '@/stores/editorStore'
import { SETTINGS_TAB, useTabsStore } from '@/stores/tabsStore'
import { useVaultStore, basename, dirname, joinPath } from '@/stores/vaultStore'
import { useUiStore } from '@/stores/uiStore'
import { scheduleIndexRefresh } from '@/stores/indexStore'
import { VIEW, isViewTab } from './views'
import {
  DAILY_DIR,
  TEMPLATES_DIR,
  dailyNotePath,
  dailyNoteTitle,
  isExternalUrl,
  resolveRelative,
  resolveWikiTarget,
} from './notes'

export function openNote(path: string, opts?: { replace?: boolean }) {
  useTabsStore.getState().open(path, opts)
  useVaultStore.getState().expandTo(path)
  useVaultStore.getState().setSelectedDir(dirname(path))
  useUiStore.getState().pushRecent(path)
}

export function openView(id: string) {
  useTabsStore.getState().open(id)
}

export const openTasksView = () => openView(VIEW.tasks)
export const openGraphView = () => openView(VIEW.graph)
export const openSearchView = () => openView(VIEW.search)
export const openTagView = (tag: string) => openView(VIEW.tag(tag))

export function openSettings() {
  useTabsStore.getState().open(SETTINGS_TAB)
}

export async function closeTab(id: string) {
  if (!isViewTab(id)) {
    await flushSave(id)
    useEditorStore.getState().unload(id)
    editorStates.forget(id)
  }
  useTabsStore.getState().close(id)
}

/** Close every tab except `keep` (or every tab when `keep` is null). */
export async function closeOtherTabs(keep: string | null) {
  for (const t of [...useTabsStore.getState().tabs]) {
    if (t.id !== keep) await closeTab(t.id)
  }
}

/** Close the tabs to the right of `id`. */
export async function closeTabsToRight(id: string) {
  const tabs = useTabsStore.getState().tabs
  const idx = tabs.findIndex((t) => t.id === id)
  if (idx === -1) return
  for (const t of tabs.slice(idx + 1)) await closeTab(t.id)
}

export async function createNote(dir?: string, name?: string, content?: string) {
  const vault = useVaultStore.getState()
  const targetDir = dir ?? vault.selectedDir
  try {
    const path = await vault.createNote(targetDir, name, content)
    openNote(path)
    return path
  } catch (e) {
    toast.error(`Could not create note: ${String(e)}`)
    return null
  }
}

export async function createFolder(dir?: string, name?: string) {
  const vault = useVaultStore.getState()
  try {
    return await vault.createFolder(dir ?? vault.selectedDir, name)
  } catch (e) {
    toast.error(`Could not create folder: ${String(e)}`)
    return null
  }
}

export async function openDailyNote(date = new Date()) {
  const path = dailyNotePath(date)
  const exists = await window.api.vault.exists(path)
  if (!exists) {
    let content = `# ${dailyNoteTitle(date)}\n\n`
    const templatePath = `${TEMPLATES_DIR}/Daily.md`
    if (await window.api.vault.exists(templatePath)) {
      const tpl = await window.api.vault.read(templatePath)
      content = applyTemplateVars(tpl.content, dailyNoteTitle(date), date)
    }
    await window.api.vault.write(path, content)
    await useVaultStore.getState().refresh()
    useVaultStore.getState().expandTo(`${DAILY_DIR}/x`)
  }
  openNote(path)
}

/** Scroll the live editor to a heading if it is already showing `path`; otherwise the pending anchor is used on load. */
function jumpToHeading(path: string, heading: string) {
  const view = liveView.current
  if (view && useTabsStore.getState().activeId === path && editorStates.get(path) === view.state) {
    if (scrollToHeading(view, heading)) takePendingAnchor(path)
  }
}

/** Handle a click on a rendered link inside the editor. */
export async function openLinkFromEditor(href: string, fromNote: string) {
  if (href.startsWith('wiki:')) {
    const target = href.slice(5)
    const [rawName, heading = ''] = target.split('#')
    const name = rawName.trim().replace(/\.md$/i, '')
    // [[#Heading]] → jump inside the current note
    if (!name && heading) {
      jumpToHeading(fromNote, heading)
      return
    }
    const existing = resolveWikiTarget(target, fromNote, useVaultStore.getState().notes)
    if (existing) {
      if (heading) setPendingAnchor(existing, heading)
      openNote(existing)
      if (heading) jumpToHeading(existing, heading)
      return
    }
    // unresolved link → create the note next to the current one
    if (!name) return
    const created = await createNote(dirname(fromNote), name, `# ${name}\n\n`)
    if (created) toast.success(`Created ${created}`)
    return
  }
  if (isExternalUrl(href)) {
    await window.api.shell.openExternal(href)
    return
  }
  const [target, anchor] = href.split('#')
  const anchorText = anchor ? decodeURIComponent(anchor).replace(/-/g, ' ') : ''
  if (!target && anchorText) {
    jumpToHeading(fromNote, anchorText)
    return
  }
  let rel = resolveRelative(fromNote, decodeURI(target))
  if (!/\.(md|markdown)$/i.test(rel)) rel += '.md'
  if (await window.api.vault.exists(rel)) {
    if (anchorText) setPendingAnchor(rel, anchorText)
    openNote(rel)
    if (anchorText) jumpToHeading(rel, anchorText)
    return
  }
  // create the note on the fly, like wiki-style links
  const created = await createNote(dirname(rel), rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, ''))
  if (created) toast.success(`Created ${created}`)
}

export async function renameNote(path: string, newName: string) {
  const trimmed = newName.trim()
  if (!trimmed) return
  const dir = dirname(path)
  const target = dir ? `${dir}/${trimmed}` : trimmed
  try {
    await flushSave(path)
    const result = await useVaultStore.getState().rename(path, target)
    useTabsStore.getState().renamePath(path, result)
    useEditorStore.getState().rename(path, result)
    editorStates.rename(path, result)
    useUiStore.getState().renamePath(path, result)
    scheduleIndexRefresh()
  } catch (e) {
    toast.error(String(e))
  }
}

/** Move a note or folder into another folder ('' = vault root). */
export async function moveEntry(path: string, targetDir: string) {
  if (dirname(path) === targetDir) return
  if (path === targetDir || targetDir.startsWith(path + '/')) return
  const target = joinPath(targetDir, basename(path))
  try {
    for (const t of useTabsStore.getState().tabs) {
      if (t.id === path || t.id.startsWith(path + '/')) await flushSave(t.id)
    }
    const result = await useVaultStore.getState().rename(path, target)
    useTabsStore.getState().renamePath(path, result)
    useEditorStore.getState().rename(path, result)
    editorStates.rename(path, result)
    useUiStore.getState().renamePath(path, result)
    scheduleIndexRefresh()
    if (targetDir) useVaultStore.getState().expandTo(`${targetDir}/x`)
  } catch (e) {
    toast.error(String(e))
  }
}

export async function deleteEntry(path: string) {
  try {
    const tabs = useTabsStore.getState()
    for (const t of tabs.tabs) {
      if (t.id === path || t.id.startsWith(path + '/')) {
        useEditorStore.getState().unload(t.id)
        editorStates.forget(t.id)
        tabs.close(t.id)
      }
    }
    await useVaultStore.getState().remove(path)
    useUiStore.getState().forgetPath(path)
    scheduleIndexRefresh()
    toast.success('Moved to trash')
  } catch (e) {
    toast.error(String(e))
  }
}
