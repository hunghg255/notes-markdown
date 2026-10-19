# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-first markdown notes desktop app ([myzig](https://github.com/hunghg255/myzig) 0.1 — Zig backend + system webview — with Vite 8 + React 19 + Tailwind 4 + shadcn/ui + zustand + CodeMirror 6). Every note is a plain `.md` file inside a user-chosen "vault" folder (default `~/Desktop/Notes`). See `README.md` for the feature list.

## Commands

```bash
pnpm install
pnpm dev            # myzig dev: runs Vite (http://localhost:5173), builds/restarts the Zig app on .zig changes, regenerates the TS client
pnpm typecheck      # tsc for tsconfig.node.json (vite config) AND tsconfig.web.json (renderer + shared), then zig build test
pnpm build          # myzig build: vite build -> out/renderer, embedded into the exe; app + packages in release/<os>-<arch>/
pnpm generate       # myzig generate: rewrite src/renderer/myzig.js + myzig.d.ts from the bound Zig services/events
```

Needs Zig 0.17 and the myzig CLI (`myzig` on the PATH; `ZIG` names the compiler if `zig` isn't on it). myzig and its plugins (`watch`, `mainthread`) are **path dependencies on a checkout at `../myzig`** (`build.zig.zon`). `myzig.zon` (name, identifier, frontend `src/renderer`, frontend_dist `out/renderer`, dev_url/dev_command/build_command, out `release`) drives the CLI; `build.zig` builds `src/main/main.zig` and imports `out/renderer/myzig_assets.zig` (written by the CLI) as `assets`, or an empty list before the first `vite build`. `zig build test` runs the Zig unit tests (exclude globs, indexNote, natural sort, path escaping). There is no lint script. Formatting follows `.prettierrc` (no semicolons, single quotes, 120 cols, trailing commas) for TS and `zig fmt` for Zig.

**Headless checks:** the app takes myzig's flags, e.g. `zig-out/bin/notes.exe --myzig-eval='(async()=>{myzig.log(await myzig.call("Vault.tree"));myzig.window.close()})()'` runs JS in every page (including the hidden PDF-export page, so guard on `location.host`) without showing a window; headless runs use a temp config dir and a temp vault (`notes-headless-vault`), never the user's. Timers are throttled in hidden pages: wait by awaiting IPC calls, not `setTimeout`.

**Browser-only mode:** opening http://localhost:5173 during `pnpm dev` in a normal browser has no myzig bridge (`window.myzig` is undefined), so `src/renderer/src/main.tsx` installs `src/renderer/src/lib/mockApi.ts` — an in-memory vault implementing the same `Api` interface. Useful for pure UI work; any new `Api` method must also be added to the mock or the browser mode breaks.

## Architecture

### Zig backend, one typed contract

`src/shared/types.ts` holds the `Api` interface the renderer codes against and the data types (`AppConfig`, `TreeNode`, `VaultEvent`, …). The Zig side mirrors the data types in `src/main/types.zig` (field names = TS field names). Services are bound with `app.bind` in `src/main/main.zig` (each declares `myzig_name` and `myzig_params`); myzig generates `src/renderer/myzig.js` + `myzig.d.ts` from them at comptime (`--myzig-generate`, run by `myzig dev`/`generate`; generated, never edit, but committed so the renderer typechecks), and `src/renderer/src/lib/myzigApi.ts` implements `window.api` on top of it (`""` ↔ null mapping, base64 for binary, window controls via `myzig.window`, platform `windows` → `win32`). Adding a backend feature touches, in order:

1. `src/shared/types.ts` — the `Api` method signature
2. `src/main/services.zig` — a pub method on a bound service (`ConfigService`, `VaultService`, `ShellService`, `ExportService`, `ViewService`), usually delegating to `Vault` (`src/main/vault.zig`); a `call: *myzig.Call` param gives `call.arena` (allocate results there) and `call.window`; add its parameter names to `myzig_params`
3. `pnpm generate` (or just run `pnpm dev`) to refresh `myzig.js`/`myzig.d.ts`
4. `src/renderer/src/lib/myzigApi.ts` — wire the `Api` method to the generated client
5. `src/renderer/src/lib/mockApi.ts` — browser stand-in

The renderer only ever talks to `window.api` (typed via `src/renderer/src/api.d.ts`); only `myzigApi.ts` imports the generated client.

Path aliases: `@/` → `src/renderer/src`, `@shared/` → `src/shared`, `@resources/` → `resources` (configured in both `vite.config.ts` and the tsconfigs).

### Zig app (`src/main`)

- `vault.zig` — `Vault`: all filesystem ops (Zig 0.17 `std.Io.Dir`). `resolve(a, rel)` refuses paths that escape the vault root (`error.PathEscapesVault`); every public method goes through it. Writes are atomic (`.tmp` + rename); `create`/`mkdir` auto-suffix ` 1`, ` 2` on collision; `delete` uses the OS trash (`myzig.shell.trash`). Tree only lists `.md`/`.markdown` files and skips dotfiles and `attachments/`. `exclude.zig` and `indexnote.zig` are Zig ports of `src/shared/exclude.ts` / `indexNote.ts` (the TS versions are still used by the renderer/mock) — keep each pair in sync. Zig has no regex: the patterns are matched by hand, with the original pattern in a comment.
- `watcher.zig` — one recursive `watch.Watcher` (myzig's watch plugin) on the vault root, run with `io.concurrent`; batches reach the main thread through `mainthread.post` and are mapped to add/change/unlink(/Dir) `VaultEvent`s, broadcast as the typed event `VaultChanged` (`"vault:changed"` → `onVaultChanged` in TS). Dotfiles and `.tmp` files are ignored so our own atomic writes don't double-fire.
- `config.zig` — `config.json` in `myzig.appPath(.config, "Notes")` (`%AppData%/Notes`, where the MyGo build kept it too), cached in memory; on first run it falls back to the Electron build's `%AppData%/notes-markdown/config.json`. `ConfigService.set` takes the patch as `std.json.Value` and merges it over the current config; changing `vaultPath` re-opens the vault, restarts the watcher and emits `vaultChanged`; `theme` is also applied natively with `app.setAppearance`.
- `folder_dialog.zig` — the vault folder picker: myzig's Windows open dialog picks files only, so on Windows it drives `IFileOpenDialog` (`FOS_PICKFOLDERS`) through its COM vtable.
- `pdf.zig` — PDF export renders the HTML in a hidden window (`export://` scheme) with `page.printToPdf`. It is **asynchronous**: IPC calls arrive inside a WebView2 event handler, where WebView2 raises no events, so a bound method cannot wait for a page to load. `Export.file` therefore takes a `myzig.Channel(ExportResult)` that gets the path (or the error's message) once the file is written; `myzigApi.ts` awaits it.
- `main.zig` — creates the app, binds the services, serves the `vault` scheme (`vault://localhost/<rel>`, which WebView2 serves as `http://vault.localhost/<rel>` — see `resolveImageSrc`), and opens the window (`title_bar = .hidden`, `title_bar_height = 40`, remembered under `windowState("main")`, shown on `dom_ready`). On `dom_ready` it sets `--myzig-titlebar-inset-left/right` on `<html>` from `win.titleBar()` (used by `TabBar`). `--myzig-generate` runs `main` up to `app.run()`, so vault/window setup is skipped when `app.flags.generate_dir` is set.
- Bound methods, page events and the watcher's deliveries all run on the main thread — no locks; only the watcher's `next` loop runs on another thread.

**All vault paths are vault-relative with forward slashes** on both sides of IPC.

### Renderer state (zustand, `src/renderer/src/stores`)

- `vaultStore` — tree + flattened `notes` list, expanded folders (persisted to localStorage), `selectedDir` (target for "new note"). Also exports the path helpers `joinPath`/`dirname`/`basename`/`noteTitle`.
- `tabsStore` — tabs keyed by note path (or the sentinel `SETTINGS_TAB`), back/forward history, persisted to localStorage.
- `editorStore` — open docs with `content` vs `saved` (dirty = they differ), debounced autosave via `scheduleSave`/`flushSave` (module-level timers), `ownWrites` mtimes.
- `settingsStore` — mirrors `AppConfig`; applies theme by toggling `.dark` on `<html>` and accent via `data-accent`.
- `uiStore` — sidebar/palette visibility.

Cross-store orchestration lives in `src/renderer/src/lib/actions.ts` (`openNote`, `closeTab`, `createNote`, `openDailyNote`, `openLinkFromEditor`, `renameNote`, `moveEntry`, `deleteEntry`). Components and hotkeys call these rather than poking multiple stores directly.

**Renames/moves fan out to four places**: `tabsStore.renamePath`, `editorStore.rename`, `editorStates.rename` (CodeMirror state cache), and a `vaultStore.refresh`. Renaming a folder must remap every descendant path (`from + '/'` prefix). Keep this in sync when adding any new path-keyed state.

### External change handling (`src/renderer/src/hooks/useVaultWatcher.ts`)

Subscribes to `window.api.vault.onChanged` (watch events are debounced 200 ms and diffed from snapshots, so treat them as hints). On `change`, it re-reads the file and compares to the in-memory doc: identical content ⇒ it was our own write, ignore; different and not dirty ⇒ reload; different and dirty ⇒ currently a no-op (conflict toast is commented out). On `unlink` it closes the tab; on `vaultChanged` it closes everything and reloads settings. Tree refreshes are debounced 150 ms.

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
- Drag regions: `.app-drag` / `.app-no-drag` set both `--app-region` (myzig) and `-webkit-app-region`.
- Global state must be zustand stores — no React Context for app state (see `.agents/skills/use-zustand`). `.agents/skills/` also vendors shadcn, Vercel React best-practices, and web-animation guidance.
