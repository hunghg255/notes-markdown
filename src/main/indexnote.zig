//! Zig port of src/shared/indexNote.ts (the renderer keeps the TypeScript one for the outline panel).
//! Zig has no regular expressions, so each pattern of the TypeScript version is matched by hand;
//! the comments give the pattern.
const std = @import("std");
const types = @import("types.zig");

/// Keeps insertion order, like a JS Set.
const OrderedSet = struct {
    seen: std.StringHashMapUnmanaged(void) = .empty,
    items: std.ArrayList([]const u8) = .empty,

    fn add(s: *OrderedSet, a: std.mem.Allocator, v: []const u8) !void {
        const r = try s.seen.getOrPut(a, v);
        if (!r.found_existing) try s.items.append(a, v);
    }
};

/// Go's `\s`: ASCII whitespace.
fn isSpace(c: u8) bool {
    return c == ' ' or c == '\t' or c == '\n' or c == '\r' or c == '\x0b' or c == '\x0c';
}

fn trimSpace(s: []const u8) []const u8 {
    return std.mem.trim(u8, s, " \t\n\r\x0b\x0c");
}

fn trimLeftSpace(s: []const u8) []const u8 {
    return std.mem.trimStart(u8, s, " \t\n\r\x0b\x0c");
}

/// The first `n` code points of `s`.
pub fn truncateRunes(s: []const u8, n: usize) []const u8 {
    var count: usize = 0;
    var i: usize = 0;
    while (i < s.len) : (count += 1) {
        if (count == n) return s[0..i];
        i += std.unicode.utf8ByteSequenceLength(s[i]) catch 1;
    }
    return s;
}

/// Approximates `[\p{L}\p{N}_]`: ASCII letters, digits and `_`, and code points past ASCII
/// that are not punctuation or spaces.
fn tagChar(cp: u21) bool {
    if (cp < 0x80) return std.ascii.isAlphanumeric(@intCast(cp)) or cp == '_';
    return !((cp >= 0x80 and cp <= 0xbf) or cp == 0xd7 or cp == 0xf7 or
        (cp >= 0x2000 and cp <= 0x2bff) or (cp >= 0x3000 and cp <= 0x303f) or
        (cp >= 0xfe30 and cp <= 0xfe4f) or (cp >= 0xff00 and cp <= 0xff0f) or
        (cp >= 0xff1a and cp <= 0xff20) or (cp >= 0x1f000 and cp <= 0x1faff));
}

/// The code point at `s[i]` and its length; a stray byte is one code point.
fn decodeAt(s: []const u8, i: usize) struct { cp: u21, len: usize } {
    const len = std.unicode.utf8ByteSequenceLength(s[i]) catch return .{ .cp = s[i], .len = 1 };
    if (i + len > s.len) return .{ .cp = s[i], .len = 1 };
    const cp = std.unicode.utf8Decode(s[i .. i + len]) catch return .{ .cp = s[i], .len = 1 };
    return .{ .cp = cp, .len = len };
}

/// `(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)`, every match, skipping all-digit tags.
fn collectTags(a: std.mem.Allocator, line: []const u8, tags: *OrderedSet) !void {
    var i: usize = 0;
    while (i < line.len) {
        if (line[i] != '#' or (i > 0 and !isSpace(line[i - 1])) or i + 1 >= line.len) {
            i += 1;
            continue;
        }
        const first = decodeAt(line, i + 1);
        if (!tagChar(first.cp)) {
            i += 1;
            continue;
        }
        var j = i + 1 + first.len;
        while (j < line.len) {
            const d = decodeAt(line, j);
            if (!(tagChar(d.cp) or d.cp == '-' or d.cp == '/')) break;
            j += d.len;
        }
        const tag = line[i + 1 .. j];
        const digits = for (tag) |c| {
            if (!std.ascii.isDigit(c)) break false;
        } else true;
        if (!digits) try tags.add(a, tag);
        i = j;
    }
}

/// `\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]`: the targets of wiki links.
fn collectWikiLinks(a: std.mem.Allocator, line: []const u8, links: *OrderedSet) !void {
    var i: usize = 0;
    while (i + 1 < line.len) {
        if (!std.mem.startsWith(u8, line[i..], "[[")) {
            i += 1;
            continue;
        }
        var j = i + 2;
        while (j < line.len and std.mem.indexOfScalar(u8, "]|#", line[j]) == null) j += 1;
        const target = line[i + 2 .. j];
        if (target.len > 0 and j < line.len and line[j] == '#') {
            j += 1;
            while (j < line.len and line[j] != ']' and line[j] != '|') j += 1;
        }
        if (target.len > 0 and j < line.len and line[j] == '|') {
            j += 1;
            while (j < line.len and line[j] != ']') j += 1;
        }
        if (target.len > 0 and std.mem.startsWith(u8, line[j..], "]]")) {
            try links.add(a, trimSpace(target));
            i = j + 2;
        } else i += 1;
    }
}

/// `%XX` escapes decoded, or null when one is malformed (as Go's url.PathUnescape fails).
fn percentDecode(a: std.mem.Allocator, s: []const u8) !?[]const u8 {
    if (std.mem.indexOfScalar(u8, s, '%') == null) return s;
    var out: std.ArrayList(u8) = .empty;
    var i: usize = 0;
    while (i < s.len) : (i += 1) {
        if (s[i] != '%') {
            try out.append(a, s[i]);
            continue;
        }
        if (i + 2 >= s.len) return null;
        const b = std.fmt.parseInt(u8, s[i + 1 .. i + 3], 16) catch return null;
        try out.append(a, b);
        i += 2;
    }
    return out.items;
}

/// `(?i)\[[^\]]*\]\(([^)\s]+\.md)\)`: the targets of markdown links to notes, decoded, without `.md`.
fn collectMdLinks(a: std.mem.Allocator, line: []const u8, links: *OrderedSet) !void {
    var i: usize = 0;
    while (i < line.len) {
        if (line[i] != '[') {
            i += 1;
            continue;
        }
        const close = std.mem.indexOfScalarPos(u8, line, i + 1, ']') orelse return;
        if (close + 1 >= line.len or line[close + 1] != '(') {
            i += 1;
            continue;
        }
        var j = close + 2;
        while (j < line.len and line[j] != ')' and !isSpace(line[j])) j += 1;
        const target = line[close + 2 .. j];
        if (j < line.len and line[j] == ')' and target.len > 3 and std.ascii.endsWithIgnoreCase(target, ".md")) {
            const decoded = (try percentDecode(a, target)) orelse target;
            const name = if (std.ascii.endsWithIgnoreCase(decoded, ".md")) decoded[0 .. decoded.len - 3] else decoded;
            try links.add(a, name);
            i = j + 1;
        } else i += 1;
    }
}

/// `^\s*(?:[-*+]|\d+[.)])`: the length of a list marker at the start of `line`, or null.
fn listMarker(line: []const u8) ?usize {
    const rest = trimLeftSpace(line);
    const at = line.len - rest.len;
    if (rest.len == 0) return null;
    if (std.mem.indexOfScalar(u8, "-*+", rest[0]) != null) return at + 1;
    var d: usize = 0;
    while (d < rest.len and std.ascii.isDigit(rest[d])) d += 1;
    if (d > 0 and d < rest.len and (rest[d] == '.' or rest[d] == ')')) return at + d + 1;
    return null;
}

/// `^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.*)$`
fn parseTask(line: []const u8, n: usize) ?types.NoteTask {
    const marker = listMarker(line) orelse return null;
    var rest = line[marker..];
    if (rest.len == 0 or !isSpace(rest[0])) return null;
    rest = trimLeftSpace(rest);
    if (rest.len < 4 or rest[0] != '[' or rest[2] != ']') return null;
    const mark = rest[1];
    if (mark != ' ' and mark != 'x' and mark != 'X') return null;
    if (!isSpace(rest[3])) return null;
    return .{ .line = n, .text = trimSpace(rest[4..]), .done = mark != ' ' };
}

/// `^(#{1,6})\s+(.*)$`
fn parseHeading(line: []const u8, n: usize) ?types.NoteHeading {
    var level: usize = 0;
    while (level < line.len and line[level] == '#') level += 1;
    if (level == 0 or level > 6 or level >= line.len or !isSpace(line[level])) return null;
    return .{ .level = level, .text = trimSpace(line[level..]), .line = n };
}

/// Drops one leading and one trailing quote, then a leading `#`.
fn cleanTag(t: []const u8) []const u8 {
    var s = trimSpace(t);
    if (s.len > 0 and (s[0] == '\'' or s[0] == '"')) s = s[1..];
    if (s.len > 0 and (s[s.len - 1] == '\'' or s[s.len - 1] == '"')) s = s[0 .. s.len - 1];
    if (s.len > 0 and s[0] == '#') s = s[1..];
    return s;
}

/// `^\s+-\s+`: the rest of a block-list item of the frontmatter, or null.
fn frontListItem(line: []const u8) ?[]const u8 {
    if (line.len == 0 or !isSpace(line[0])) return null;
    const rest = trimLeftSpace(line);
    if (rest.len < 2 or rest[0] != '-' or !isSpace(rest[1])) return null;
    return trimLeftSpace(rest[1..]);
}

fn isFence(line: []const u8) bool {
    const rest = trimLeftSpace(line);
    return std.mem.startsWith(u8, rest, "```") or std.mem.startsWith(u8, rest, "~~~");
}

/// Tags, links, tasks, headings and the excerpt of a note; `path`, `name` and `mtime` are the caller's.
/// Everything is allocated with `a` or points into `content`.
pub fn indexNote(a: std.mem.Allocator, content: []const u8) !types.NoteIndex {
    var tags: OrderedSet = .{};
    var links: OrderedSet = .{};
    var tasks: std.ArrayList(types.NoteTask) = .empty;
    var headings: std.ArrayList(types.NoteHeading) = .empty;
    var excerpt: []const u8 = "";
    var in_fence = false;
    var in_frontmatter = false;
    var in_tag_list = false;
    var it = std.mem.splitScalar(u8, content, '\n');
    var i: usize = 0;
    while (it.next()) |line| : (i += 1) {
        if (i == 0 and std.mem.eql(u8, line, "---")) {
            in_frontmatter = true;
            continue;
        }
        if (in_frontmatter) {
            if (std.mem.eql(u8, line, "---")) {
                in_frontmatter = false;
            } else if (in_tag_list and frontListItem(line) != null) {
                // block list continuation:  - tag
                const t = cleanTag(frontListItem(line).?);
                if (t.len > 0) try tags.add(a, t);
            } else {
                in_tag_list = false;
                // frontmatter `tags: [a, b]` / `tags: a, b` / `tags:` followed by a block list
                if (std.mem.startsWith(u8, line, "tags:")) {
                    var inline_tags = trimSpace(line["tags:".len..]);
                    if (inline_tags.len > 0 and inline_tags[0] == '[') inline_tags = inline_tags[1..];
                    if (inline_tags.len > 0 and inline_tags[inline_tags.len - 1] == ']') inline_tags = inline_tags[0 .. inline_tags.len - 1];
                    if (inline_tags.len > 0) {
                        var parts = std.mem.splitScalar(u8, inline_tags, ',');
                        while (parts.next()) |t| if (trimSpace(t).len > 0) try tags.add(a, cleanTag(t));
                    } else in_tag_list = true;
                }
            }
            continue;
        }
        if (isFence(line)) {
            in_fence = !in_fence;
            continue;
        }
        if (in_fence) continue;
        if (parseHeading(line, i + 1)) |h| {
            try headings.append(a, h);
        } else if (excerpt.len == 0 and trimSpace(line).len > 0 and listMarker(line) == null and trimLeftSpace(line)[0] != '>') {
            excerpt = truncateRunes(trimSpace(line), 160);
        }
        if (parseTask(line, i + 1)) |t| try tasks.append(a, t);
        try collectTags(a, line, &tags);
        try collectWikiLinks(a, line, &links);
        try collectMdLinks(a, line, &links);
    }
    return .{ .tags = tags.items.items, .links = links.items.items, .tasks = tasks.items, .headings = headings.items, .excerpt = excerpt };
}

test indexNote {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const note =
        \\---
        \\tags: [work, "#idea"]
        \\---
        \\# Title
        \\First line with #tag and #123 and [[Other Note#Part|alias]].
        \\- [ ] open task
        \\- [x] done [link](Some%20Note.md)
        \\```
        \\# not a heading #nope
        \\```
        \\## Sub
    ;
    const idx = try indexNote(arena.allocator(), note);
    const t = std.testing;
    try t.expectEqual(@as(usize, 3), idx.tags.len);
    try t.expectEqualStrings("work", idx.tags[0]);
    try t.expectEqualStrings("idea", idx.tags[1]);
    try t.expectEqualStrings("tag", idx.tags[2]);
    try t.expectEqual(@as(usize, 2), idx.links.len);
    try t.expectEqualStrings("Other Note", idx.links[0]);
    try t.expectEqualStrings("Some Note", idx.links[1]);
    try t.expectEqual(@as(usize, 2), idx.tasks.len);
    try t.expect(idx.tasks[1].done);
    try t.expectEqualStrings("open task", idx.tasks[0].text);
    try t.expectEqual(@as(usize, 2), idx.headings.len);
    try t.expectEqual(@as(usize, 11), idx.headings[1].line);
    try t.expectEqualStrings("First line with #tag and #123 and [[Other Note#Part|alias]].", idx.excerpt);
}
