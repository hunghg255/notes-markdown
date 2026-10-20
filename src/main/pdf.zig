//! Renders an HTML document to a PDF in a hidden window, asynchronously: a bound method is called
//! from inside a WebView2 event handler, where WebView2 raises no events of its own, so the page
//! cannot load while the method waits. The result goes back through the caller's channel.
const std = @import("std");
const myzig = @import("myzig");

/// What an export sends back: the file written, or why it failed.
pub const ExportResult = struct {
    path: []const u8 = "",
    message: []const u8 = "",
};

const Job = struct {
    app: *myzig.App,
    /// Holds the job's strings and its schemes.
    arena: std.heap.ArenaAllocator,
    html: []const u8,
    target: []const u8,
    done: myzig.Channel(ExportResult),
    /// The window that asked: its channel is gone once it closed.
    caller: *myzig.Window,
    window: ?*myzig.Window = null,
    printing: bool = false,
    finished: bool = false,

    fn serve(ctx: ?*anyopaque, req: *myzig.SchemeRequest) void {
        const job: *Job = @ptrCast(@alignCast(ctx));
        if (!std.mem.eql(u8, req.path, "/index.html")) return req.respond(404, &.{}, "Not Found");
        req.respond(200, &.{.{ .name = "Content-Type", .value = "text/html; charset=utf-8" }}, job.html);
    }

    fn onPage(job: *Job, win: *myzig.Window, e: myzig.PageEvent) void {
        switch (e) {
            .load_finished => {
                if (job.printing) return;
                job.printing = true;
                const page = win.page orelse return job.finish("the page is gone");
                page.printToPdf(.{
                    .width = 8.27,
                    .height = 11.69,
                    .margin_top = 0.6,
                    .margin_right = 0.6,
                    .margin_bottom = 0.6,
                    .margin_left = 0.6,
                    .background = true,
                }, .{ .ctx = job, .func = gotPdf });
            },
            .load_failed => |err| job.finish(err.description),
            else => {},
        }
    }

    fn gotPdf(ctx: ?*anyopaque, pdf: ?[]const u8, err: ?[]const u8) void {
        const job: *Job = @ptrCast(@alignCast(ctx));
        const bytes = pdf orelse return job.finish(err orelse "printing failed");
        std.Io.Dir.cwd().writeFile(job.app.io, .{ .sub_path = job.target, .data = bytes }) catch |e| return job.finish(@errorName(e));
        job.finish(null);
    }

    /// Reports the result, then closes the window and frees the job on the next turn (not from
    /// inside a handler of the page's).
    fn finish(job: *Job, failure: ?[]const u8) void {
        if (job.finished) return;
        job.finished = true;
        const open = for (job.app.windows.items) |w| {
            if (w == job.caller) break true;
        } else false;
        if (open) {
            job.done.send(if (failure) |m| .{ .message = m } else .{ .path = job.target }) catch {};
            job.done.close();
        }
        myzig.App.after(0, job, cleanup);
    }

    fn cleanup(ctx: ?*anyopaque) callconv(.c) void {
        const job: *Job = @ptrCast(@alignCast(ctx));
        if (job.window) |w| w.close();
        const gpa = job.app.gpa;
        job.arena.deinit();
        gpa.destroy(job);
    }
};

/// Starts rendering `html` (A4, 0.6 inch margins, with backgrounds) to `target`; `done` gets the
/// result. `schemes` are served to the page besides the document (`vault://` for images).
pub fn start(app: *myzig.App, caller: *myzig.Window, html: []const u8, target: []const u8, schemes: []const myzig.Scheme, done: myzig.Channel(ExportResult)) !void {
    const job = try app.gpa.create(Job);
    errdefer app.gpa.destroy(job);
    job.* = .{ .app = app, .arena = .init(app.gpa), .html = undefined, .target = undefined, .done = done, .caller = caller };
    errdefer job.arena.deinit();
    const a = job.arena.allocator();
    job.html = try a.dupe(u8, html);
    job.target = try a.dupe(u8, target);
    var all: std.ArrayList(myzig.Scheme) = .empty;
    try all.append(a, .{ .name = "export", .handler = .{ .ctx = job, .func = Job.serve } });
    try all.appendSlice(a, schemes);
    job.window = try app.newWindow(.{
        .title = "Export",
        .visible = false,
        .skip_taskbar = true,
        .content = .{ .page = .{
            .url = "export://localhost/index.html",
            .schemes = all.items,
            .inspectable = false,
            .on_event = .of(job, Job.onPage),
        } },
    });
}
