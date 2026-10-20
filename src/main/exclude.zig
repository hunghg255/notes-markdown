//! VS Code `files.exclude`-style matching for vault entries (Zig port of src/shared/exclude.ts).
//!
//!   - `*` / `?` never cross a `/`; `**` matches any depth; `{a,b}` is alternation.
//!   - A pattern without `/` matches the entry name at any depth (`node_modules`, `*.draft.md`).
//!   - A pattern with `/` matches the whole vault-relative path (`Archive/**`, `Projects/Old`).
//!   - Matching is case-insensitive, like the `.md` extension check in the vault walker.
const std = @import("std");

/// Whether `name` ends in .md or .markdown (any case).
pub fn isNote(name: []const u8) bool {
    return std.ascii.endsWithIgnoreCase(name, ".md") or std.ascii.endsWithIgnoreCase(name, ".markdown");
}

/// `name` without its .md / .markdown extension.
pub fn stripNoteExt(name: []const u8) []const u8 {
    if (std.ascii.endsWithIgnoreCase(name, ".markdown")) return name[0 .. name.len - ".markdown".len];
    if (std.ascii.endsWithIgnoreCase(name, ".md")) return name[0 .. name.len - ".md".len];
    return name;
}

fn normaliseGlob(a: std.mem.Allocator, pattern: []const u8) ![]const u8 {
    const p = try a.dupe(u8, std.mem.trim(u8, pattern, " \t\r\n"));
    std.mem.replaceScalar(u8, p, '\\', '/');
    var s: []const u8 = p;
    while (true) {
        if (std.mem.startsWith(u8, s, "./")) s = s[2..] else if (std.mem.startsWith(u8, s, "/")) s = s[1..] else break;
    }
    return std.mem.trimEnd(u8, s, "/");
}

/// Expands `{a,b}` groups (nested too) into every alternative.
fn expandBraces(a: std.mem.Allocator, glob: []const u8, out: *std.ArrayList([]const u8)) !void {
    const open = std.mem.indexOfScalar(u8, glob, '{') orelse return out.append(a, glob);
    var depth: usize = 0;
    var close: ?usize = null;
    var commas: std.ArrayList(usize) = .empty;
    for (glob[open..], open..) |c, i| switch (c) {
        '{' => depth += 1,
        '}' => {
            depth -= 1;
            if (depth == 0) {
                close = i;
                break;
            }
        },
        ',' => if (depth == 1) try commas.append(a, i),
        else => {},
    };
    // an unclosed brace is a literal
    const end = close orelse return out.append(a, glob);
    var start = open + 1;
    try commas.append(a, end);
    for (commas.items) |cut| {
        const alt = try std.mem.concat(a, u8, &.{ glob[0..open], glob[start..cut], glob[end + 1 ..] });
        try expandBraces(a, alt, out);
        start = cut + 1;
    }
}

/// Matches `s` against a glob without braces, case-insensitively.
pub fn matchGlob(p: []const u8, s: []const u8) bool {
    if (p.len == 0) return s.len == 0;
    // a trailing `/**` also matches the directory itself
    if (std.mem.eql(u8, p, "/**")) return s.len == 0 or s[0] == '/';
    if (std.mem.startsWith(u8, p, "**")) {
        const rest = p[2..];
        if (rest.len > 0 and rest[0] == '/') {
            // `**/`: zero or more whole segments
            const after = rest[1..];
            if (matchGlob(after, s)) return true;
            for (s, 0..) |c, i| if (c == '/' and matchGlob(after, s[i + 1 ..])) return true;
            return false;
        }
        var i: usize = 0;
        while (i <= s.len) : (i += 1) if (matchGlob(rest, s[i..])) return true;
        return false;
    }
    switch (p[0]) {
        '*' => {
            var i: usize = 0;
            while (i <= s.len) : (i += 1) {
                if (matchGlob(p[1..], s[i..])) return true;
                if (i < s.len and s[i] == '/') break;
            }
            return false;
        },
        '?' => return s.len > 0 and s[0] != '/' and matchGlob(p[1..], s[1..]),
        else => return s.len > 0 and std.ascii.toLower(p[0]) == std.ascii.toLower(s[0]) and matchGlob(p[1..], s[1..]),
    }
}

/// The user's exclude patterns, compiled.
pub const Excludes = struct {
    arena: std.heap.ArenaAllocator,
    by_name: []const []const u8 = &.{},
    by_path: []const []const u8 = &.{},

    pub fn init(gpa: std.mem.Allocator, patterns: []const []const u8) !Excludes {
        var e: Excludes = .{ .arena = .init(gpa) };
        errdefer e.arena.deinit();
        const a = e.arena.allocator();
        var by_name: std.ArrayList([]const u8) = .empty;
        var by_path: std.ArrayList([]const u8) = .empty;
        for (patterns) |raw| {
            const p = try normaliseGlob(a, raw);
            if (p.len == 0) continue;
            try expandBraces(a, p, if (std.mem.indexOfScalar(u8, p, '/') != null) &by_path else &by_name);
        }
        e.by_name = by_name.items;
        e.by_path = by_path.items;
        return e;
    }

    pub fn deinit(e: *Excludes) void {
        e.arena.deinit();
    }

    /// Whether the entry at `rel` (named `name`) is hidden.
    pub fn excluded(e: *const Excludes, rel: []const u8, name: []const u8) bool {
        for (e.by_name) |g| {
            var it = std.mem.splitScalar(u8, rel, '/');
            while (it.next()) |seg| if (matchGlob(g, seg)) return true;
            if (matchGlob(g, name)) return true;
            if (isNote(name) and matchGlob(g, stripNoteExt(name))) return true;
        }
        for (e.by_path) |g| {
            if (matchGlob(g, rel)) return true;
            if (isNote(rel) and matchGlob(g, stripNoteExt(rel))) return true;
        }
        return false;
    }
};

test "exclude patterns" {
    var e: Excludes = try .init(std.testing.allocator, &.{ "node_modules", "*.draft.md", "Archive/**", " /Projects/Old/ ", "{tmp,scratch}", "**/secret" });
    defer e.deinit();
    const t = std.testing;
    try t.expect(e.excluded("a/node_modules", "node_modules"));
    try t.expect(e.excluded("Notes/x.DRAFT.md", "x.DRAFT.md"));
    try t.expect(e.excluded("Archive", "Archive"));
    try t.expect(e.excluded("Archive/2020/a.md", "a.md"));
    try t.expect(!e.excluded("Archived", "Archived"));
    try t.expect(e.excluded("Projects/Old", "Old"));
    try t.expect(!e.excluded("Projects/Older", "Older"));
    try t.expect(e.excluded("scratch", "scratch"));
    try t.expect(e.excluded("a/b/secret", "secret"));
    try t.expect(e.excluded("secret", "secret"));
    try t.expect(!e.excluded("Home.md", "Home.md"));
}
