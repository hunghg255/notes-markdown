//! Every filesystem operation on the notes folder. All paths crossing IPC are vault-relative with
//! forward slashes; results are allocated with the caller's allocator (a call's arena).
const std = @import("std");
const myzig = @import("myzig");
const types = @import("types.zig");
const exclude = @import("exclude.zig");
const indexnote = @import("indexnote.zig");

const Io = std.Io;
const Allocator = std.mem.Allocator;

const welcome = "# Home\n\n" ++
    "Welcome to your notes. Everything here is a plain `.md` file on disk.\n\n" ++
    "## Getting started\n\n" ++
    "- [ ] Press **Ctrl+P** to search or jump to any note\n" ++
    "- [ ] Press **Ctrl+D** to open today's daily note\n" ++
    "- [x] Notes are saved automatically\n\n" ++
    "## Formatting\n\n" ++
    "Inline math like $E = mc^2$, code blocks, and mermaid diagrams render in place:\n\n" ++
    "```mermaid\n" ++
    "graph LR\n" ++
    "  A[Write] --> B[Save]\n" ++
    "  B --> C[Sync anywhere]\n" ++
    "```\n";

const max_note_size = 256 << 20;

fn hasMdExt(name: []const u8) bool {
    return std.ascii.endsWithIgnoreCase(name, ".md");
}

fn stripMdExt(name: []const u8) []const u8 {
    return if (hasMdExt(name)) name[0 .. name.len - 3] else name;
}

/// path.Dir / path.Base of a vault-relative path ("." for the root).
fn relDir(rel: []const u8) []const u8 {
    return std.fs.path.dirnamePosix(rel) orelse ".";
}

fn relJoin(a: Allocator, dir: []const u8, name: []const u8) ![]u8 {
    if (dir.len == 0 or std.mem.eql(u8, dir, ".")) return a.dupe(u8, name);
    return std.fmt.allocPrint(a, "{s}/{s}", .{ dir, name });
}

fn msTime(t: Io.Timestamp) f64 {
    return @as(f64, @floatFromInt(t.toNanoseconds())) / 1e6;
}

pub const Vault = struct {
    gpa: Allocator,
    io: Io,
    /// Absolute and resolved (no `..`, no trailing separator).
    root: []u8,
    excludes: exclude.Excludes,
    /// Makes the names of atomic writes' temporary files unique.
    tmp_serial: u32 = 0,

    pub fn init(gpa: Allocator, io: Io, root: []const u8, patterns: []const []const u8) !*Vault {
        const v = try gpa.create(Vault);
        errdefer gpa.destroy(v);
        const resolved = try std.fs.path.resolve(gpa, &.{root});
        errdefer gpa.free(resolved);
        v.* = .{ .gpa = gpa, .io = io, .root = resolved, .excludes = try .init(gpa, patterns) };
        return v;
    }

    pub fn deinit(v: *Vault) void {
        v.excludes.deinit();
        v.gpa.free(v.root);
        v.gpa.destroy(v);
    }

    /// Replaces the user's exclude patterns; takes effect on the next tree/scan/search.
    pub fn setExcludes(v: *Vault, patterns: []const []const u8) !void {
        const next: exclude.Excludes = try .init(v.gpa, patterns);
        v.excludes.deinit();
        v.excludes = next;
    }

    /// Ensures the vault folder exists, with a minimal starter structure when it is empty.
    pub fn setup(v: *Vault) !void {
        const cwd = Io.Dir.cwd();
        try cwd.createDirPath(v.io, v.root);
        var dir = try cwd.openDir(v.io, v.root, .{ .iterate = true });
        defer dir.close(v.io);
        var it = dir.iterate();
        if (try it.next(v.io) != null) return;
        dir.createDirPath(v.io, "Daily Notes") catch {};
        dir.createDirPath(v.io, "Templates") catch {};
        try dir.writeFile(v.io, .{ .sub_path = "Home.md", .data = welcome });
    }

    /// Turns a vault-relative path into an absolute one and refuses anything outside the root.
    pub fn resolve(v: *Vault, a: Allocator, rel: []const u8) ![]u8 {
        const abs = try std.fs.path.resolve(a, &.{ v.root, rel });
        if (std.mem.eql(u8, abs, v.root)) return abs;
        const inside = abs.len > v.root.len and std.mem.startsWith(u8, abs, v.root) and std.fs.path.isSep(abs[v.root.len]);
        // a root such as C:\ already ends in a separator
        const at_drive = std.fs.path.isSep(v.root[v.root.len - 1]) and std.mem.startsWith(u8, abs, v.root);
        if (!inside and !at_drive) return error.PathEscapesVault;
        return abs;
    }

    fn stat(v: *Vault, abs: []const u8) !Io.Dir.Stat {
        return Io.Dir.cwd().statFile(v.io, abs, .{});
    }

    pub fn exists(v: *Vault, a: Allocator, rel: []const u8) bool {
        const abs = v.resolve(a, rel) catch return false;
        Io.Dir.cwd().access(v.io, abs, .{}) catch return false;
        return true;
    }

    pub fn tree(v: *Vault, a: Allocator) ![]const types.TreeNode {
        return v.walk(a, v.root, "");
    }

    fn walk(v: *Vault, a: Allocator, abs_dir: []const u8, prefix: []const u8) ![]const types.TreeNode {
        var dir = try Io.Dir.cwd().openDir(v.io, abs_dir, .{ .iterate = true });
        defer dir.close(v.io);
        var nodes: std.ArrayList(types.TreeNode) = .empty;
        var it = dir.iterate();
        while (try it.next(v.io)) |entry| {
            const name = entry.name;
            if (name.len == 0 or name[0] == '.') continue;
            const st = dir.statFile(v.io, name, .{}) catch continue;
            const is_dir = st.kind == .directory;
            // attachment folders hold images pasted into notes, not notes
            if (is_dir and std.ascii.eqlIgnoreCase(name, "attachments")) continue;
            const rel = try relJoin(a, prefix, name);
            // user-configured exclude patterns (Settings → Storage)
            if (v.excludes.excluded(rel, name)) continue;
            if (is_dir) {
                const abs = try std.fs.path.join(a, &.{ abs_dir, name });
                const children = v.walk(a, abs, rel) catch &.{};
                try nodes.append(a, .{ .name = try a.dupe(u8, name), .path = rel, .type = "dir", .mtime = msTime(st.mtime), .children = children });
            } else if (st.kind == .file and exclude.isNote(name)) {
                try nodes.append(a, .{ .name = try a.dupe(u8, exclude.stripNoteExt(name)), .path = rel, .type = "file", .mtime = msTime(st.mtime) });
            }
        }
        std.mem.sort(types.TreeNode, nodes.items, {}, nodeLess);
        return nodes.items;
    }

    fn nodeLess(_: void, a: types.TreeNode, b: types.TreeNode) bool {
        const a_dir = std.mem.eql(u8, a.type, "dir");
        if (a_dir != std.mem.eql(u8, b.type, "dir")) return a_dir;
        return naturalLess(a.name, b.name);
    }

    pub fn read(v: *Vault, a: Allocator, rel: []const u8) !types.NoteFile {
        const abs = try v.resolve(a, rel);
        const data = try Io.Dir.cwd().readFileAlloc(v.io, abs, a, .limited(max_note_size));
        const st = try v.stat(abs);
        return .{ .content = data, .mtime = msTime(st.mtime) };
    }

    /// Replaces a file atomically (.tmp + rename) so the watcher never sees a half-written one.
    fn writeAtomic(v: *Vault, a: Allocator, abs: []const u8, data: []const u8) !void {
        const cwd = Io.Dir.cwd();
        if (std.fs.path.dirname(abs)) |d| try cwd.createDirPath(v.io, d);
        v.tmp_serial +%= 1;
        const tmp = try std.fmt.allocPrint(a, "{s}.{d}.tmp", .{ abs, v.tmp_serial });
        try cwd.writeFile(v.io, .{ .sub_path = tmp, .data = data });
        cwd.rename(tmp, cwd, abs, v.io) catch |err| {
            cwd.deleteFile(v.io, tmp) catch {};
            return err;
        };
    }

    pub fn write(v: *Vault, a: Allocator, rel: []const u8, content: []const u8) !types.WriteResult {
        const abs = try v.resolve(a, rel);
        try v.writeAtomic(a, abs, content);
        const st = try v.stat(abs);
        return .{ .mtime = msTime(st.mtime) };
    }

    /// Makes a note; if the name is taken, it appends " 1", " 2", ...
    pub fn create(v: *Vault, a: Allocator, rel_in: []const u8, content: []const u8) ![]const u8 {
        const rel = if (hasMdExt(rel_in)) rel_in else try std.fmt.allocPrint(a, "{s}.md", .{rel_in});
        const dir = relDir(rel);
        const base = stripMdExt(std.fs.path.basenamePosix(rel));
        var candidate: []const u8 = rel;
        var i: usize = 1;
        while (v.exists(a, candidate)) : (i += 1) {
            candidate = try relJoin(a, dir, try std.fmt.allocPrint(a, "{s} {d}.md", .{ base, i }));
        }
        _ = try v.write(a, candidate, content);
        return candidate;
    }

    pub fn mkdir(v: *Vault, a: Allocator, rel: []const u8) ![]const u8 {
        var candidate: []const u8 = rel;
        var i: usize = 1;
        while (v.exists(a, candidate)) : (i += 1) candidate = try std.fmt.allocPrint(a, "{s} {d}", .{ rel, i });
        const abs = try v.resolve(a, candidate);
        try Io.Dir.cwd().createDirPath(v.io, abs);
        return candidate;
    }

    pub fn rename(v: *Vault, a: Allocator, from: []const u8, to_in: []const u8) ![]const u8 {
        const src = try v.resolve(a, from);
        const st = try v.stat(src);
        const to = if (!hasMdExt(to_in) and st.kind != .directory) try std.fmt.allocPrint(a, "{s}.md", .{to_in}) else to_in;
        const dst = try v.resolve(a, to);
        if (v.exists(a, to)) return error.AlreadyExists;
        const cwd = Io.Dir.cwd();
        if (std.fs.path.dirname(dst)) |d| try cwd.createDirPath(v.io, d);
        try cwd.rename(src, cwd, dst, v.io);
        return to;
    }

    /// Moves an entry to the OS trash.
    pub fn delete(v: *Vault, a: Allocator, rel: []const u8) !void {
        if (rel.len == 0) return error.RefusingToDeleteVaultRoot;
        const abs = try v.resolve(a, rel);
        if (!myzig.shell.trash(abs)) return error.CouldNotMoveToTrash;
    }

    pub fn showInFolder(v: *Vault, a: Allocator, rel: []const u8) !void {
        myzig.shell.showInFolder(try v.resolve(a, rel));
    }

    /// Every note's path, from the tree (so exclude patterns apply).
    pub fn listNotes(v: *Vault, a: Allocator) ![]const []const u8 {
        var files: std.ArrayList([]const u8) = .empty;
        try collect(a, try v.tree(a), &files);
        return files.items;
    }

    fn collect(a: Allocator, nodes: []const types.TreeNode, out: *std.ArrayList([]const u8)) !void {
        for (nodes) |n| {
            if (n.children) |c| try collect(a, c, out) else try out.append(a, n.path);
        }
    }

    /// Writes an attachment (e.g. a pasted image) and returns the final relative path.
    pub fn writeBinary(v: *Vault, a: Allocator, rel: []const u8, data: []const u8) ![]const u8 {
        const dir = relDir(rel);
        const name = std.fs.path.basenamePosix(rel);
        const dot = std.mem.lastIndexOfScalar(u8, name, '.');
        const ext = if (dot) |d| name[d..] else "";
        const base = name[0 .. name.len - ext.len];
        var candidate: []const u8 = rel;
        var i: usize = 1;
        while (v.exists(a, candidate)) : (i += 1) {
            candidate = try relJoin(a, dir, try std.fmt.allocPrint(a, "{s}-{d}{s}", .{ base, i, ext }));
        }
        const abs = try v.resolve(a, candidate);
        const cwd = Io.Dir.cwd();
        if (std.fs.path.dirname(abs)) |d| try cwd.createDirPath(v.io, d);
        try cwd.writeFile(v.io, .{ .sub_path = abs, .data = data });
        return candidate;
    }

    /// Extracts tags, links, tasks and headings from every note.
    pub fn scan(v: *Vault, a: Allocator) ![]types.NoteIndex {
        var out: std.ArrayList(types.NoteIndex) = .empty;
        for (try v.listNotes(a)) |rel| {
            const abs = v.resolve(a, rel) catch continue;
            const data = Io.Dir.cwd().readFileAlloc(v.io, abs, a, .limited(max_note_size)) catch continue;
            const st = v.stat(abs) catch continue;
            var idx = try indexnote.indexNote(a, data);
            idx.path = rel;
            idx.name = stripMdExt(std.fs.path.basenamePosix(rel));
            idx.mtime = msTime(st.mtime);
            try out.append(a, idx);
        }
        return out.items;
    }

    /// A literal find/replace across the given notes (or all of them when `paths` is empty).
    pub fn replace(v: *Vault, a: Allocator, find: []const u8, replacement: []const u8, paths: []const []const u8, match_case: bool) !types.ReplaceResult {
        var res: types.ReplaceResult = .{};
        if (find.len == 0) return res;
        const targets = if (paths.len > 0) paths else try v.listNotes(a);
        for (targets) |rel| {
            const abs = try v.resolve(a, rel);
            const content = try Io.Dir.cwd().readFileAlloc(v.io, abs, a, .limited(max_note_size));
            var out: std.ArrayList(u8) = .empty;
            var count: usize = 0;
            var i: usize = 0;
            while (indexOf(content, i, find, match_case)) |at| {
                try out.appendSlice(a, content[i..at]);
                try out.appendSlice(a, replacement);
                i = at + find.len;
                count += 1;
            }
            if (count == 0) continue;
            try out.appendSlice(a, content[i..]);
            _ = try v.write(a, rel, out.items);
            res.files += 1;
            res.replacements += count;
        }
        return res;
    }

    fn indexOf(haystack: []const u8, start: usize, needle: []const u8, match_case: bool) ?usize {
        if (match_case) return std.mem.indexOfPos(u8, haystack, start, needle);
        return std.ascii.findIgnoreCasePos(haystack, start, needle);
    }

    /// A naive full-text search; fine for personal vaults of a few thousand notes.
    pub fn search(v: *Vault, a: Allocator, query: []const u8, limit: usize) ![]types.SearchHit {
        var hits: std.ArrayList(types.SearchHit) = .empty;
        if (query.len == 0) return hits.items;
        for (try v.listNotes(a)) |rel| {
            if (hits.items.len >= limit) break;
            const abs = v.resolve(a, rel) catch continue;
            const data = Io.Dir.cwd().readFileAlloc(v.io, abs, a, .limited(max_note_size)) catch continue;
            var lines = std.mem.splitScalar(u8, data, '\n');
            var n: usize = 1;
            while (lines.next()) |line| : (n += 1) {
                if (std.ascii.findIgnoreCase(line, query) == null) continue;
                try hits.append(a, .{ .path = rel, .line = n, .preview = indexnote.truncateRunes(std.mem.trim(u8, line, " \t\r\n"), 160) });
                if (hits.items.len >= limit) break;
            }
        }
        return hits.items;
    }
};

/// Approximates `localeCompare(…, { numeric: true, sensitivity: 'base' })`.
pub fn naturalLess(a_in: []const u8, b_in: []const u8) bool {
    var a = a_in;
    var b = b_in;
    while (a.len > 0 and b.len > 0) {
        if (std.ascii.isDigit(a[0]) and std.ascii.isDigit(b[0])) {
            const na = leadingDigits(a);
            const nb = leadingDigits(b);
            const ta = std.mem.trimStart(u8, na, "0");
            const tb = std.mem.trimStart(u8, nb, "0");
            if (ta.len != tb.len) return ta.len < tb.len;
            switch (std.mem.order(u8, ta, tb)) {
                .lt => return true,
                .gt => return false,
                .eq => {},
            }
            a = a[na.len..];
            b = b[nb.len..];
            continue;
        }
        const ca = std.ascii.toLower(a[0]);
        const cb = std.ascii.toLower(b[0]);
        if (ca != cb) return ca < cb;
        a = a[1..];
        b = b[1..];
    }
    return a.len < b.len;
}

fn leadingDigits(s: []const u8) []const u8 {
    var i: usize = 0;
    while (i < s.len and std.ascii.isDigit(s[i])) i += 1;
    return s[0..i];
}

test naturalLess {
    try std.testing.expect(naturalLess("note 2", "Note 10"));
    try std.testing.expect(!naturalLess("b", "A"));
    try std.testing.expect(naturalLess("a", "ab"));
}

test "a vault refuses paths outside it" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const v = try Vault.init(std.testing.allocator, std.testing.io, if (@import("builtin").os.tag == .windows) "C:\\vault" else "/vault", &.{});
    defer v.deinit();
    const a = arena.allocator();
    try std.testing.expectError(error.PathEscapesVault, v.resolve(a, "../x.md"));
    try std.testing.expectError(error.PathEscapesVault, v.resolve(a, "../vault2/x.md"));
    _ = try v.resolve(a, "Daily Notes/a.md");
    _ = try v.resolve(a, "");
}
