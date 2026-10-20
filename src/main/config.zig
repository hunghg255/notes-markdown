//! config.json in the app's config directory (%AppData%/Notes, where the MyGo build kept it too),
//! cached in memory; on first run it falls back to the Electron build's
//! %AppData%/notes-markdown/config.json.
const std = @import("std");
const myzig = @import("myzig");
const types = @import("types.zig");

const Io = std.Io;
const AppConfig = types.AppConfig;

pub const Store = struct {
    gpa: std.mem.Allocator,
    io: Io,
    path: []u8,
    /// The legacy Electron config, read when `path` doesn't exist yet.
    legacy_path: ?[]u8,
    /// Holds `current`'s strings.
    arena: std.heap.ArenaAllocator,
    current: AppConfig = .{},
    /// Headless runs (`--myzig-eval`, `--myzig-hidden`) default to a vault in the temporary
    /// directory, never the user's (their config directory is a temporary one already).
    headless: bool,

    pub fn init(gpa: std.mem.Allocator, io: Io, app_name: []const u8, headless: bool) !Store {
        const dir = try myzig.appPath(gpa, .config, app_name);
        defer gpa.free(dir);
        const path = try std.fs.path.join(gpa, &.{ dir, "config.json" });
        errdefer gpa.free(path);
        const legacy: ?[]u8 = blk: {
            const parent = std.fs.path.dirname(dir) orelse break :blk null;
            break :blk try std.fs.path.join(gpa, &.{ parent, "notes-markdown", "config.json" });
        };
        var s: Store = .{ .gpa = gpa, .io = io, .path = path, .legacy_path = legacy, .arena = .init(gpa), .headless = headless };
        s.load() catch |err| {
            std.log.warn("config: {t}", .{err});
            try s.reset();
        };
        return s;
    }

    pub fn deinit(s: *Store) void {
        s.arena.deinit();
        s.gpa.free(s.path);
        if (s.legacy_path) |p| s.gpa.free(p);
    }

    fn defaults(s: *const Store, a: std.mem.Allocator) !AppConfig {
        const desktop = try myzig.path(a, if (s.headless) .temp else .desktop, "Notes");
        return .{ .vaultPath = try std.fs.path.join(a, &.{ desktop, if (s.headless) "notes-headless-vault" else "Notes" }) };
    }

    /// The defaults, saved.
    fn reset(s: *Store) !void {
        _ = s.arena.reset(.free_all);
        s.current = try s.defaults(s.arena.allocator());
        try s.save();
    }

    fn load(s: *Store) !void {
        const cwd = Io.Dir.cwd();
        const raw = cwd.readFileAlloc(s.io, s.path, s.gpa, .limited(1 << 20)) catch |err| switch (err) {
            // first run of this build: carry over the Electron build's settings
            error.FileNotFound => if (s.legacy_path) |p| cwd.readFileAlloc(s.io, p, s.gpa, .limited(1 << 20)) catch return s.reset() else return s.reset(),
            else => return err,
        };
        defer s.gpa.free(raw);
        try s.parse(raw);
    }

    /// Replaces `current` with `raw` over the defaults.
    fn parse(s: *Store, raw: []const u8) !void {
        var next: std.heap.ArenaAllocator = .init(s.gpa);
        errdefer next.deinit();
        const a = next.allocator();
        // fields missing from the file keep their defaults: merge over them
        var base = try toValue(a, try s.defaults(a));
        const patch = try std.json.parseFromSliceLeaky(std.json.Value, a, raw, .{});
        if (patch != .object) return error.InvalidConfig;
        var it = patch.object.iterator();
        while (it.next()) |kv| try base.object.put(a, kv.key_ptr.*, kv.value_ptr.*);
        const merged = try std.json.Stringify.valueAlloc(a, base, .{});
        const cfg = try std.json.parseFromSliceLeaky(AppConfig, a, merged, .{ .ignore_unknown_fields = true, .allocate = .alloc_always });
        s.arena.deinit();
        s.arena = next;
        s.current = cfg;
    }

    fn toValue(a: std.mem.Allocator, cfg: AppConfig) !std.json.Value {
        const json = try std.json.Stringify.valueAlloc(a, cfg, .{});
        return std.json.parseFromSliceLeaky(std.json.Value, a, json, .{});
    }

    fn save(s: *Store) !void {
        const data = try std.json.Stringify.valueAlloc(s.gpa, s.current, .{ .whitespace = .indent_2 });
        defer s.gpa.free(data);
        const cwd = Io.Dir.cwd();
        if (std.fs.path.dirname(s.path)) |d| try cwd.createDirPath(s.io, d);
        try cwd.writeFile(s.io, .{ .sub_path = s.path, .data = data });
    }

    /// Merges a JSON patch (a Partial<AppConfig> from the renderer) into the config and saves it.
    /// Arrays are replaced, not merged, like a JS object spread.
    pub fn update(s: *Store, patch: std.json.Value) !AppConfig {
        if (patch != .object) return error.InvalidPatch;
        var tmp: std.heap.ArenaAllocator = .init(s.gpa);
        defer tmp.deinit();
        const a = tmp.allocator();
        var base = try toValue(a, s.current);
        var it = patch.object.iterator();
        while (it.next()) |kv| try base.object.put(a, kv.key_ptr.*, kv.value_ptr.*);
        try s.parse(try std.json.Stringify.valueAlloc(a, base, .{}));
        try s.save();
        return s.current;
    }
};
