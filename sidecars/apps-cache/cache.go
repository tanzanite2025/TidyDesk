package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

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
