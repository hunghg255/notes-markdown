package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
)

var (
	configMu    sync.Mutex
	configCache *AppConfig
)

func configPath() (string, error) {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

// legacyConfigPath is where the Electron build kept its config (userData = %AppData%/notes-markdown).
func legacyConfigPath() string {
	dir, err := mygo.App.Path(mygo.PathAppData)
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "notes-markdown", "config.json")
}

func defaultConfig() AppConfig {
	desktop, err := mygo.App.Path(mygo.PathDesktop)
	if err != nil {
		home, _ := os.UserHomeDir()
		desktop = filepath.Join(home, "Desktop")
	}
	return AppConfig{
		VaultPath: filepath.Join(desktop, "Notes"),
		Theme:     ThemeDark,
		Accent:    "orange",
		FontSize:  16,
		Autosave:  true,
	}
}

func loadConfig() (AppConfig, error) {
	configMu.Lock()
	defer configMu.Unlock()
	return loadConfigLocked()
}

func loadConfigLocked() (AppConfig, error) {
	if configCache != nil {
		return *configCache, nil
	}
	p, err := configPath()
	if err != nil {
		return AppConfig{}, err
	}
	cfg := defaultConfig()
	raw, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		// first run of the MyGo build: carry over the Electron build's settings
		if legacy := legacyConfigPath(); legacy != "" {
			raw, err = os.ReadFile(legacy)
		}
	}
	if err == nil && json.Unmarshal(raw, &cfg) == nil {
		configCache = &cfg
		return cfg, nil
	}
	cfg = defaultConfig()
	if err := saveConfigLocked(cfg); err != nil {
		return AppConfig{}, err
	}
	return cfg, nil
}

func saveConfigLocked(next AppConfig) error {
	configCache = &next
	p, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}

// updateConfig merges a JSON patch (a Partial<AppConfig> from the renderer) into the config.
func updateConfig(patch map[string]any) (AppConfig, error) {
	configMu.Lock()
	defer configMu.Unlock()
	current, err := loadConfigLocked()
	if err != nil {
		return AppConfig{}, err
	}
	raw, err := json.Marshal(patch)
	if err != nil {
		return AppConfig{}, err
	}
	next := current
	// slices are replaced, not merged, like a JS object spread
	if _, ok := patch["excludePatterns"]; ok {
		next.ExcludePatterns = nil
	}
	if err := json.Unmarshal(raw, &next); err != nil {
		return AppConfig{}, err
	}
	if err := saveConfigLocked(next); err != nil {
		return AppConfig{}, err
	}
	return next, nil
}
