# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-first markdown notes desktop app (Electron 44 + electron-vite 6 + Vite 8 + React 19 + Tailwind 4 + shadcn/ui + zustand + CodeMirror 6). Every note is a plain `.md` file inside a user-chosen "vault" folder (default `~/Desktop/Notes`). See `README.md` for the feature list.

## Commands

```bash
pnpm install
node node_modules/electron/install.js   # only if pnpm skipped Electron's postinstall
pnpm dev            # Electron + Vite HMR (also serves renderer at http://localhost:5173)
pnpm typecheck      # tsc for node (main/preload/shared) AND web (renderer) projects
pnpm build          # bundles to out/
pnpm dist           # build + electron-builder installer (NSIS / dmg / AppImage)
```

There is no test runner and no lint script; `pnpm typecheck` is the only verification step. Formatting follows `.prettierrc` (no semicolons, single quotes, 120 cols, trailing commas).

**Browser-only mode:** opening http://localhost:5173 during `pnpm dev` in a normal browser has no `window.api` (no preload), so `src/renderer/src/main.tsx` installs `src/renderer/src/lib/mockApi.ts` — an in-memory vault implementing the same `Api` interface. Useful for pure UI work; any new `Api` method must also be added to the mock or the browser mode breaks.

## Architecture

### Three processes, one typed contract

`src/shared/types.ts` is the single source of truth for the main↔renderer boundary: the `IPC` channel-name constants, the `Api` interface, and the data types (`AppConfig`, `TreeNode`, `VaultEvent`, …). Adding an IPC feature touches, in order:

1. `src/shared/types.ts` — add the channel constant and the `Api` method signature
2. `src/main/ipc.ts` — `ipcMain.handle(...)` delegating to `Vault` (`src/main/vault.ts`) or config
3. `src/preload/index.ts` — the `contextBridge` implementation of the `Api` method
4. `src/renderer/src/lib/mockApi.ts` — browser stand-in

The renderer only ever talks to `window.api` (typed via `src/preload/index.d.ts`); it never imports from `electron`.

Path aliases: `@/` → `src/renderer/src`, `@shared/` → `src/shared`, `@resources/` → `resources` (configured in both `electron.vite.config.ts` and the tsconfigs).

### Main process (`src/main`)

- `vault.ts` — `Vault` class: all filesystem ops. `resolve(rel)` refuses paths that escape the vault root; every public method goes through it. Writes are atomic (`.tmp` + rename); `create`/`mkdir` auto-suffix ` 1`, ` 2` on collision; `delete` uses the OS trash. Tree only lists `.md`/`.markdown` files and skips dotfiles.
- `watcher.ts` — one chokidar watcher on the vault root that forwards add/change/unlink(/Dir) events to the renderer as `VaultEvent` over `IPC.eventVaultChanged`. `.tmp` files are ignored so our own atomic writes don't double-fire.
- `config.ts` — `config.json` in Electron `userData`, cached in memory. Changing `vaultPath` through `config:set` triggers `switchVault` in `ipc.ts`, which re-inits the vault, restarts the watcher, and emits a `vaultChanged` event.
- `index.ts` — frameless window (`titleBarStyle: 'hidden'`, custom overlay on Windows/Linux) and the privileged `vault://local/<rel>` protocol that serves images/attachments from inside the vault.

**All vault paths are vault-relative with forward slashes** on both sides of IPC; `Vault.toRel` normalises `path.sep`.

### Renderer state (zustand, `src/renderer/src/stores`)

- `vaultStore` — tree + flattened `notes` list, expanded folders (persisted to localStorage), `selectedDir` (target for "new note"). Also exports the path helpers `joinPath`/`dirname`/`basename`/`noteTitle`.
- `tabsStore` — tabs keyed by note path (or the sentinel `SETTINGS_TAB`), back/forward history, persisted to localStorage.
- `editorStore` — open docs with `content` vs `saved` (dirty = they differ), debounced autosave via `scheduleSave`/`flushSave` (module-level timers), `ownWrites` mtimes.
- `settingsStore` — mirrors `AppConfig`; applies theme by toggling `.dark` on `<html>` and accent via `data-accent`.
- `uiStore` — sidebar/palette visibility.

Cross-store orchestration lives in `src/renderer/src/lib/actions.ts` (`openNote`, `closeTab`, `createNote`, `openDailyNote`, `openLinkFromEditor`, `renameNote`, `moveEntry`, `deleteEntry`). Components and hotkeys call these rather than poking multiple stores directly.

**Renames/moves fan out to four places**: `tabsStore.renamePath`, `editorStore.rename`, `editorStates.rename` (CodeMirror state cache), and a `vaultStore.refresh`. Renaming a folder must remap every descendant path (`from + '/'` prefix). Keep this in sync when adding any new path-keyed state.

### External change handling (`src/renderer/src/hooks/useVaultWatcher.ts`)

Subscribes to `window.api.vault.onChanged`. On `change`, it re-reads the file and compares to the in-memory doc: identical content ⇒ it was our own write, ignore; different and not dirty ⇒ reload; different and dirty ⇒ currently a no-op (conflict toast is commented out). On `unlink` it closes the tab; on `vaultChanged` it closes everything and reloads settings. Tree refreshes are debounced 150 ms.

### Editor (`src/renderer/src/editor`)

- `setup.ts` — `baseExtensions` (shared across all notes) and `createEditorState`. Live preview is inside a `Compartment` so it can be reconfigured per note. Autocompletion is `override`-only: `wikiLinkCompletion` (`[[`), `slashCompletion` (`/`), `emojiCompletion` (`:`) in `completions.ts`.
- `markdownExtensions.ts` — custom Lezer markdown extensions (`Frontmatter`, `BlockMath`, `InlineMath`, `HashTag`, `WikiLink`) layered on GFM.
- `livePreview/index.ts` — a `StateField<DecorationSet>` that walks the syntax tree and hides/replaces markup (Obsidian-style). Nodes on lines touched by the cursor/selection are left "active" (raw markdown visible). `livePreviewConfig` is a Facet carrying `notePath`, `openLink`, `resolveImage` so widgets can resolve links/images relative to the note. `widgets.ts` holds the `WidgetType`s (checkbox, image, KaTeX math, Mermaid via `beautiful-mermaid`, …); HTML output goes through DOMPurify.
- `stateCache.ts` — per-note `EditorState` map so switching tabs keeps undo history and cursor. `MarkdownEditor.tsx` creates **one** `EditorView` and swaps states with `view.setState` when the active path changes; the `dispatchTransactions` hook is where edits flow into `editorStore` and autosave.
- `theme.ts` — CodeMirror theme reads the app's CSS variables (`--foreground`, `--primary`, `--syntax-*`, `--editor-font-size`) so it follows light/dark automatically. Add new colours as CSS vars in `index.css` (`:root` + `.dark`), not hard-coded in the theme.
- `commands.ts` — editor-local keybindings (`formattingKeymap`). App-wide shortcuts are in `hooks/useHotkeys.ts` (`Ctrl+P` palette, `Ctrl+N` new, `Ctrl+D` daily, `Ctrl+W` close, `Ctrl+\` sidebar, `Ctrl+Tab`, `Alt+←/→`). `Ctrl+S` is handled in `MarkdownEditor.tsx`.

### Conventions worth knowing

- Notes convention: daily notes live in `Daily Notes/<Weekday, Month D, YYYY>.md`; if `Templates/Daily.md` exists it is used with `{{title}}`/`{{date}}` substitution (`lib/notes.ts`, `lib/actions.ts`).
- `[[wiki links]]` resolve by exact vault path first, then by title (case-insensitive), preferring the same folder; unresolved links create the note next to the current one on click.
- Images in notes resolve to `vault://local/<encoded rel path>` (`resolveImageSrc`).
- shadcn components (`components/ui`) are generated via `pnpm dlx shadcn@latest add …` with the `radix-nova` style (`components.json`); icons are `lucide-react` (also `@hugeicons/react` is a dependency).
- Global state must be zustand stores — no React Context for app state (see `.agents/skills/use-zustand`). `.agents/skills/` also vendors shadcn, Vercel React best-practices, and web-animation guidance.
