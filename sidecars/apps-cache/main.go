package main

import (
	"bufio"
	"encoding/json"
	"os"
)

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
