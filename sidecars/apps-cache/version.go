package main

import (
	"runtime"
	"time"
)

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
