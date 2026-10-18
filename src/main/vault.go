package main

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

const welcome = "# Home\n\n" +
	"Welcome to your notes. Everything here is a plain `.md` file on disk.\n\n" +
	"## Getting started\n\n" +
	"- [ ] Press **Ctrl+P** to search or jump to any note\n" +
	"- [ ] Press **Ctrl+D** to open today's daily note\n" +
	"- [x] Notes are saved automatically\n\n" +
	"## Formatting\n\n" +
	"Inline math like $E = mc^2$, code blocks, and mermaid diagrams render in place:\n\n" +
	"```mermaid\n" +
	"graph LR\n" +
	"  A[Write] --> B[Save]\n" +
	"  B --> C[Sync anywhere]\n" +
	"```\n"

var mdExtRe = regexp.MustCompile(`(?i)\.md$`)

// Vault does every filesystem operation on the notes folder. All paths crossing IPC are
// vault-relative with forward slashes.
type Vault struct {
	Root string

	mu         sync.RWMutex
	isExcluded ExcludeMatcher
}

func NewVault(root string, excludes []string) *Vault {
	return &Vault{Root: filepath.Clean(root), isExcluded: compileExcludes(excludes)}
}

// SetExcludes replaces the user's exclude patterns; takes effect on the next Tree/Scan/Search.
func (v *Vault) SetExcludes(patterns []string) {
	m := compileExcludes(patterns)
	v.mu.Lock()
	v.isExcluded = m
	v.mu.Unlock()
}

func (v *Vault) excluded(rel, name string) bool {
	v.mu.RLock()
	defer v.mu.RUnlock()
	return v.isExcluded(rel, name)
}

// Init ensures the vault folder exists with a minimal starter structure.
func (v *Vault) Init() error {
	if err := os.MkdirAll(v.Root, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(v.Root)
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		_ = os.MkdirAll(filepath.Join(v.Root, "Daily Notes"), 0o755)
		_ = os.MkdirAll(filepath.Join(v.Root, "Templates"), 0o755)
		return os.WriteFile(filepath.Join(v.Root, "Home.md"), []byte(welcome), 0o644)
	}
	return nil
}

// Resolve turns a vault-relative path into an absolute one and refuses anything outside the root.
func (v *Vault) Resolve(rel string) (string, error) {
	abs := filepath.Join(v.Root, filepath.FromSlash(rel))
	if abs != v.Root && !strings.HasPrefix(abs, strings.TrimSuffix(v.Root, string(filepath.Separator))+string(filepath.Separator)) {
		return "", fmt.Errorf("Path escapes vault: %s", rel)
	}
	return abs, nil
}

func (v *Vault) ToRel(abs string) string {
	rel, err := filepath.Rel(v.Root, abs)
	if err != nil {
		return filepath.ToSlash(abs)
	}
	if rel == "." {
		return ""
	}
	return filepath.ToSlash(rel)
}

func msTime(t time.Time) float64 { return float64(t.UnixNano()) / 1e6 }

func (v *Vault) Tree() ([]TreeNode, error) {
	return v.walk(v.Root)
}

func (v *Vault) walk(dir string) ([]TreeNode, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	nodes := []TreeNode{}
	for _, d := range entries {
		name := d.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		// attachment folders hold images pasted into notes, not notes
		if d.IsDir() && strings.EqualFold(name, "attachments") {
			continue
		}
		abs := filepath.Join(dir, name)
		rel := v.ToRel(abs)
		// user-configured exclude patterns (Settings → Storage)
		if v.excluded(rel, name) {
			continue
		}
		info, err := os.Stat(abs)
		if err != nil {
			continue
		}
		if info.IsDir() {
			children, err := v.walk(abs)
			if err != nil {
				children = []TreeNode{}
			}
			nodes = append(nodes, TreeNode{Name: name, Path: rel, Type: "dir", Mtime: msTime(info.ModTime()), Children: children})
		} else if info.Mode().IsRegular() && noteExt.MatchString(name) {
			nodes = append(nodes, TreeNode{Name: noteExt.ReplaceAllString(name, ""), Path: rel, Type: "file", Mtime: msTime(info.ModTime())})
		}
	}
	sort.SliceStable(nodes, func(i, j int) bool {
		a, b := nodes[i], nodes[j]
		if a.Type != b.Type {
			return a.Type == "dir"
		}
		return naturalLess(a.Name, b.Name)
	})
	return nodes, nil
}

// naturalLess approximates localeCompare(…, { numeric: true, sensitivity: 'base' }).
func naturalLess(a, b string) bool {
	a, b = strings.ToLower(a), strings.ToLower(b)
	for a != "" && b != "" {
		ra, _ := utf8.DecodeRuneInString(a)
		rb, _ := utf8.DecodeRuneInString(b)
		if unicode.IsDigit(ra) && unicode.IsDigit(rb) {
			na, nb := leadingDigits(a), leadingDigits(b)
			ta, tb := strings.TrimLeft(na, "0"), strings.TrimLeft(nb, "0")
			if len(ta) != len(tb) {
				return len(ta) < len(tb)
			}
			if ta != tb {
				return ta < tb
			}
			a, b = a[len(na):], b[len(nb):]
			continue
		}
		if ra != rb {
			return ra < rb
		}
		a, b = a[utf8.RuneLen(ra):], b[utf8.RuneLen(rb):]
	}
	return len(a) < len(b)
}

func leadingDigits(s string) string {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	return s[:i]
}

func (v *Vault) Read(rel string) (NoteFile, error) {
	abs, err := v.Resolve(rel)
	if err != nil {
		return NoteFile{}, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return NoteFile{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return NoteFile{}, err
	}
	return NoteFile{Content: string(data), Mtime: msTime(info.ModTime())}, nil
}

// Write replaces a note atomically (.tmp + rename) so the watcher never sees a half-written file.
func (v *Vault) Write(rel, content string) (WriteResult, error) {
	abs, err := v.Resolve(rel)
	if err != nil {
		return WriteResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return WriteResult{}, err
	}
	tmp := fmt.Sprintf("%s.%d.tmp", abs, os.Getpid())
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		return WriteResult{}, err
	}
	if err := os.Rename(tmp, abs); err != nil {
		_ = os.Remove(tmp)
		return WriteResult{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return WriteResult{}, err
	}
	return WriteResult{Mtime: msTime(info.ModTime())}, nil
}

func (v *Vault) Exists(rel string) bool {
	abs, err := v.Resolve(rel)
	if err != nil {
		return false
	}
	_, err = os.Stat(abs)
	return err == nil
}

// Create makes a note; if the name is taken, it appends " 1", " 2", ...
func (v *Vault) Create(rel, content string) (string, error) {
	if !mdExtRe.MatchString(rel) {
		rel += ".md"
	}
	dir := path.Dir(rel)
	base := mdExtRe.ReplaceAllString(path.Base(rel), "")
	candidate := rel
	for i := 1; v.Exists(candidate); i++ {
		candidate = path.Join(dir, fmt.Sprintf("%s %d.md", base, i))
	}
	if _, err := v.Write(candidate, content); err != nil {
		return "", err
	}
	return candidate, nil
}

func (v *Vault) Mkdir(rel string) (string, error) {
	candidate := rel
	for i := 1; v.Exists(candidate); i++ {
		candidate = fmt.Sprintf("%s %d", rel, i)
	}
	abs, err := v.Resolve(candidate)
	if err != nil {
		return "", err
	}
	return candidate, os.MkdirAll(abs, 0o755)
}

func (v *Vault) Rename(from, to string) (string, error) {
	src, err := v.Resolve(from)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(src)
	if err != nil {
		return "", err
	}
	if !mdExtRe.MatchString(to) && !info.IsDir() {
		to += ".md"
	}
	dst, err := v.Resolve(to)
	if err != nil {
		return "", err
	}
	if v.Exists(to) {
		return "", fmt.Errorf("%q already exists", to)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	return to, os.Rename(src, dst)
}

func (v *Vault) Delete(rel string) error {
	if rel == "" {
		return errors.New("refusing to delete the vault root")
	}
	abs, err := v.Resolve(rel)
	if err != nil {
		return err
	}
	return mygo.Shell.TrashItem(abs)
}

func (v *Vault) ShowInFolder(rel string) error {
	abs, err := v.Resolve(rel)
	if err != nil {
		return err
	}
	mygo.Shell.ShowItemInFolder(abs)
	return nil
}

func (v *Vault) ListNotes() ([]string, error) {
	tree, err := v.Tree()
	if err != nil {
		return nil, err
	}
	var files []string
	var collect func(nodes []TreeNode)
	collect = func(nodes []TreeNode) {
		for _, n := range nodes {
			if n.Type == "file" {
				files = append(files, n.Path)
			} else {
				collect(n.Children)
			}
		}
	}
	collect(tree)
	return files, nil
}

// WriteBinary writes an attachment (e.g. a pasted image) and returns the final relative path.
func (v *Vault) WriteBinary(rel string, data []byte) (string, error) {
	dir := path.Dir(rel)
	ext := path.Ext(rel)
	base := strings.TrimSuffix(path.Base(rel), ext)
	candidate := rel
	for i := 1; v.Exists(candidate); i++ {
		candidate = path.Join(dir, fmt.Sprintf("%s-%d%s", base, i, ext))
	}
	abs, err := v.Resolve(candidate)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", err
	}
	return candidate, os.WriteFile(abs, data, 0o644)
}

// Scan extracts tags, links, tasks and headings from every note.
func (v *Vault) Scan() ([]NoteIndex, error) {
	notes, err := v.ListNotes()
	if err != nil {
		return nil, err
	}
	out := []NoteIndex{}
	for _, rel := range notes {
		abs, err := v.Resolve(rel)
		if err != nil {
			continue
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			continue
		}
		info, err := os.Stat(abs)
		if err != nil {
			continue
		}
		idx := indexNote(string(data))
		idx.Path = rel
		idx.Name = mdExtRe.ReplaceAllString(path.Base(rel), "")
		idx.Mtime = msTime(info.ModTime())
		out = append(out, idx)
	}
	return out, nil
}

// Replace does a literal find/replace across the given notes (or all of them when paths is empty).
func (v *Vault) Replace(find, replacement string, paths []string, matchCase bool) (ReplaceResult, error) {
	if find == "" {
		return ReplaceResult{}, nil
	}
	targets := paths
	if len(targets) == 0 {
		var err error
		if targets, err = v.ListNotes(); err != nil {
			return ReplaceResult{}, err
		}
	}
	pattern := regexp.QuoteMeta(find)
	if !matchCase {
		pattern = "(?i)" + pattern
	}
	re := regexp.MustCompile(pattern)
	var res ReplaceResult
	for _, rel := range targets {
		abs, err := v.Resolve(rel)
		if err != nil {
			return res, err
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			return res, err
		}
		content := string(data)
		count := len(re.FindAllStringIndex(content, -1))
		if count == 0 {
			continue
		}
		if _, err := v.Write(rel, re.ReplaceAllLiteralString(content, replacement)); err != nil {
			return res, err
		}
		res.Files++
		res.Replacements += count
	}
	return res, nil
}

// Search is a naive full-text search; fine for personal vaults of a few thousand notes.
func (v *Vault) Search(query string, limit int) ([]SearchHit, error) {
	q := strings.ToLower(query)
	hits := []SearchHit{}
	if q == "" {
		return hits, nil
	}
	files, err := v.ListNotes()
	if err != nil {
		return nil, err
	}
	for _, rel := range files {
		if len(hits) >= limit {
			break
		}
		abs, err := v.Resolve(rel)
		if err != nil {
			continue
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			continue
		}
		for i, line := range strings.Split(string(data), "\n") {
			if strings.Contains(strings.ToLower(line), q) {
				hits = append(hits, SearchHit{Path: rel, Line: i + 1, Preview: truncateRunes(strings.TrimSpace(line), 160)})
				if len(hits) >= limit {
					break
				}
			}
		}
	}
	return hits, nil
}
