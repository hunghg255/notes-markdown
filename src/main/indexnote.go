package main

import (
	"net/url"
	"regexp"
	"strings"
)

// Go port of src/shared/indexNote.ts (the renderer keeps the TypeScript one for the outline panel).

var (
	tagRe          = regexp.MustCompile(`(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)`)
	wikiRe         = regexp.MustCompile(`\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]`)
	mdLinkRe       = regexp.MustCompile(`(?i)\[[^\]]*\]\(([^)\s]+\.md)\)`)
	taskRe         = regexp.MustCompile(`^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.*)$`)
	headingRe      = regexp.MustCompile(`^(#{1,6})\s+(.*)$`)
	fenceRe        = regexp.MustCompile("^\\s*(```|~~~)")
	listItemRe     = regexp.MustCompile(`^\s+-\s+`)
	frontTagsRe    = regexp.MustCompile(`^tags:\s*(.*)$`)
	notExcerptRe   = regexp.MustCompile(`^\s*[-*+>]|^\s*\d+[.)]`)
	digitsRe       = regexp.MustCompile(`^\d+$`)
	mdSuffixRe     = regexp.MustCompile(`(?i)\.md$`)
	quoteTrimRe    = regexp.MustCompile(`^['"]|['"]$`)
	bracketTrimRe  = regexp.MustCompile(`^\[|\]$`)
	hashPrefixTrim = regexp.MustCompile(`^#`)
)

// orderedSet keeps insertion order, like a JS Set.
type orderedSet struct {
	seen  map[string]bool
	items []string
}

func (s *orderedSet) add(v string) {
	if s.seen == nil {
		s.seen = map[string]bool{}
	}
	if !s.seen[v] {
		s.seen[v] = true
		s.items = append(s.items, v)
	}
}

func (s *orderedSet) list() []string {
	if s.items == nil {
		return []string{}
	}
	return s.items
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func cleanTag(t string) string {
	return hashPrefixTrim.ReplaceAllString(quoteTrimRe.ReplaceAllString(strings.TrimSpace(t), ""), "")
}

func indexNote(content string) NoteIndex {
	var tags, links orderedSet
	tasks := []NoteTask{}
	headings := []NoteHeading{}
	excerpt := ""
	inFence, inFrontmatter, inTagList := false, false, false
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		if i == 0 && line == "---" {
			inFrontmatter = true
			continue
		}
		if inFrontmatter {
			if line == "---" {
				inFrontmatter = false
			} else if inTagList && listItemRe.MatchString(line) {
				// block list continuation:  - tag
				if t := cleanTag(listItemRe.ReplaceAllString(line, "")); t != "" {
					tags.add(t)
				}
			} else {
				inTagList = false
				// frontmatter `tags: [a, b]` / `tags: a, b` / `tags:` followed by a block list
				if m := frontTagsRe.FindStringSubmatch(line); m != nil {
					inline := bracketTrimRe.ReplaceAllString(strings.TrimSpace(m[1]), "")
					if inline != "" {
						for _, t := range strings.Split(inline, ",") {
							if strings.TrimSpace(t) != "" {
								tags.add(cleanTag(t))
							}
						}
					} else {
						inTagList = true
					}
				}
			}
			continue
		}
		if fenceRe.MatchString(line) {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		if h := headingRe.FindStringSubmatch(line); h != nil {
			headings = append(headings, NoteHeading{Level: len(h[1]), Text: strings.TrimSpace(h[2]), Line: i + 1})
		} else if excerpt == "" && strings.TrimSpace(line) != "" && !notExcerptRe.MatchString(line) {
			excerpt = truncateRunes(strings.TrimSpace(line), 160)
		}
		if t := taskRe.FindStringSubmatch(line); t != nil {
			tasks = append(tasks, NoteTask{Line: i + 1, Text: strings.TrimSpace(t[2]), Done: t[1] != " "})
		}
		for _, m := range tagRe.FindAllStringSubmatch(line, -1) {
			if !digitsRe.MatchString(m[2]) {
				tags.add(m[2])
			}
		}
		for _, m := range wikiRe.FindAllStringSubmatch(line, -1) {
			links.add(strings.TrimSpace(m[1]))
		}
		for _, m := range mdLinkRe.FindAllStringSubmatch(line, -1) {
			target := m[1]
			if decoded, err := url.PathUnescape(target); err == nil {
				target = decoded
			}
			links.add(mdSuffixRe.ReplaceAllString(target, ""))
		}
	}
	return NoteIndex{Tags: tags.list(), Links: links.list(), Tasks: tasks, Headings: headings, Excerpt: excerpt}
}
