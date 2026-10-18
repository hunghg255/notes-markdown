// Notes is a local-first markdown notes app: a MyGo window showing the React renderer in
// src/renderer, with the vault (a folder of .md files) handled here in Go.
package main

import (
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/egoist/mygo"
)

func main() {
	mygo.BindAs("Config", ConfigService{})
	mygo.BindAs("Vault", VaultService{})
	mygo.BindAs("Shell", ShellService{})
	mygo.BindAs("Export", ExportService{})
	mygo.BindAs("View", ViewService{})

	// vault://localhost/<relative path> (http://vault.localhost/… on Windows) serves images and
	// attachments from inside the notes folder
	if err := mygo.Protocol.HandleFunc("vault", serveVaultFile); err != nil {
		log.Fatal(err)
	}

	mygo.App.WhenReady(func() {
		cfg, err := loadConfig()
		if err != nil {
			log.Printf("config: %v", err)
			cfg = defaultConfig()
		}
		applyTheme(cfg.Theme)
		if err := setupVault(cfg); err != nil {
			log.Printf("vault %s: %v", cfg.VaultPath, err)
		}

		// restore the zoom the user picked with Ctrl+= / Ctrl+-
		zoom := 1.0
		if cfg.ZoomLevel >= 0.5 && cfg.ZoomLevel <= 3 {
			zoom = cfg.ZoomLevel
		}
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:                "Notes",
			URL:                  "/",
			Width:                1280,
			Height:               820,
			MinWidth:             720,
			MinHeight:            480,
			StateKey:             "main",
			Hidden:               true,
			BackgroundColor:      "#161616",
			TitleBarStyle:        mygo.TitleBarHidden,
			TitleBarHeight:       40,
			TrafficLightPosition: &mygo.Point{X: 16, Y: 16},
			Page:                 mygo.PageOptions{ZoomFactor: zoom},
		})
		win.OnReadyToShow(win.Show)
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

func serveVaultFile(w http.ResponseWriter, r *http.Request) {
	v, err := getVault()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	rel, err := url.PathUnescape(strings.TrimLeft(r.URL.EscapedPath(), "/"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	abs, err := v.Resolve(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}
