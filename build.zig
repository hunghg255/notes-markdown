const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    // Set by `myzig build`: release builds without debug information, and
    // Windows' icon, manifest and version information.
    const strip = b.option(bool, "strip", "Strip debug information");
    const win32_res = b.option([]const u8, "win32-res", "A compiled resource file (.res) to link on Windows");
    // The built renderer (`vite build` -> out/renderer), embedded into the app;
    // `myzig dev`/`build`/`generate` write its myzig_assets.zig.
    const frontend = b.option([]const u8, "frontend", "The directory of the built frontend") orelse "out/renderer";

    const myzig = b.dependency("myzig", .{ .target = target, .optimize = optimize }).module("myzig");
    const watch = b.dependency("myzig_watch", .{ .target = target, .optimize = optimize }).module("watch");
    const mainthread = b.dependency("mainthread", .{ .target = target, .optimize = optimize }).module("mainthread");
    const root = b.createModule(.{
        .root_source_file = b.path("src/main/main.zig"),
        .target = target,
        .optimize = optimize,
        .strip = strip,
        .imports = &.{
            .{ .name = "myzig", .module = myzig },
            .{ .name = "watch", .module = watch },
            .{ .name = "mainthread", .module = mainthread },
        },
    });
    // Before the first `vite build` (or under `myzig dev`, where Vite serves the renderer)
    // there is no assets module yet: embed nothing.
    const assets_file = b.fmt("{s}/myzig_assets.zig", .{frontend});
    // zig caches this configuration: configure again when the file changes, and on every run
    // until it exists (a missing file can't be tracked)
    const assets_src: std.Build.LazyPath = if (b.root.access(b.graph.io, assets_file, .{})) |_| blk: {
        b.dependOnFileContents(b.path(assets_file));
        break :blk b.path(assets_file);
    } else |_| blk: {
        b.graph.poisonCache();
        break :blk b.addWriteFiles().add("myzig_assets.zig", "const myzig = @import(\"myzig\");\npub const files = [_]myzig.Asset{};\n");
    };
    root.addImport("assets", b.createModule(.{
        .root_source_file = assets_src,
        .imports = &.{.{ .name = "myzig", .module = myzig }},
    }));
    if (win32_res) |res| if (target.result.os.tag == .windows) root.addObjectFile(.{ .cwd_relative = res });

    const exe = b.addExecutable(.{ .name = "notes", .root_module = root });
    // Set by `myzig build`: a Windows app that opens no console.
    if (b.option(bool, "windows-gui", "A Windows app without a console") orelse false) exe.subsystem = .windows;
    b.installArtifact(exe);

    const run = b.addRunArtifact(exe);
    run.addPassthruArgs();
    b.step("run", "Run the app").dependOn(&run.step);

    const tests = b.addTest(.{ .root_module = root });
    b.step("test", "Run the unit tests").dependOn(&b.addRunArtifact(tests).step);
}
