package main

import "fmt"

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
