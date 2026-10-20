//! Zig side of the data types in src/shared/types.ts; the field names must match the TypeScript ones.

/// The app's colour scheme.
pub const Theme = enum { dark, light, system };

/// Persisted in config.json in the app's data directory.
pub const AppConfig = struct {
    vaultPath: []const u8 = "",
    theme: Theme = .dark,
    accent: []const u8 = "orange",
    fontSize: i64 = 16,
    autosave: bool = true,
    /// The UI zoom factor of the window (1 = 100%).
    zoomLevel: f64 = 1,
    /// Fades lines away from the cursor while in focus mode.
    focusDim: bool = false,
    /// VS Code files.exclude-style globs hidden from the tree, search and palette.
    excludePatterns: []const []const u8 = &.{},
};

/// A folder or note in the vault tree.
pub const TreeNode = struct {
    name: []const u8,
    /// Relative to the vault root, using forward slashes.
    path: []const u8,
    type: []const u8,
    mtime: f64,
    /// Null for notes.
    children: ?[]const TreeNode = null,
};

/// A note's content and modification time (ms since the epoch).
pub const NoteFile = struct {
    content: []const u8,
    mtime: f64,
};

/// The modification time of a note after a write.
pub const WriteResult = struct {
    mtime: f64,
};

/// One matching line of a full-text search.
pub const SearchHit = struct {
    path: []const u8,
    line: usize,
    preview: []const u8,
};

/// A `- [ ]` checkbox item.
pub const NoteTask = struct {
    line: usize,
    text: []const u8,
    done: bool,
};

/// A markdown heading.
pub const NoteHeading = struct {
    level: usize,
    text: []const u8,
    line: usize,
};

/// Lightweight per-note metadata extracted by scanning the vault.
pub const NoteIndex = struct {
    path: []const u8 = "",
    name: []const u8 = "",
    mtime: f64 = 0,
    tags: []const []const u8,
    /// Wiki-link / markdown-link targets (raw, unresolved).
    links: []const []const u8,
    tasks: []const NoteTask,
    headings: []const NoteHeading,
    /// The first non-heading, non-empty line.
    excerpt: []const u8,
};

/// Counts the edits of a find/replace.
pub const ReplaceResult = struct {
    files: usize = 0,
    replacements: usize = 0,
};

/// Tells the renderer that something changed on disk.
pub const VaultEvent = struct {
    /// add, change, unlink, addDir, unlinkDir or vaultChanged.
    type: []const u8,
    path: []const u8,
};
