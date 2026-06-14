# Go Sidecar PoC（历史归档说明）

这份文档原本用于验证 Go sidecar 通过 stdio JSON-RPC 提供应用 cache / shortcut metadata 的可行性。当前主线已迁移为 Rust 后端直接扫描/cache，不再保留 Go sidecar 运行链路。

## 当前状态

历史 sidecar 曾位于 `sidecars/apps-cache/`，职责曾拆分为：

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

当前主线不再提供旧的 Go sidecar 测试/构建命令。

## 仍有参考价值的内容

这份历史 PoC 只用于理解 sidecar 为什么选择 stdio JSON-RPC、为什么先做 cache / shortcut metadata。不要再按旧 Electron client 或旧测试脚本执行。

当前架构和检查命令请以根目录 [README](../../README.md) 为准。
