package main

import "strings"

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
