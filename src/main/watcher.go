package main

import (
	"context"
	"log"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// VaultChanged forwards changes on disk (and vault switches) to every window.
var VaultChanged = mygo.NewEvent[VaultEvent]("vault:changed")

var (
	watchMu   sync.Mutex
	stopWatch context.CancelFunc
)

// startWatcher watches the vault root recursively, replacing any previous watch.
// Dotfiles and our own atomic-write `.tmp` files are ignored so our writes don't double-fire.
func startWatcher(root string) {
	watchMu.Lock()
	defer watchMu.Unlock()
	if stopWatch != nil {
		stopWatch()
	}
	ctx, cancel := context.WithCancel(context.Background())
	stopWatch = cancel

	w, err := mygo.WatchFiles(ctx, root, mygo.FileWatchOptions{
		Recursive:  true,
		Debounce:   200 * time.Millisecond,
		MaxEntries: 1 << 17,
		Ignore: func(p string, isDir bool) bool {
			base := path.Base(p)
			return p != "." && (strings.HasPrefix(base, ".") || strings.HasSuffix(base, ".tmp"))
		},
	})
	if err != nil {
		log.Printf("watch %s: %v", root, err)
		return
	}
	go func() {
		defer w.Close()
		for {
			events, err := w.Next(ctx)
			if err != nil {
				return // closed, or the vault folder went away
			}
			for _, e := range events {
				if e.Path == "." {
					continue
				}
				switch e.Op {
				case mygo.FileCreate:
					emitVaultEvent(addType(e.IsDir), e.Path)
				case mygo.FileWrite:
					if !e.IsDir {
						emitVaultEvent("change", e.Path)
					}
				case mygo.FileRemove:
					emitVaultEvent(unlinkType(e.IsDir), e.Path)
				case mygo.FileRename:
					emitVaultEvent(unlinkType(e.IsDir), e.OldPath)
					emitVaultEvent(addType(e.IsDir), e.Path)
				}
			}
		}
	}()
}

func addType(isDir bool) string {
	if isDir {
		return "addDir"
	}
	return "add"
}

func unlinkType(isDir bool) string {
	if isDir {
		return "unlinkDir"
	}
	return "unlink"
}

func emitVaultEvent(typ, rel string) {
	_ = VaultChanged.Broadcast(VaultEvent{Type: typ, Path: rel})
}
