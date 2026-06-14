# Go Sidecar PoC（历史归档说明）

这份文档原本用于验证 Go sidecar 通过 stdio JSON-RPC 提供应用 cache / shortcut metadata 的可行性。当前 Go sidecar 已经进入主线实现，不再是 Electron 实验路径。

## 当前状态

当前 sidecar 位于 `sidecars/apps-cache/`，职责已拆分为：

```text
sidecars/apps-cache/
├── main.go       stdin/stdout 循环
├── types.go      request/response/result structs 与协议常量
├── rpc.go        JSON-RPC method routing
├── version.go    sidecar.version / sidecar.health
├── cache.go      cache path/load/info/read
├── scan.go       shortcut 扫描遍历
└── classify.go   shortcut skip/category heuristics
```

当前可用命令：

```bash
go -C sidecars/apps-cache test ./...
npm run build:sidecar
```

## 仍有参考价值的内容

这份历史 PoC 只用于理解 sidecar 为什么选择 stdio JSON-RPC、为什么先做 cache / shortcut metadata。不要再按旧 Electron client 或旧测试脚本执行。

当前架构和检查命令请以根目录 [README](../../README.md) 为准。
