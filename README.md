# Notes

Local-first markdown notes app. Every note is a plain `.md` file in a folder you choose
(default: `~/Desktop/Notes`), so it works with git, Obsidian, Dropbox, etc.

- [MyGo](https://github.com/egoist/mygo) (Go backend, system webview) · Vite 8 · React 19 · Tailwind 4 · shadcn/ui · zustand
- CodeMirror 6 **live preview** editor (Obsidian-style): headings, bold/italic, links,
  task checkboxes, code blocks with syntax highlighting, KaTeX math, Mermaid diagrams
  (via `beautiful-mermaid`), images from the vault, `#tags`, YAML frontmatter, `[[wiki links]]` with `[[` autocomplete
  (click opens the note, or creates it if missing; `[[Note|alias]]`, `[[Note#Heading]]`, `![[image.png]]` embeds);
  internal links use the accent colour, external `http(s)` links a distinct colour with ↗
- Sidebar file tree (drag & drop to move notes/folders), tabs with back/forward history, command palette (`Ctrl+P`),
  daily notes (`Ctrl+D`), slash commands (`/todo`, `/code`, …), emoji (`:smile`)
- Sidebar sections: Pinned, Recent, Tags (click a tag for a filtered view)
- Views: **Tasks** (every open `- [ ]` across the vault, tick in place), **Graph** (wiki-link graph: folder colours, hover to highlight neighbours, search, local mode),
  **Find & Replace** across all notes
- **Outline** (table of contents) floating at the top-right of the note; click to jump, current section highlighted
- Frontmatter shown as an editable **Properties** panel above the note
- Paste / drop images → saved to `attachments/` next to the note and embedded
- `/template` inserts a note from `Templates/` with `{{title}} {{date}} {{time}} {{datetime}} {{weekday}}`
- Focus mode (`Ctrl+Shift+F`, Esc to leave): hides chrome, dims other paragraphs, typewriter scrolling
- Export a note as PDF / HTML / .md, copy as rich text or markdown (… menu in the tab bar)
- Watches the folder: edits made outside the app show up immediately
- Settings → **Exclude files & folders**: VS Code-style globs (`node_modules`, `*.draft.md`, `Archive/**`) hidden from the sidebar, search and `Ctrl+P`

## Development

Requires Go 1.27+, pnpm and Node 22.6+ (Windows 10 also needs the WebView2 Runtime; Linux needs WebKitGTK 4.1).

```bash
pnpm install
pnpm dev            # mygo dev: Go app + Vite HMR, rebuilds/restarts on .go changes
pnpm typecheck      # tsc (vite/mygo config + renderer) and go vet
pnpm build          # mygo build: app + installer in release/<os>-<arch>/
pnpm generate       # regenerate src/renderer/src/lib/mygo.ts from the Go services
```

`pnpm dev` also serves the renderer at http://localhost:5173 — opening it in a browser
uses an in-memory mock vault (`src/renderer/src/lib/mockApi.ts`), handy for UI work.

## Layout

```
src/main       Go app (MyGo): window, config.json (userData), vault fs ops, file watcher, bound services
src/shared     Api interface + data types shared by the renderer (Go mirrors them in src/main/types.go)
src/renderer   React app
  lib/mygo.ts      generated typed client of the Go services (`mygo generate`, do not edit)
  lib/mygoApi.ts   window.api implemented on top of it
  editor/          CodeMirror setup, theme, live-preview decorations, commands, completions
  stores/          zustand: vault tree, tabs, open docs/autosave, settings, ui
  components/      sidebar, tabs, editor, settings, command palette, shadcn ui
```

Config lives in `%APPDATA%/Notes/config.json` (carried over from the Electron build's `%APPDATA%/notes-markdown/` on first run) (`vaultPath`, `theme`, `accent`, `fontSize`, `autosave`).
App icon: `resources/icon.png` (also `resources/logo.png` in the UI).
Images referenced from notes are served through the `vault://localhost/<path>` protocol (`http://vault.localhost/<path>` on Windows).
