export type Theme = 'dark' | 'light' | 'system'

export const ACCENTS = ['orange', 'blue', 'green', 'purple', 'rose'] as const
export type Accent = (typeof ACCENTS)[number]

export interface AppConfig {
  vaultPath: string
  theme: Theme
  accent: Accent
  fontSize: number
  autosave: boolean
}

export interface TreeNode {
  name: string
  /** path relative to vault root, using forward slashes */
  path: string
  type: 'dir' | 'file'
  mtime: number
  children?: TreeNode[]
}

export interface NoteFile {
  content: string
  mtime: number
}

export interface SearchHit {
  path: string
  line: number
  preview: string
}

export interface NoteTask {
  line: number
  text: string
  done: boolean
}

export interface NoteHeading {
  level: number
  text: string
  line: number
}

/** Lightweight per-note metadata extracted by scanning the vault. */
export interface NoteIndex {
  path: string
  name: string
  mtime: number
  tags: string[]
  /** wiki-link / markdown-link targets (raw, unresolved) */
  links: string[]
  tasks: NoteTask[]
  headings: NoteHeading[]
  /** first non-heading, non-empty line */
  excerpt: string
}

export interface ReplaceResult {
  files: number
  replacements: number
}

export type VaultEvent =
  | { type: 'add' | 'change' | 'unlink'; path: string }
  | { type: 'addDir' | 'unlinkDir'; path: string }
  | { type: 'vaultChanged'; path: string }

export const IPC = {
  configGet: 'config:get',
  configSet: 'config:set',
  vaultPickFolder: 'vault:pickFolder',
  vaultTree: 'vault:tree',
  vaultRead: 'vault:read',
  vaultWrite: 'vault:write',
  vaultCreate: 'vault:create',
  vaultMkdir: 'vault:mkdir',
  vaultRename: 'vault:rename',
  vaultDelete: 'vault:delete',
  vaultSearch: 'vault:search',
  vaultExists: 'vault:exists',
  vaultScan: 'vault:scan',
  vaultWriteBinary: 'vault:writeBinary',
  vaultReplace: 'vault:replace',
  exportFile: 'export:file',
  shellOpenExternal: 'shell:openExternal',
  shellShowInFolder: 'shell:showInFolder',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  eventVaultChanged: 'vault:changed',
} as const

export interface Api {
  config: {
    get(): Promise<AppConfig>
    set(patch: Partial<AppConfig>): Promise<AppConfig>
  }
  vault: {
    pickFolder(): Promise<string | null>
    tree(): Promise<TreeNode[]>
    read(rel: string): Promise<NoteFile>
    write(rel: string, content: string): Promise<{ mtime: number }>
    create(rel: string, content?: string): Promise<string>
    mkdir(rel: string): Promise<string>
    rename(from: string, to: string): Promise<string>
    delete(rel: string): Promise<void>
    search(query: string): Promise<SearchHit[]>
    exists(rel: string): Promise<boolean>
    scan(): Promise<NoteIndex[]>
    writeBinary(rel: string, data: Uint8Array): Promise<string>
    /** literal find/replace across the given notes (or all when paths is empty) */
    replace(find: string, replacement: string, paths: string[], matchCase: boolean): Promise<ReplaceResult>
    onChanged(cb: (e: VaultEvent) => void): () => void
  }
  shell: {
    openExternal(url: string): Promise<void>
    showInFolder(rel: string): Promise<void>
  }
  export: {
    /** show a save dialog and write the file; kind 'pdf' renders the html via Chromium */
    file(kind: 'pdf' | 'html' | 'md', suggestedName: string, content: string): Promise<string | null>
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  platform: NodeJS.Platform
}
