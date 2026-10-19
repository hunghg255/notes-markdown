//! Asks for a folder. myzig's Windows open dialog picks single files only for now, so on Windows
//! this drives the shell's IFileOpenDialog with FOS_PICKFOLDERS through its COM vtable; elsewhere
//! it is `myzig.dialog.open` with directories only.
const std = @import("std");
const builtin = @import("builtin");
const myzig = @import("myzig");

/// The folder chosen, allocated with `a`, or null when the user canceled.
pub fn pick(a: std.mem.Allocator, window: *myzig.Window, title: []const u8) !?[]const u8 {
    if (builtin.os.tag == .windows) return win.pick(a, if (window.hwnd) |h| @ptrCast(h) else null, title);
    const paths = (try myzig.dialog.open(a, .{ .title = title, .files = false, .directories = true })) orelse return null;
    return if (paths.len > 0) paths[0] else null;
}

const win = struct {
    const GUID = extern struct { data1: u32, data2: u16, data3: u16, data4: [8]u8 };
    const HRESULT = i32;
    /// A COM object: a pointer to its vtable.
    const Object = *const extern struct { vtbl: [*]const *const anyopaque };

    const CLSID_FileOpenDialog: GUID = .{ .data1 = 0xdc1c5a9c, .data2 = 0xe88a, .data3 = 0x4dde, .data4 = .{ 0xa5, 0xa1, 0x60, 0xf8, 0x2a, 0x20, 0xae, 0xf7 } };
    const IID_IFileOpenDialog: GUID = .{ .data1 = 0xd57c7288, .data2 = 0xd4ad, .data3 = 0x4768, .data4 = .{ 0xbe, 0x02, 0x9d, 0x96, 0x95, 0x32, 0xd9, 0x60 } };

    const CLSCTX_INPROC_SERVER = 1;
    const COINIT_APARTMENTTHREADED = 2;
    const FOS_PICKFOLDERS = 0x20;
    const FOS_FORCEFILESYSTEM = 0x40;
    const SIGDN_FILESYSPATH: u32 = 0x80058000;
    const ERROR_CANCELLED: HRESULT = @bitCast(@as(u32, 0x800704c7));

    // vtable slots: IUnknown, then IModalWindow::Show, then IFileDialog's methods
    const release = 2;
    const show = 3;
    const set_options = 9;
    const get_options = 10;
    const set_title = 17;
    const get_result = 20;
    // IShellItem
    const get_display_name = 5;

    extern "ole32" fn CoInitializeEx(reserved: ?*anyopaque, flags: u32) callconv(.winapi) HRESULT;
    extern "ole32" fn CoUninitialize() callconv(.winapi) void;
    extern "ole32" fn CoCreateInstance(clsid: *const GUID, outer: ?*anyopaque, ctx: u32, iid: *const GUID, out: *?Object) callconv(.winapi) HRESULT;
    extern "ole32" fn CoTaskMemFree(p: ?*anyopaque) callconv(.winapi) void;

    fn method(obj: Object, comptime slot: usize, comptime F: type) F {
        return @ptrCast(obj.vtbl[slot]);
    }

    fn releaseObj(obj: Object) void {
        _ = method(obj, release, *const fn (Object) callconv(.winapi) u32)(obj);
    }

    fn pick(a: std.mem.Allocator, owner: ?*anyopaque, title: []const u8) !?[]const u8 {
        const init = CoInitializeEx(null, COINIT_APARTMENTTHREADED);
        defer if (init == 0) CoUninitialize();
        var dialog: ?Object = null;
        if (CoCreateInstance(&CLSID_FileOpenDialog, null, CLSCTX_INPROC_SERVER, &IID_IFileOpenDialog, &dialog) < 0 or dialog == null) return error.DialogUnavailable;
        const d = dialog.?;
        defer releaseObj(d);

        var opts: u32 = 0;
        _ = method(d, get_options, *const fn (Object, *u32) callconv(.winapi) HRESULT)(d, &opts);
        _ = method(d, set_options, *const fn (Object, u32) callconv(.winapi) HRESULT)(d, opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
        const wide_title = try std.unicode.utf8ToUtf16LeAllocZ(a, title);
        _ = method(d, set_title, *const fn (Object, [*:0]const u16) callconv(.winapi) HRESULT)(d, wide_title);

        const shown = method(d, show, *const fn (Object, ?*anyopaque) callconv(.winapi) HRESULT)(d, owner);
        if (shown == ERROR_CANCELLED) return null;
        if (shown < 0) return error.DialogFailed;

        var item: ?Object = null;
        if (method(d, get_result, *const fn (Object, *?Object) callconv(.winapi) HRESULT)(d, &item) < 0 or item == null) return null;
        defer releaseObj(item.?);
        var name: ?[*:0]u16 = null;
        if (method(item.?, get_display_name, *const fn (Object, u32, *?[*:0]u16) callconv(.winapi) HRESULT)(item.?, SIGDN_FILESYSPATH, &name) < 0 or name == null) return null;
        defer CoTaskMemFree(name);
        return try std.unicode.utf16LeToUtf8Alloc(a, std.mem.span(name.?));
    }
};
