package main

// Go side of the data types in src/shared/types.ts; the JSON tags must match the TypeScript field names.

// Theme is the app's colour scheme.
type Theme string

const (
	ThemeDark   Theme = "dark"
	ThemeLight  Theme = "light"
	ThemeSystem Theme = "system"
)

// AppConfig is persisted in config.json in the user data directory.
type AppConfig struct {
	VaultPath string `json:"vaultPath"`
	Theme     Theme  `json:"theme"`
	Accent    string `json:"accent"`
	FontSize  int    `json:"fontSize"`
	Autosave  bool   `json:"autosave"`
	// ZoomLevel is the UI zoom factor of the window (1 = 100%).
	ZoomLevel float64 `json:"zoomLevel,omitempty"`
	// FocusDim fades lines away from the cursor while in focus mode.
	FocusDim bool `json:"focusDim,omitempty"`
	// ExcludePatterns are VS Code files.exclude-style globs hidden from the tree, search and palette.
	ExcludePatterns []string `json:"excludePatterns,omitempty"`
}

// TreeNode is a folder or note in the vault tree.
type TreeNode struct {
	Name string `json:"name"`
	// Path is relative to the vault root, using forward slashes.
	Path     string     `json:"path"`
	Type     string     `json:"type"`
	Mtime    float64    `json:"mtime"`
	Children []TreeNode `json:"children,omitempty"`
}

// NoteFile is a note's content and modification time (ms since the epoch).
type NoteFile struct {
	Content string  `json:"content"`
	Mtime   float64 `json:"mtime"`
}

// WriteResult is the modification time of a note after a write.
type WriteResult struct {
	Mtime float64 `json:"mtime"`
}

// SearchHit is one matching line of a full-text search.
type SearchHit struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Preview string `json:"preview"`
}

// NoteTask is a `- [ ]` checkbox item.
type NoteTask struct {
	Line int    `json:"line"`
	Text string `json:"text"`
	Done bool   `json:"done"`
}

// NoteHeading is a markdown heading.
type NoteHeading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Line  int    `json:"line"`
}

// NoteIndex is lightweight per-note metadata extracted by scanning the vault.
type NoteIndex struct {
	Path  string   `json:"path"`
	Name  string   `json:"name"`
	Mtime float64  `json:"mtime"`
	Tags  []string `json:"tags"`
	// Links are wiki-link / markdown-link targets (raw, unresolved).
	Links    []string      `json:"links"`
	Tasks    []NoteTask    `json:"tasks"`
	Headings []NoteHeading `json:"headings"`
	// Excerpt is the first non-heading, non-empty line.
	Excerpt string `json:"excerpt"`
}

// ReplaceResult counts the edits of a find/replace.
type ReplaceResult struct {
	Files        int `json:"files"`
	Replacements int `json:"replacements"`
}

// VaultEvent tells the renderer that something changed on disk.
type VaultEvent struct {
	// Type is add, change, unlink, addDir, unlinkDir or vaultChanged.
	Type string `json:"type"`
	Path string `json:"path"`
}
