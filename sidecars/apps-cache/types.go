package main

import (
	"encoding/json"
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
	UserDataPath    string   `json:"userDataPath,omitempty"`
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
