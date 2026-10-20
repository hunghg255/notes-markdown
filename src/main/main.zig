//! Notes is a local-first markdown notes app: a myzig window showing the React renderer in
//! src/renderer, with the vault (a folder of .md files) handled here in Zig.
const std = @import("std");
const myzig = @import("myzig");
const assets = @import("assets");
const services = @import("services.zig");
const config = @import("config.zig");
const watcher = @import("watcher.zig");

const app_name = "Notes";

var state: services.State = undefined;
var shown = false;

/// vault://localhost/<relative path> (http://vault.localhost/… on Windows) serves images and
/// attachments from inside the notes folder.
fn serveVaultFile(_: ?*anyopaque, req: *myzig.SchemeRequest) void {
    var arena: std.heap.ArenaAllocator = .init(state.app.gpa);
    defer arena.deinit();
    const a = arena.allocator();
    const v = state.getVault() catch return req.respond(404, &.{}, "Not Found");
    const rel = percentDecode(a, std.mem.trimStart(u8, req.path, "/")) catch return req.respond(400, &.{}, "Bad Request");
    const abs = v.resolve(a, rel) catch return req.respond(404, &.{}, "Not Found");
    const data = std.Io.Dir.cwd().readFileAlloc(state.app.io, abs, a, .limited(512 << 20)) catch return req.respond(404, &.{}, "Not Found");
    req.respond(200, &.{.{ .name = "Content-Type", .value = mimeType(abs) }}, data);
}

fn percentDecode(a: std.mem.Allocator, s: []const u8) ![]const u8 {
    var out: std.ArrayList(u8) = .empty;
    var i: usize = 0;
    while (i < s.len) : (i += 1) {
        if (s[i] != '%') {
            try out.append(a, s[i]);
            continue;
        }
        if (i + 2 >= s.len) return error.BadEscape;
        try out.append(a, try std.fmt.parseInt(u8, s[i + 1 .. i + 3], 16));
        i += 2;
    }
    return out.items;
}

fn mimeType(path: []const u8) []const u8 {
    const ext = std.fs.path.extension(path);
    const table = [_][2][]const u8{
        .{ ".png", "image/png" },                 .{ ".jpg", "image/jpeg" },  .{ ".jpeg", "image/jpeg" },
        .{ ".gif", "image/gif" },                 .{ ".webp", "image/webp" }, .{ ".svg", "image/svg+xml" },
        .{ ".avif", "image/avif" },               .{ ".bmp", "image/bmp" },   .{ ".ico", "image/x-icon" },
        .{ ".pdf", "application/pdf" },           .{ ".mp4", "video/mp4" },   .{ ".webm", "video/webm" },
        .{ ".mp3", "audio/mpeg" },                .{ ".wav", "audio/wav" },   .{ ".md", "text/markdown; charset=utf-8" },
        .{ ".txt", "text/plain; charset=utf-8" },
    };
    for (table) |kv| if (std.ascii.eqlIgnoreCase(ext, kv[0])) return kv[1];
    return "application/octet-stream";
}

/// Shows the window once the renderer is in it (no white flash), and tells the page how much room
/// the window controls take over it (`--myzig-titlebar-inset-*`, used by the tab bar).
fn onPage(_: *services.State, win: *myzig.Window, e: myzig.PageEvent) void {
    switch (e) {
        .dom_ready => {
            const area = win.titleBar();
            var buf: [256]u8 = undefined;
            const js = std.fmt.bufPrint(&buf, "document.documentElement.style.setProperty('--myzig-titlebar-inset-left','{d}px');document.documentElement.style.setProperty('--myzig-titlebar-inset-right','{d}px')", .{ area.left, area.right }) catch return;
            win.eval(js);
            if (!shown and !state.app.flags.hidden) {
                shown = true;
                win.show();
            }
        },
        else => {},
    }
}

pub fn main(init: std.process.Init) !void {
    const gpa = init.gpa;
    const app = try myzig.App.create(init, .{ .name = app_name, .id = "com.giahung.notes-markdown" });
    defer app.destroy();

    state = .{ .app = app, .config = try config.Store.init(gpa, init.io, app_name, app.flags.hidden), .watcher = try .init(app) };
    defer state.deinit();
    const schemes = [_]myzig.Scheme{.{ .name = "vault", .handler = .{ .ctx = null, .func = serveVaultFile } }};
    state.schemes = &schemes;

    var config_svc: services.ConfigService = .{ .s = &state };
    var vault_svc: services.VaultService = .{ .s = &state };
    var shell_svc: services.ShellService = .{ .s = &state };
    var export_svc: services.ExportService = .{ .s = &state };
    var view_svc: services.ViewService = .{ .s = &state };
    try app.bind(&config_svc);
    try app.bind(&vault_svc);
    try app.bind(&shell_svc);
    try app.bind(&export_svc);
    try app.bind(&view_svc);
    try app.registerEvent(watcher.VaultChanged);

    // `--myzig-generate` only writes the client: no vault, no window
    if (app.flags.generate_dir == null) {
        const cfg = state.config.current;
        state.applyTheme(cfg.theme);
        state.setupVault(cfg) catch |err| std.log.err("vault {s}: {t}", .{ cfg.vaultPath, err });

        // restore the zoom the user picked with Ctrl+= / Ctrl+-
        const zoom = if (cfg.zoomLevel >= 0.5 and cfg.zoomLevel <= 3) cfg.zoomLevel else 1;
        // `myzig dev` points the window at Vite's dev server
        const url = init.environ_map.get("MYZIG_DEV_URL") orelse "/";
        _ = try app.newWindow(.{
            .title = "Notes",
            .width = 1280,
            .height = 820,
            .min_width = 720,
            .min_height = 480,
            .state = myzig.windowState("main"),
            .visible = false,
            .title_bar = .hidden,
            .title_bar_height = 40,
            .content = .{ .page = .{
                .url = url,
                .assets = &assets.files,
                .schemes = &schemes,
                .zoom = zoom,
                .on_event = .of(&state, onPage),
            } },
        });
    }
    try app.run();
}

test {
    _ = @import("exclude.zig");
    _ = @import("indexnote.zig");
    _ = @import("vault.zig");
}
