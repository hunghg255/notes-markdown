package main

import (
	"regexp"
	"strings"
)

// VS Code `files.exclude`-style matching for vault entries.
//
//   - `*` / `?` never cross a `/`; `**` matches any depth; `{a,b}` is alternation.
//   - A pattern without `/` matches the entry name at any depth (`node_modules`, `*.draft.md`).
//   - A pattern with `/` matches the whole vault-relative path (`Archive/**`, `Projects/Old`).
//   - Matching is case-insensitive, like the `.md` extension check in the vault walker.

// ExcludeMatcher reports whether the entry at rel (named name) is hidden.
type ExcludeMatcher func(rel, name string) bool

var noteExt = regexp.MustCompile(`(?i)\.(md|markdown)$`)

var leadingSlashes = regexp.MustCompile(`^(\./|/)+`)

func normaliseGlob(pattern string) string {
	p := strings.ReplaceAll(strings.TrimSpace(pattern), `\`, "/")
	p = leadingSlashes.ReplaceAllString(p, "")
	return strings.TrimRight(p, "/")
}

func globToRegexp(glob string) (*regexp.Regexp, error) {
	var re strings.Builder
	for i := 0; i < len(glob); i++ {
		c := glob[i]
		switch c {
		case '*':
			if i+1 < len(glob) && glob[i+1] == '*' {
				i++
				if i+1 < len(glob) && glob[i+1] == '/' {
					i++
					re.WriteString("(?:.*/)?")
				} else if i == len(glob)-1 && i >= 2 && glob[i-2] == '/' {
					// trailing `/**` — already emitted the `/`, allow matching the dir itself
					s := re.String()
					re.Reset()
					re.WriteString(s[:len(s)-1] + "(?:/.*)?")
				} else {
					re.WriteString(".*")
				}
			} else {
				re.WriteString("[^/]*")
			}
		case '?':
			re.WriteString("[^/]")
		case '{':
			re.WriteString("(?:")
		case '}':
			re.WriteString(")")
		case ',':
			re.WriteString("|")
		case '/':
			re.WriteString("/")
		default:
			re.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	return regexp.Compile("(?i)^(?:" + re.String() + ")$")
}

func compileExcludes(patterns []string) ExcludeMatcher {
	var byName, byPath []*regexp.Regexp
	for _, raw := range patterns {
		p := normaliseGlob(raw)
		if p == "" {
			continue
		}
		re, err := globToRegexp(p)
		if err != nil {
			// malformed pattern: skip rather than break the whole tree
			continue
		}
		if strings.Contains(p, "/") {
			byPath = append(byPath, re)
		} else {
			byName = append(byName, re)
		}
	}
	if len(byName) == 0 && len(byPath) == 0 {
		return func(string, string) bool { return false }
	}

	return func(rel, name string) bool {
		if len(byName) > 0 {
			candidates := append(strings.Split(rel, "/"), name)
			if noteExt.MatchString(name) {
				candidates = append(candidates, noteExt.ReplaceAllString(name, ""))
			}
			for _, re := range byName {
				for _, s := range candidates {
					if re.MatchString(s) {
						return true
					}
				}
			}
		}
		for _, re := range byPath {
			if re.MatchString(rel) {
				return true
			}
			if noteExt.MatchString(rel) && re.MatchString(noteExt.ReplaceAllString(rel, "")) {
				return true
			}
		}
		return false
	}
}
