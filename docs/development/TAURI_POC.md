# Tauri PoC（历史归档说明）

这份文档原本用于记录从旧桌面壳迁移到 Tauri 的 PoC 过程。当前 Tauri 已经是主线实现，旧的 `tauri:poc:*` 命令、`tidydesk-tauri-poc.exe` 命名和 AppPicker PoC 语义都已过期。

## 当前状态

- 主线开发命令：`npm run tauri:dev`
- 主线打包命令：`npm run tauri:bundle` / `npm run tauri:build` / `npm run tauri:release`
- 当前 Tauri 配置：`src-tauri/tauri.conf.json`
- 当前 Rust 入口：`src-tauri/src/main.rs`
- 当前 IPC 分组：`src-tauri/src/commands/`
- 当前窗口分组：`src-tauri/src/tool_windows/`
- 当前文件规则分组：`src-tauri/src/files_rules/`

## 仍有参考价值的内容

这份历史 PoC 只用于了解迁移背景：哪些能力被迁移到 Tauri、哪些 IPC 能力最早被验证过。不要再按旧命令或旧文件列表执行。

当前开发、构建、测试和发布流程请以根目录 [README](../../README.md) 为准。
