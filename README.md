# Notes

Local-first markdown notes app. Every note is a plain `.md` file in a folder you choose
(default: `~/Desktop/Notes`), so it works with git, Obsidian, Dropbox, etc.

- Electron 44 · electron-vite 6 · Vite 8 · React 19 · Tailwind 4 · shadcn/ui · zustand
- CodeMirror 6 **live preview** editor (Obsidian-style): headings, bold/italic, links,
  task checkboxes, code blocks with syntax highlighting, KaTeX math, Mermaid diagrams
  (via `beautiful-mermaid`), images from the vault, `#tags`, YAML frontmatter, `[[wiki links]]` with `[[` autocomplete
  (click opens the note, or creates it if missing; `[[Note|alias]]`, `![[image.png]]` embeds)
- Sidebar file tree (drag & drop to move notes/folders), tabs with back/forward history, command palette (`Ctrl+P`),
  daily notes (`Ctrl+D`), slash commands (`/todo`, `/code`, …), emoji (`:smile`)
- Sidebar sections: Pinned, Recent, Tags (click a tag for a filtered view)
- Views: **Tasks** (every open `- [ ]` across the vault, tick in place), **Graph** (wiki-link graph),
  **Find & Replace** across all notes
- **Outline** (table of contents) floating at the top-right of the note; click to jump, current section highlighted
- Frontmatter shown as an editable **Properties** panel above the note
- Paste / drop images → saved to `attachments/` next to the note and embedded
- `/template` inserts a note from `Templates/` with `{{title}} {{date}} {{time}} {{datetime}} {{weekday}}`
- Focus mode (`Ctrl+Shift+F`, Esc to leave): hides chrome, dims other paragraphs, typewriter scrolling
- Export a note as PDF / HTML / .md, copy as rich text or markdown (… menu in the tab bar)
- Watches the folder: edits made outside the app show up immediately

## Development

```bash
pnpm install
node node_modules/electron/install.js   # only if pnpm skipped Electron's postinstall
pnpm dev            # Electron + Vite HMR
pnpm typecheck
pnpm build          # bundles to out/
pnpm dist           # electron-builder installer
```

`pnpm dev` also serves the renderer at http://localhost:5173 — opening it in a browser
uses an in-memory mock vault (`src/renderer/src/lib/mockApi.ts`), handy for UI work.

## Layout

```
src/main       Electron main: config.json (userData), vault fs ops, chokidar watcher, IPC
src/preload    contextBridge → window.api (typed in src/shared/types.ts)
src/renderer   React app
  editor/          CodeMirror setup, theme, live-preview decorations, commands, completions
  stores/          zustand: vault tree, tabs, open docs/autosave, settings, ui
  components/      sidebar, tabs, editor, settings, command palette, shadcn ui
```

Config lives in `%APPDATA%/notes-markdown/config.json` (`vaultPath`, `theme`, `accent`, `fontSize`, `autosave`).
App icon: `build/icon.png` (electron-builder) and `resources/icon.png` / `resources/logo.png` (runtime).
Images referenced from notes are served through the `vault://local/<path>` protocol.
