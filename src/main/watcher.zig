//! One recursive watch on the vault root (the watch plugin). Changes are mapped to the renderer's
//! add/change/unlink(/Dir) `VaultEvent`s and broadcast through the typed event `VaultChanged`.
//! Dotfiles and our own atomic-write `.tmp` files are ignored so our writes don't double-fire.
const std = @import("std");
const myzig = @import("myzig");
const watch = @import("watch");
const mainthread = @import("mainthread");
const types = @import("types.zig");

/// Forwards changes on disk (and vault switches) to every window.
pub const VaultChanged = myzig.Event("vault:changed", types.VaultEvent);

pub fn emit(app: *myzig.App, typ: []const u8, path: []const u8) void {
    VaultChanged.broadcast(app, .{ .type = typ, .path = path });
}

fn ignore(_: ?*anyopaque, path: []const u8, _: bool) bool {
    const base = std.fs.path.basenamePosix(path);
    return !std.mem.eql(u8, path, ".") and (std.mem.startsWith(u8, base, ".") or std.mem.endsWith(u8, base, ".tmp"));
}

/// A batch of changes on its way to the main thread.
const Batch = struct {
    watcher: *VaultWatcher,
    /// Which watch it came from: batches of a replaced watch are dropped.
    serial: u32,
    arena: std.heap.ArenaAllocator,
    events: []watch.Event,
};

pub const VaultWatcher = struct {
    app: *myzig.App,
    w: ?*watch.Watcher = null,
    future: ?std.Io.Future(void) = null,
    serial: u32 = 0,

    pub fn init(app: *myzig.App) !VaultWatcher {
        try mainthread.init();
        return .{ .app = app };
    }

    /// Watches `root` recursively, replacing any previous watch. Main thread.
    pub fn start(vw: *VaultWatcher, root: []const u8) void {
        vw.stop();
        const io = vw.app.io;
        const w = watch.Watcher.init(vw.app.gpa, io, root, .{
            .recursive = true,
            .ignore = ignore,
            .debounce_ms = 200,
            .max_entries = 1 << 17,
        }) catch |err| {
            std.log.err("watch {s}: {t}", .{ root, err });
            return;
        };
        vw.serial +%= 1;
        vw.w = w;
        vw.future = io.concurrent(run, .{ vw, w, vw.serial }) catch |err| {
            std.log.err("watch {s}: {t}", .{ root, err });
            w.deinit();
            vw.w = null;
            return;
        };
    }

    pub fn stop(vw: *VaultWatcher) void {
        const w = vw.w orelse return;
        w.close();
        if (vw.future) |*f| f.cancel(vw.app.io);
        w.deinit();
        vw.w = null;
        vw.future = null;
    }

    fn run(vw: *VaultWatcher, w: *watch.Watcher, serial: u32) void {
        const gpa = vw.app.gpa;
        while (true) {
            var arena: std.heap.ArenaAllocator = .init(gpa);
            // closed, canceled, or the vault folder went away
            const events = w.next(arena.allocator()) catch {
                arena.deinit();
                return;
            };
            const batch = gpa.create(Batch) catch {
                arena.deinit();
                continue;
            };
            batch.* = .{ .watcher = vw, .serial = serial, .arena = arena, .events = events };
            if (!mainthread.post(batch, deliver)) {
                batch.arena.deinit();
                gpa.destroy(batch);
            }
        }
    }

    fn deliver(ctx: ?*anyopaque) callconv(.c) void {
        const batch: *Batch = @ptrCast(@alignCast(ctx));
        const vw = batch.watcher;
        defer {
            batch.arena.deinit();
            vw.app.gpa.destroy(batch);
        }
        if (batch.serial != vw.serial or vw.w == null) return;
        for (batch.events) |e| {
            if (std.mem.eql(u8, e.path, ".")) continue;
            switch (e.op) {
                .create => emit(vw.app, if (e.is_dir) "addDir" else "add", e.path),
                .write => if (!e.is_dir) emit(vw.app, "change", e.path),
                .remove => emit(vw.app, if (e.is_dir) "unlinkDir" else "unlink", e.path),
                .rename => {
                    if (e.old_path) |old| emit(vw.app, if (e.is_dir) "unlinkDir" else "unlink", old);
                    emit(vw.app, if (e.is_dir) "addDir" else "add", e.path);
                },
            }
        }
    }
};
