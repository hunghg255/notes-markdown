//! The bound services: what the renderer's `window.api` adapter (src/renderer/src/lib/myzigApi.ts)
//! calls through the generated client (src/renderer/myzig.js). Bound methods run on the main
//! thread, one at a time, so the shared state needs no locks.
const std = @import("std");
const myzig = @import("myzig");
const types = @import("types.zig");
const config = @import("config.zig");
const vault_mod = @import("vault.zig");
const watcher = @import("watcher.zig");
const folder_dialog = @import("folder_dialog.zig");
const pdf = @import("pdf.zig");

const Vault = vault_mod.Vault;
const Allocator = std.mem.Allocator;

/// What the services share: the settings, the open vault and its watch.
pub const State = struct {
    app: *myzig.App,
    config: config.Store,
    vault: ?*Vault = null,
    watcher: watcher.VaultWatcher,
    /// Served to pages besides the frontend (`vault://`); set by main.
    schemes: []const myzig.Scheme = &.{},

    pub fn deinit(s: *State) void {
        s.watcher.stop();
        if (s.vault) |v| v.deinit();
        s.config.deinit();
    }

    pub fn getVault(s: *State) !*Vault {
        return s.vault orelse error.VaultIsNotOpenYet;
    }

    /// Opens the vault of `cfg` and watches it, replacing the one open.
    pub fn setupVault(s: *State, cfg: types.AppConfig) !void {
        const v = try Vault.init(s.app.gpa, s.app.io, cfg.vaultPath, cfg.excludePatterns);
        errdefer v.deinit();
        try v.setup();
        s.watcher.stop();
        if (s.vault) |old| old.deinit();
        s.vault = v;
        s.watcher.start(v.root);
    }

    pub fn applyTheme(s: *State, t: types.Theme) void {
        s.app.setAppearance(switch (t) {
            .light => .light,
            .dark => .dark,
            .system => .system,
        });
    }
};

/// Reads and updates the app settings.
pub const ConfigService = struct {
    s: *State,

    pub const myzig_name = "Config";
    pub const myzig_params = .{ .set = .{"patch"} };

    pub fn get(svc: *ConfigService) types.AppConfig {
        return svc.s.config.current;
    }

    /// Merges `patch` (a Partial<AppConfig>) into the settings. Changing vaultPath re-opens the
    /// vault, restarts the watcher and sends a vaultChanged event.
    pub fn set(svc: *ConfigService, call: *myzig.Call, patch: std.json.Value) !types.AppConfig {
        const s = svc.s;
        // `update` frees the old settings' strings
        const old_vault = try call.arena.dupe(u8, s.config.current.vaultPath);
        const next = try s.config.update(patch);
        if (patch.object.get("theme") != null) s.applyTheme(next.theme);
        if (!std.mem.eql(u8, next.vaultPath, old_vault)) {
            try s.setupVault(next);
            watcher.emit(s.app, "vaultChanged", next.vaultPath);
            return next;
        }
        if (patch.object.get("excludePatterns") != null) if (s.vault) |v| try v.setExcludes(next.excludePatterns);
        return next;
    }
};

/// Exposes the notes folder.
pub const VaultService = struct {
    s: *State,

    pub const myzig_name = "Vault";
    pub const myzig_params = .{
        .read = .{"rel"},
        .write = .{ "rel", "content" },
        .create = .{ "rel", "content" },
        .mkdir = .{"rel"},
        .rename = .{ "from", "to" },
        .delete = .{"rel"},
        .search = .{"query"},
        .exists = .{"rel"},
        .writeBinary = .{ "rel", "data" },
        .replace = .{ "find", "replacement", "paths", "matchCase" },
    };

    /// Asks for a notes folder; "" when the user cancels.
    pub fn pickFolder(_: *VaultService, call: *myzig.Call) ![]const u8 {
        return (try folder_dialog.pick(call.arena, call.window, "Choose notes folder")) orelse "";
    }

    pub fn tree(svc: *VaultService, call: *myzig.Call) ![]const types.TreeNode {
        return (try svc.s.getVault()).tree(call.arena);
    }

    pub fn read(svc: *VaultService, call: *myzig.Call, rel: []const u8) !types.NoteFile {
        return (try svc.s.getVault()).read(call.arena, rel);
    }

    pub fn write(svc: *VaultService, call: *myzig.Call, rel: []const u8, content: []const u8) !types.WriteResult {
        return (try svc.s.getVault()).write(call.arena, rel, content);
    }

    pub fn create(svc: *VaultService, call: *myzig.Call, rel: []const u8, content: []const u8) ![]const u8 {
        return (try svc.s.getVault()).create(call.arena, rel, content);
    }

    pub fn mkdir(svc: *VaultService, call: *myzig.Call, rel: []const u8) ![]const u8 {
        return (try svc.s.getVault()).mkdir(call.arena, rel);
    }

    pub fn rename(svc: *VaultService, call: *myzig.Call, from: []const u8, to: []const u8) ![]const u8 {
        return (try svc.s.getVault()).rename(call.arena, from, to);
    }

    pub fn delete(svc: *VaultService, call: *myzig.Call, rel: []const u8) !void {
        return (try svc.s.getVault()).delete(call.arena, rel);
    }

    pub fn search(svc: *VaultService, call: *myzig.Call, query: []const u8) ![]types.SearchHit {
        return (try svc.s.getVault()).search(call.arena, query, 500);
    }

    pub fn exists(svc: *VaultService, call: *myzig.Call, rel: []const u8) !bool {
        return (try svc.s.getVault()).exists(call.arena, rel);
    }

    pub fn scan(svc: *VaultService, call: *myzig.Call) ![]types.NoteIndex {
        return (try svc.s.getVault()).scan(call.arena);
    }

    /// Writes an attachment; `data` arrives base64-encoded.
    pub fn writeBinary(svc: *VaultService, call: *myzig.Call, rel: []const u8, data: []const u8) ![]const u8 {
        const dec = std.base64.standard.Decoder;
        const bytes = try call.arena.alloc(u8, try dec.calcSizeForSlice(data));
        try dec.decode(bytes, data);
        return (try svc.s.getVault()).writeBinary(call.arena, rel, bytes);
    }

    /// A literal find/replace across the given notes (or all when `paths` is empty).
    pub fn replace(svc: *VaultService, call: *myzig.Call, find: []const u8, replacement: []const u8, paths: []const []const u8, matchCase: bool) !types.ReplaceResult {
        return (try svc.s.getVault()).replace(call.arena, find, replacement, paths, matchCase);
    }
};

/// Opens things outside the app.
pub const ShellService = struct {
    s: *State,

    pub const myzig_name = "Shell";
    pub const myzig_params = .{ .openExternal = .{"url"}, .showInFolder = .{"rel"} };

    /// Opens an http(s) or mailto link in the default app.
    pub fn openExternal(_: *ShellService, url: []const u8) void {
        for ([_][]const u8{ "http:", "https:", "mailto:" }) |scheme| {
            if (std.ascii.startsWithIgnoreCase(url, scheme)) {
                _ = myzig.shell.openUrl(url);
                return;
            }
        }
    }

    /// Reveals a vault entry in Explorer / Finder / the file manager.
    pub fn showInFolder(svc: *ShellService, call: *myzig.Call, rel: []const u8) !void {
        return (try svc.s.getVault()).showInFolder(call.arena, rel);
    }
};

/// Saves notes outside the vault.
pub const ExportService = struct {
    s: *State,

    pub const myzig_name = "Export";
    pub const myzig_params = .{ .file = .{ "kind", "suggestedName", "content", "done" } };

    /// Shows a save dialog and writes `content` there; kind "pdf" renders the HTML in a hidden page.
    /// `done` gets the path written (an empty one when the user cancels), or the failure's message,
    /// once the file is written: a PDF only renders after this method returns (see pdf.zig).
    pub fn file(svc: *ExportService, call: *myzig.Call, kind: []const u8, suggestedName: []const u8, content: []const u8, done: myzig.Channel(pdf.ExportResult)) !void {
        const known = for ([_][]const u8{ "pdf", "html", "md" }) |k| {
            if (std.mem.eql(u8, k, kind)) break true;
        } else false;
        if (!known) return error.UnknownExportKind;
        const a = call.arena;
        const target = (try myzig.dialog.save(a, .{
            .name = try std.fmt.allocPrint(a, "{s}.{s}", .{ suggestedName, kind }),
            .extensions = &.{kind},
        })) orelse {
            try done.send(.{});
            return done.close();
        };
        if (std.mem.eql(u8, kind, "pdf")) return pdf.start(svc.s.app, call.window, content, target, svc.s.schemes, done);
        try std.Io.Dir.cwd().writeFile(svc.s.app.io, .{ .sub_path = target, .data = content });
        try done.send(.{ .path = target });
        done.close();
    }
};

/// Controls the window's page.
pub const ViewService = struct {
    s: *State,

    pub const myzig_name = "View";
    pub const myzig_params = .{ .zoom = .{"dir"} };

    /// Chrome's preset zoom steps: fractional zoom levels make text render blurry on Windows.
    const steps = [_]f64{ 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2 };
    const reset_index = 4;

    /// Zooms the whole UI ("in", "out" or "reset") and returns the new zoom factor.
    pub fn zoom(svc: *ViewService, call: *myzig.Call, dir: []const u8) !f64 {
        const page = call.window.page orelse return error.NoWindow;
        const current = page.zoom();
        var idx: usize = reset_index;
        for (steps, 0..) |z, i| if (@abs(z - current) < 0.01) {
            idx = i;
        };
        if (std.mem.eql(u8, dir, "reset")) {
            idx = reset_index;
        } else if (std.mem.eql(u8, dir, "in")) {
            idx = @min(steps.len - 1, idx + 1);
        } else if (std.mem.eql(u8, dir, "out")) {
            idx -|= 1;
        }
        const factor = steps[idx];
        page.setZoom(factor);
        var patch: std.json.ObjectMap = .empty;
        try patch.put(call.arena, "zoomLevel", .{ .float = factor });
        _ = try svc.s.config.update(.{ .object = patch });
        return factor;
    }
};
