# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-first markdown notes desktop app ([MyGo](https://github.com/egoist/mygo) 0.5 — Go backend + system webview — with Vite 8 + React 19 + Tailwind 4 + shadcn/ui + zustand + CodeMirror 6). Every note is a plain `.md` file inside a user-chosen "vault" folder (default `~/Desktop/Notes`). See `README.md` for the feature list.

## Commands

```bash
pnpm install
pnpm dev            # mygo dev: builds/restarts the Go app on .go changes, runs Vite (http://localhost:5173), regenerates the TS client
pnpm typecheck      # tsc for tsconfig.node.json (vite/mygo config) AND tsconfig.web.json (renderer + shared), then go vet
pnpm build          # mygo build: vite build -> out/renderer, embedded into the exe; app + installer in release/<os>-<arch>/
pnpm generate       # mygo generate: rewrite src/renderer/src/lib/mygo.ts from the bound Go services/events
```

Needs Go 1.27+. `mygo.config.ts` (name, identifier, version from package.json, `main: ./src/main`, devUrl/devCommand, frontendDist, bindings path) drives the CLI. There is no test runner and no lint script; `pnpm typecheck` is the only verification step. Formatting follows `.prettierrc` (no semicolons, single quotes, 120 cols, trailing commas).

**Browser-only mode:** opening http://localhost:5173 during `pnpm dev` in a normal browser has no MyGo runtime (`isMyGo()` is false), so `src/renderer/src/main.tsx` installs `src/renderer/src/lib/mockApi.ts` — an in-memory vault implementing the same `Api` interface. Useful for pure UI work; any new `Api` method must also be added to the mock or the browser mode breaks.

## Architecture

### Go backend, one typed contract

`src/shared/types.ts` holds the `Api` interface the renderer codes against and the data types (`AppConfig`, `TreeNode`, `VaultEvent`, …). The Go side mirrors the data types in `src/main/types.go` (JSON tags = TS field names). Go services are exposed with `mygo.BindAs` in `src/main/main.go`; `mygo generate` turns them into `src/renderer/src/lib/mygo.ts` (generated, never edit), and `src/renderer/src/lib/mygoApi.ts` implements `window.api` on top of it (null ↔ `""` mapping, base64 for `[]byte`, window controls via `mygo-runtime`'s `currentWindow`). Adding a backend feature touches, in order:

1. `src/shared/types.ts` — the `Api` method signature
2. `src/main/services.go` — an exported method on a bound service (`ConfigService`, `VaultService`, `ShellService`, `ExportService`, `ViewService`), usually delegating to `Vault` (`src/main/vault.go`); a first `context.Context` param gives `mygo.CallerWindow(ctx)` for dialogs
3. `pnpm generate` (or just run `pnpm dev`) to refresh `lib/mygo.ts`
4. `src/renderer/src/lib/mygoApi.ts` — wire the `Api` method to the generated client
5. `src/renderer/src/lib/mockApi.ts` — browser stand-in

The renderer only ever talks to `window.api` (typed via `src/renderer/src/api.d.ts`); only `mygoApi.ts` and `main.tsx` import `mygo-runtime`/the generated client.

Path aliases: `@/` → `src/renderer/src`, `@shared/` → `src/shared`, `@resources/` → `resources` (configured in both `vite.config.ts` and the tsconfigs).

### Go app (`src/main`, package `main`)

- `vault.go` — `Vault`: all filesystem ops. `Resolve(rel)` refuses paths that escape the vault root; every public method goes through it. Writes are atomic (`.tmp` + rename); `Create`/`Mkdir` auto-suffix ` 1`, ` 2` on collision; `Delete` uses the OS trash (`mygo.Shell.TrashItem`). Tree only lists `.md`/`.markdown` files and skips dotfiles. `exclude.go` and `indexnote.go` are Go ports of `src/shared/exclude.ts` / `indexNote.ts` (the TS versions are still used by the renderer/mock) — keep each pair in sync.
- `watcher.go` — one recursive `mygo.WatchFiles` on the vault root; create/write/remove/rename are mapped to add/change/unlink(/Dir) `VaultEvent`s and broadcast through the typed event `VaultChanged` (`"vault:changed"` → `events.vaultChanged` in TS). Dotfiles and `.tmp` files are ignored so our own atomic writes don't double-fire.
- `config.go` — `config.json` in `App.Path(PathUserData)` (`%AppData%/Notes`), cached in memory; on first run it falls back to the Electron build's `%AppData%/notes-markdown/config.json`. `ConfigService.Set` takes the patch as `map[string]any`; changing `vaultPath` re-inits the vault, restarts the watcher and emits `vaultChanged`; `theme` is also applied natively with `mygo.Theme.SetSource`.
- `main.go` — binds the services, registers the `vault` protocol (`vault://localhost/<rel>`, which WebView2 serves as `http://vault.localhost/<rel>` — see `resolveImageSrc`), and in `App.WhenReady` loads config, opens the vault and creates the window (`TitleBarStyle: TitleBarHidden`, `TitleBarHeight: 40`; MyGo draws the native controls and exposes `--mygo-titlebar-inset-*` CSS vars, used by `TabBar`). Startup work must stay inside `WhenReady`: `mygo generate` runs `main` up to `App.Run`.
- Bound methods run on their own goroutines — guard shared state (`vaultMu`, `configMu`).

**All vault paths are vault-relative with forward slashes** on both sides of IPC; `Vault.ToRel` normalises `filepath.Separator`.

### Renderer state (zustand, `src/renderer/src/stores`)

- `vaultStore` — tree + flattened `notes` list, expanded folders (persisted to localStorage), `selectedDir` (target for "new note"). Also exports the path helpers `joinPath`/`dirname`/`basename`/`noteTitle`.
- `tabsStore` — tabs keyed by note path (or the sentinel `SETTINGS_TAB`), back/forward history, persisted to localStorage.
- `editorStore` — open docs with `content` vs `saved` (dirty = they differ), debounced autosave via `scheduleSave`/`flushSave` (module-level timers), `ownWrites` mtimes.
- `settingsStore` — mirrors `AppConfig`; applies theme by toggling `.dark` on `<html>` and accent via `data-accent`.
- `uiStore` — sidebar/palette visibility.

Cross-store orchestration lives in `src/renderer/src/lib/actions.ts` (`openNote`, `closeTab`, `createNote`, `openDailyNote`, `openLinkFromEditor`, `renameNote`, `moveEntry`, `deleteEntry`). Components and hotkeys call these rather than poking multiple stores directly.

**Renames/moves fan out to four places**: `tabsStore.renamePath`, `editorStore.rename`, `editorStates.rename` (CodeMirror state cache), and a `vaultStore.refresh`. Renaming a folder must remap every descendant path (`from + '/'` prefix). Keep this in sync when adding any new path-keyed state.

### External change handling (`src/renderer/src/hooks/useVaultWatcher.ts`)

Subscribes to `window.api.vault.onChanged` (MyGo watch events are debounced 200 ms and diffed, so treat them as hints). On `change`, it re-reads the file and compares to the in-memory doc: identical content ⇒ it was our own write, ignore; different and not dirty ⇒ reload; different and dirty ⇒ currently a no-op (conflict toast is commented out). On `unlink` it closes the tab; on `vaultChanged` it closes everything and reloads settings. Tree refreshes are debounced 150 ms.

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
- Images in notes resolve to `vault://localhost/<encoded rel path>` (`http://vault.localhost/…` on Windows) via `resolveImageSrc`; the CSP in `src/renderer/index.html` allows both.
- shadcn components (`components/ui`) are generated via `pnpm dlx shadcn@latest add …` with the `radix-nova` style (`components.json`); icons are `lucide-react` (also `@hugeicons/react` is a dependency).
- Drag regions: `.app-drag` / `.app-no-drag` set both `--app-region` (MyGo) and `-webkit-app-region`.
- Global state must be zustand stores — no React Context for app state (see `.agents/skills/use-zustand`). `.agents/skills/` also vendors shadcn, Vercel React best-practices, and web-animation guidance.
