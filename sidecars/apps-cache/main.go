package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

type rpcRequest struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	ID    string      `json:"id"`
	OK    bool        `json:"ok"`
	Data  interface{} `json:"data,omitempty"`
	Error string      `json:"error,omitempty"`
}

type cacheParams struct {
	UserDataPath string `json:"userDataPath"`
}

type sidecarVersionInfo struct {
	Name            string   `json:"name"`
	Version         string   `json:"version"`
	ProtocolVersion string   `json:"protocolVersion"`
	Runtime         string   `json:"runtime"`
	OS              string   `json:"os"`
	Arch            string   `json:"arch"`
	Methods         []string `json:"methods"`
}

type sidecarHealthInfo struct {
	Status          string   `json:"status"`
	Name            string   `json:"name"`
	Version         string   `json:"version"`
	ProtocolVersion string   `json:"protocolVersion"`
	UptimeMs        int64    `json:"uptimeMs"`
	Methods         []string `json:"methods"`
}

type cacheFile struct {
	Version   string          `json:"version"`
	Timestamp int64           `json:"timestamp"`
	Apps      json.RawMessage `json:"apps"`
}

type cacheInfo struct {
	Exists     bool   `json:"exists"`
	Valid      bool   `json:"valid"`
	AppCount   int    `json:"appCount"`
	AgeMinutes int64  `json:"ageMinutes"`
	Timestamp  int64  `json:"timestamp,omitempty"`
	Version    string `json:"version,omitempty"`
}

type scanMetadataParams struct {
	StartMenuPaths  []string `json:"startMenuPaths"`
	DesktopPath     string   `json:"desktopPath"`
	MaxDepth        int      `json:"maxDepth"`
	SkipDirectories []string `json:"skipDirectories"`
}

type shortcutMetadata struct {
	Name         string `json:"name"`
	ShortcutPath string `json:"shortcutPath"`
	Source       string `json:"source"`
	Category     string `json:"category"`
	Size         int64  `json:"size"`
	ModifiedAt   string `json:"modifiedAt"`
	Depth        int    `json:"depth"`
}

type scanMetadataResult struct {
	Shortcuts    []shortcutMetadata `json:"shortcuts"`
	ScannedPaths []string           `json:"scannedPaths"`
	DurationMs   int64              `json:"durationMs"`
}

const cacheTTL = 24 * time.Hour
const sidecarName = "tidydesk-apps-cache-sidecar"
const sidecarVersion = "0.1.0"
const protocolVersion = "1"

var sidecarStartedAt = time.Now()

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var request rpcRequest
		if err := json.Unmarshal(line, &request); err != nil {
			_ = encoder.Encode(rpcResponse{OK: false, Error: err.Error()})
			continue
		}

		response := handleRequest(request)
		_ = encoder.Encode(response)
	}
}

func handleRequest(request rpcRequest) rpcResponse {
	data, err := routeRequest(request)
	if err != nil {
		return rpcResponse{ID: request.ID, OK: false, Error: err.Error()}
	}
	return rpcResponse{ID: request.ID, OK: true, Data: data}
}

func routeRequest(request rpcRequest) (interface{}, error) {
	switch request.Method {
	case "ping":
		return map[string]string{"pong": sidecarName}, nil
	case "sidecar.version":
		return getSidecarVersion(), nil
	case "sidecar.health":
		return getSidecarHealth(), nil
	case "apps.cacheInfo":
		params, err := parseCacheParams(request.Params)
		if err != nil {
			return nil, err
		}
		return getCacheInfo(params.UserDataPath)
	case "apps.readCache":
		params, err := parseCacheParams(request.Params)
		if err != nil {
			return nil, err
		}
		return readCache(params.UserDataPath)
	case "apps.scanMetadata":
		params, err := parseScanMetadataParams(request.Params)
		if err != nil {
			return nil, err
		}
		return scanMetadata(params)
	default:
		return nil, fmt.Errorf("unknown method: %s", request.Method)
	}
}

func sidecarMethods() []string {
	return []string{
		"ping",
		"sidecar.version",
		"sidecar.health",
		"apps.cacheInfo",
		"apps.readCache",
		"apps.scanMetadata",
	}
}

func getSidecarVersion() sidecarVersionInfo {
	return sidecarVersionInfo{
		Name:            sidecarName,
		Version:         sidecarVersion,
		ProtocolVersion: protocolVersion,
		Runtime:         runtime.Version(),
		OS:              runtime.GOOS,
		Arch:            runtime.GOARCH,
		Methods:         sidecarMethods(),
	}
}

func getSidecarHealth() sidecarHealthInfo {
	return sidecarHealthInfo{
		Status:          "ok",
		Name:            sidecarName,
		Version:         sidecarVersion,
		ProtocolVersion: protocolVersion,
		UptimeMs:        time.Since(sidecarStartedAt).Milliseconds(),
		Methods:         sidecarMethods(),
	}
}

func parseCacheParams(raw json.RawMessage) (cacheParams, error) {
	var params cacheParams
	if len(raw) == 0 {
		return params, errors.New("missing params")
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return params, err
	}
	if params.UserDataPath == "" {
		return params, errors.New("missing userDataPath")
	}
	return params, nil
}

func cachePath(userDataPath string) string {
	return filepath.Join(userDataPath, "cache", "apps.json")
}

func loadCache(userDataPath string) (cacheFile, error) {
	var cache cacheFile
	content, err := os.ReadFile(cachePath(userDataPath))
	if err != nil {
		return cache, err
	}
	if err := json.Unmarshal(content, &cache); err != nil {
		return cache, err
	}
	return cache, nil
}

func getCacheInfo(userDataPath string) (cacheInfo, error) {
	cache, err := loadCache(userDataPath)
	if err != nil {
		if os.IsNotExist(err) {
			return cacheInfo{Exists: false}, nil
		}
		return cacheInfo{Exists: false}, err
	}

	var apps []json.RawMessage
	if len(cache.Apps) > 0 {
		if err := json.Unmarshal(cache.Apps, &apps); err != nil {
			return cacheInfo{Exists: true}, err
		}
	}

	age := time.Since(time.UnixMilli(cache.Timestamp))
	return cacheInfo{
		Exists:     true,
		Valid:      age < cacheTTL,
		AppCount:   len(apps),
		AgeMinutes: int64(age.Minutes()),
		Timestamp:  cache.Timestamp,
		Version:    cache.Version,
	}, nil
}

func readCache(userDataPath string) (cacheFile, error) {
	cache, err := loadCache(userDataPath)
	if err != nil {
		if os.IsNotExist(err) {
			return cacheFile{Version: "", Timestamp: 0, Apps: json.RawMessage("[]")}, nil
		}
		return cacheFile{}, err
	}
	if len(cache.Apps) == 0 {
		cache.Apps = json.RawMessage("[]")
	}
	return cache, nil
}
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
		scanShortcutDirectory(startMenuPath, "startMenu", true, 0, params.MaxDepth, skipDirectories, seenShortcuts, &result.Shortcuts)
	}

	if params.DesktopPath != "" {
		if _, err := os.Stat(params.DesktopPath); err == nil {
			result.ScannedPaths = append(result.ScannedPaths, params.DesktopPath)
			scanShortcutDirectory(params.DesktopPath, "desktop", false, 0, params.MaxDepth, skipDirectories, seenShortcuts, &result.Shortcuts)
		}
	}

	sort.Slice(result.Shortcuts, func(i, j int) bool {
		return strings.ToLower(result.Shortcuts[i].Name) < strings.ToLower(result.Shortcuts[j].Name)
	})
	result.DurationMs = time.Since(start).Milliseconds()
	return result, nil
}

func scanShortcutDirectory(dirPath string, source string, recursive bool, depth int, maxDepth int, skipDirectories map[string]bool, seenShortcuts map[string]bool, shortcuts *[]shortcutMetadata) {
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
				scanShortcutDirectory(fullPath, source, recursive, depth+1, maxDepth, skipDirectories, seenShortcuts, shortcuts)
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

func shouldSkipShortcut(name string) bool {
	nameLower := strings.ToLower(name)
	return strings.Contains(nameLower, "uninstall") ||
		strings.Contains(nameLower, "unins") ||
		strings.Contains(nameLower, "setup") ||
		strings.Contains(nameLower, "installer")
}

func categorizeShortcut(name string, shortcutPath string) string {
	nameLower := strings.ToLower(name)
	pathLower := strings.ToLower(shortcutPath)

	if strings.Contains(nameLower, "chrome") ||
		strings.Contains(nameLower, "firefox") ||
		strings.Contains(nameLower, "edge") ||
		strings.Contains(nameLower, "browser") {
		return "browser"
	}

	if strings.Contains(nameLower, "visual studio") ||
		strings.Contains(nameLower, "vscode") ||
		strings.Contains(nameLower, "code") ||
		strings.Contains(nameLower, "git") ||
		strings.Contains(pathLower, "\\microsoft vs code\\") {
		return "development"
	}

	if strings.Contains(nameLower, "word") ||
		strings.Contains(nameLower, "excel") ||
		strings.Contains(nameLower, "powerpoint") ||
		strings.Contains(nameLower, "office") ||
		strings.Contains(nameLower, "wps") {
		return "office"
	}

	if strings.Contains(nameLower, "wechat") ||
		strings.Contains(nameLower, "qq") ||
		strings.Contains(nameLower, "dingtalk") ||
		strings.Contains(nameLower, "teams") ||
		strings.Contains(nameLower, "微信") ||
		strings.Contains(nameLower, "钉钉") {
		return "communication"
	}

	if strings.Contains(nameLower, "player") ||
		strings.Contains(nameLower, "music") ||
		strings.Contains(nameLower, "video") ||
		strings.Contains(nameLower, "photoshop") {
		return "media"
	}

	return "other"
}
