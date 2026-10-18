package main

import (
	"context"
	"errors"
	"math"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// The bound services below are what the renderer's `window.api` adapter (src/renderer/src/lib/mygoApi.ts)
// calls through the generated client in src/renderer/src/lib/mygo.ts.

var (
	vaultMu sync.RWMutex
	vault   *Vault
)

func getVault() (*Vault, error) {
	vaultMu.RLock()
	defer vaultMu.RUnlock()
	if vault == nil {
		return nil, errors.New("vault is not open yet")
	}
	return vault, nil
}

func setupVault(cfg AppConfig) error {
	v := NewVault(cfg.VaultPath, cfg.ExcludePatterns)
	if err := v.Init(); err != nil {
		return err
	}
	vaultMu.Lock()
	vault = v
	vaultMu.Unlock()
	startWatcher(v.Root)
	return nil
}

func applyTheme(t Theme) {
	switch t {
	case ThemeLight, ThemeDark, ThemeSystem:
		mygo.Theme.SetSource(mygo.ThemeSource(t))
	}
}

// ConfigService reads and updates the app settings.
type ConfigService struct{}

// Get returns the current settings.
func (ConfigService) Get() (AppConfig, error) { return loadConfig() }

// Set merges patch (a Partial<AppConfig>) into the settings. Changing vaultPath re-opens the vault,
// restarts the watcher and sends a vaultChanged event.
func (ConfigService) Set(patch map[string]any) (AppConfig, error) {
	current, err := loadConfig()
	if err != nil {
		return AppConfig{}, err
	}
	next, err := updateConfig(patch)
	if err != nil {
		return AppConfig{}, err
	}
	if _, ok := patch["theme"]; ok {
		applyTheme(next.Theme)
	}
	if next.VaultPath != current.VaultPath {
		if err := setupVault(next); err != nil {
			return AppConfig{}, err
		}
		emitVaultEvent("vaultChanged", next.VaultPath)
		return next, nil
	}
	if _, ok := patch["excludePatterns"]; ok {
		if v, err := getVault(); err == nil {
			v.SetExcludes(next.ExcludePatterns)
		}
	}
	return next, nil
}

// VaultService exposes the notes folder.
type VaultService struct{}

// PickFolder asks for a notes folder; it returns "" when the user cancels.
func (VaultService) PickFolder(ctx context.Context) (string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:            mygo.CallerWindow(ctx),
		Title:             "Choose notes folder",
		Directory:         true,
		CreateDirectories: true,
	})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], nil
}

func withVault[T any](fn func(v *Vault) (T, error)) (T, error) {
	v, err := getVault()
	if err != nil {
		var zero T
		return zero, err
	}
	return fn(v)
}

func (VaultService) Tree() ([]TreeNode, error) { return withVault((*Vault).Tree) }

func (VaultService) Read(rel string) (NoteFile, error) {
	return withVault(func(v *Vault) (NoteFile, error) { return v.Read(rel) })
}

func (VaultService) Write(rel, content string) (WriteResult, error) {
	return withVault(func(v *Vault) (WriteResult, error) { return v.Write(rel, content) })
}

func (VaultService) Create(rel, content string) (string, error) {
	return withVault(func(v *Vault) (string, error) { return v.Create(rel, content) })
}

func (VaultService) Mkdir(rel string) (string, error) {
	return withVault(func(v *Vault) (string, error) { return v.Mkdir(rel) })
}

func (VaultService) Rename(from, to string) (string, error) {
	return withVault(func(v *Vault) (string, error) { return v.Rename(from, to) })
}

func (VaultService) Delete(rel string) error {
	_, err := withVault(func(v *Vault) (struct{}, error) { return struct{}{}, v.Delete(rel) })
	return err
}

func (VaultService) Search(query string) ([]SearchHit, error) {
	return withVault(func(v *Vault) ([]SearchHit, error) { return v.Search(query, 500) })
}

func (VaultService) Exists(rel string) (bool, error) {
	return withVault(func(v *Vault) (bool, error) { return v.Exists(rel), nil })
}

func (VaultService) Scan() ([]NoteIndex, error) { return withVault((*Vault).Scan) }

// WriteBinary writes an attachment; data arrives base64-encoded.
func (VaultService) WriteBinary(rel string, data []byte) (string, error) {
	return withVault(func(v *Vault) (string, error) { return v.WriteBinary(rel, data) })
}

// Replace does a literal find/replace across the given notes (or all when paths is empty).
func (VaultService) Replace(find, replacement string, paths []string, matchCase bool) (ReplaceResult, error) {
	return withVault(func(v *Vault) (ReplaceResult, error) { return v.Replace(find, replacement, paths, matchCase) })
}

// ShellService opens things outside the app.
type ShellService struct{}

var externalURLRe = regexp.MustCompile(`(?i)^(https?|mailto):`)

// OpenExternal opens an http(s) or mailto link in the default app.
func (ShellService) OpenExternal(url string) error {
	if !externalURLRe.MatchString(url) {
		return nil
	}
	return mygo.Shell.OpenExternal(url)
}

// ShowInFolder reveals a vault entry in Explorer / Finder / the file manager.
func (ShellService) ShowInFolder(rel string) error {
	_, err := withVault(func(v *Vault) (struct{}, error) { return struct{}{}, v.ShowInFolder(rel) })
	return err
}

// ExportService saves notes outside the vault.
type ExportService struct{}

// File shows a save dialog and writes content there; kind "pdf" renders the HTML in a hidden page.
// It returns the chosen path, or "" when the user cancels.
func (ExportService) File(ctx context.Context, kind, suggestedName, content string) (string, error) {
	names := map[string]string{"pdf": "PDF", "html": "HTML", "md": "Markdown"}
	name, ok := names[kind]
	if !ok {
		return "", errors.New("unknown export kind: " + kind)
	}
	target, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		DefaultPath: suggestedName + "." + kind,
		Filters:     []mygo.FileFilter{{Name: name, Extensions: []string{kind}}},
	})
	if err != nil || target == "" {
		return "", err
	}
	data := []byte(content)
	if kind == "pdf" {
		if data, err = printToPDF(content); err != nil {
			return "", err
		}
	}
	return target, os.WriteFile(target, data, 0o644)
}

func printToPDF(html string) ([]byte, error) {
	win := mygo.NewWindow(mygo.WindowOptions{Hidden: true, SkipTaskbar: true})
	defer win.Destroy()
	page := win.Page()
	loaded := make(chan struct{}, 1)
	page.OnDidFinishLoad(func() {
		select {
		case loaded <- struct{}{}:
		default:
		}
	})
	page.LoadHTML(html, "")
	select {
	case <-loaded:
	case <-time.After(20 * time.Second):
		return nil, errors.New("timed out rendering the PDF")
	}
	return page.PrintToPDF(mygo.PDFOptions{
		PageSize:   mygo.PageA4,
		Margins:    &mygo.Margins{Top: 0.6, Right: 0.6, Bottom: 0.6, Left: 0.6},
		Background: true,
	})
}

// ViewService controls the window's page.
type ViewService struct{}

// Chrome's preset zoom steps: fractional zoom levels make text render blurry on Windows.
var zoomSteps = []float64{0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2}

const zoomResetIdx = 4

// Zoom zooms the whole UI ("in", "out" or "reset") and returns the new zoom factor.
func (ViewService) Zoom(ctx context.Context, dir string) (float64, error) {
	win := mygo.CallerWindow(ctx)
	if win == nil || win.Page() == nil {
		return 1, errors.New("no window")
	}
	page := win.Page()
	current := page.ZoomFactor()
	idx := zoomResetIdx
	for i, z := range zoomSteps {
		if math.Abs(z-current) < 0.01 {
			idx = i
		}
	}
	switch dir {
	case "reset":
		idx = zoomResetIdx
	case "in":
		idx = min(len(zoomSteps)-1, idx+1)
	case "out":
		idx = max(0, idx-1)
	}
	factor := zoomSteps[idx]
	page.SetZoomFactor(factor)
	if _, err := updateConfig(map[string]any{"zoomLevel": factor}); err != nil {
		return factor, err
	}
	return factor, nil
}
