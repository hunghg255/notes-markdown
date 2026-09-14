import { SETTINGS_TAB } from '@/stores/tabsStore'

/** Non-note tabs: settings and the built-in views. */
export const VIEW = {
  tasks: 'view:tasks',
  graph: 'view:graph',
  search: 'view:search',
  tag: (tag: string) => `view:tag:${tag}`,
} as const

export const isViewTab = (id: string) => id === SETTINGS_TAB || id.startsWith('view:')

export function viewTitle(id: string): string {
  if (id === SETTINGS_TAB) return 'Settings'
  if (id === VIEW.tasks) return 'Tasks'
  if (id === VIEW.graph) return 'Graph'
  if (id === VIEW.search) return 'Find & Replace'
  if (id.startsWith('view:tag:')) return `#${id.slice('view:tag:'.length)}`
  return id
}
