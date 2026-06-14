# 手柄窗口不可见问题（历史归档说明）

这份文档原本记录旧 Electron 阶段的手柄窗口不可见排障过程。当前 TidyDesk 已迁移到 Tauri，旧的 `electron/main.cjs`、`npx electron .`、`npm run desktop` 和 `build:electron` 说明不再适用。

## 当前状态

- 当前手柄窗口由 Tauri/Rust 窗口逻辑管理。
- 窗口职责位于 `src-tauri/src/tool_windows/`。
- IPC 窗口命令位于 `src-tauri/src/commands/windows.rs`。
- 前端手柄 UI 位于 `src/modules/handle/HandleApp.tsx`。

## 当前验证方式

开发态：

```bash
npm run tauri:dev
```

构建检查：

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

窗口 smoke 测试：

```bash
npm run test:e2e:tauri
```

## 仍有参考价值的内容

旧文档的根因分析只保留历史上下文：如果开发服务器未启动、窗口加载 URL 错误或窗口尺寸/位置异常，用户会看到类似“应用启动但入口不可见”的现象。当前排障应从 Tauri 窗口创建、窗口 label、monitor bounds 和前端路由模式检查开始。

当前命令和目录职责请以根目录 [README](../../README.md) 为准。
