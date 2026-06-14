package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func parseScanMetadataParams(raw json.RawMessage) (scanMetadataParams, error) {
	var params scanMetadataParams
	if len(raw) == 0 {
		return params, errors.New("missing params")
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return params, err
	}
	if params.MaxDepth <= 0 {
		params.MaxDepth = 3
	}
	return params, nil
}

func scanMetadata(params scanMetadataParams) (scanMetadataResult, error) {
	start := time.Now()
	result := scanMetadataResult{
		Shortcuts:    []shortcutMetadata{},
		ScannedPaths: []string{},
	}
	seenShortcuts := map[string]bool{}
	skipDirectories := map[string]bool{}
	for _, dirName := range params.SkipDirectories {
		skipDirectories[strings.ToLower(dirName)] = true
	}

	for _, startMenuPath := range params.StartMenuPaths {
		if startMenuPath == "" {
			continue
		}
		if _, err := os.Stat(startMenuPath); err != nil {
			continue
		}
		result.ScannedPaths = append(result.ScannedPaths, startMenuPath)
		scanShortcutDirectory(
			startMenuPath,
			"startMenu",
			true,
			0,
			params.MaxDepth,
			skipDirectories,
			seenShortcuts,
			&result.Shortcuts,
		)
	}

	if params.DesktopPath != "" {
		if _, err := os.Stat(params.DesktopPath); err == nil {
			result.ScannedPaths = append(result.ScannedPaths, params.DesktopPath)
			scanShortcutDirectory(
				params.DesktopPath,
				"desktop",
				false,
				0,
				params.MaxDepth,
				skipDirectories,
				seenShortcuts,
				&result.Shortcuts,
			)
		}
	}

	sort.Slice(result.Shortcuts, func(i, j int) bool {
		return strings.ToLower(result.Shortcuts[i].Name) < strings.ToLower(result.Shortcuts[j].Name)
	})
	result.DurationMs = time.Since(start).Milliseconds()
	return result, nil
}

func scanShortcutDirectory(
	dirPath string,
	source string,
	recursive bool,
	depth int,
	maxDepth int,
	skipDirectories map[string]bool,
	seenShortcuts map[string]bool,
	shortcuts *[]shortcutMetadata,
) {
	if depth > maxDepth {
		return
	}

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return
	}

	for _, entry := range entries {
		fullPath := filepath.Join(dirPath, entry.Name())
		if entry.IsDir() {
			if recursive && !skipDirectories[strings.ToLower(entry.Name())] {
				scanShortcutDirectory(
					fullPath,
					source,
					recursive,
					depth+1,
					maxDepth,
					skipDirectories,
					seenShortcuts,
					shortcuts,
				)
			}
			continue
		}

		if strings.ToLower(filepath.Ext(entry.Name())) != ".lnk" {
			continue
		}

		name := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if shouldSkipShortcut(name) {
			continue
		}

		normalizedPath := strings.ToLower(fullPath)
		if seenShortcuts[normalizedPath] {
			continue
		}
		seenShortcuts[normalizedPath] = true

		info, err := entry.Info()
		if err != nil {
			continue
		}

		*shortcuts = append(*shortcuts, shortcutMetadata{
			Name:         name,
			ShortcutPath: fullPath,
			Source:       source,
			Category:     categorizeShortcut(name, fullPath),
			Size:         info.Size(),
			ModifiedAt:   info.ModTime().Format(time.RFC3339),
			Depth:        depth,
		})
	}
}
