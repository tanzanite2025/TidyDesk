# Tauri 最小壳 PoC

## 目标

阶段十只验证 Tauri 最小壳可行性，不迁移完整 Electron IPC。

当前 PoC 覆盖：

- 复用现有 Vite/React 前端。
- 新增 `mode=tauri-poc` 页面。
- 新增 Tauri v2 `src-tauri/` 壳。
- 新增 Rust command：`probe_go_sidecar`。
- Rust 通过 stdio JSON-RPC 调用现有 Go sidecar：
  - `ping`
  - `sidecar.version`
  - `sidecar.health`
- 初始化基础托盘菜单。

## 新增文件

```text
src/TauriPocApp.tsx
src-tauri/Cargo.toml
src-tauri/build.rs
src-tauri/tauri.conf.json
src-tauri/src/main.rs
```

## 新增 npm scripts

```text
npm run tauri:poc:dev
npm run tauri:poc:build
```

## 运行前置条件

Tauri PoC 需要本机具备：

- Rust toolchain
- Tauri v2 CLI 可通过 `npx @tauri-apps/cli@2` 获取
- Windows WebView2 runtime
- Go sidecar 可构建

## 运行方式

开发模式：

```text
npm run tauri:poc:dev
```

构建模式：

```text
npm run tauri:poc:build
```

Tauri 配置会先执行：

```text
npm run prepare:tauri-sidecar
```

Tauri v2 `externalBin` 要求 sidecar 文件名带 target triple。Windows x64 下准备脚本会生成：

```text
src-tauri/sidecars/apps-cache/tidydesk-apps-cache-x86_64-pc-windows-msvc.exe
```

开发窗口打开：

```text
http://localhost:3000?mode=tauri-poc
```

生产窗口打开：

```text
index.html?mode=tauri-poc
```

## 当前边界

当前 PoC 不做：

- 不迁移抽屉文件系统 IPC。
- 不迁移 todo IPC。
- 不迁移截图/贴纸 IPC。
- 不迁移更新 IPC。
- 不替换 Electron 生产入口。

## 下一步建议

当前已验证 `npm run tauri:poc:dev` 可以编译并运行 `target\debug\tidydesk-tauri-poc.exe`。

Tauri PoC 页面已验证：

```text
Tauri invoke: available
ping: tidydesk-apps-cache-sidecar
version: 0.1.0 / protocol 1
runtime: go1.26.1 (windows/amd64)
health: ok
methods: 6
```

下一步建议：

1. 新增 `src/native/tauri-adapter.ts`。
2. 让 `native-client.ts` 根据运行时选择 Electron/Tauri adapter。
3. 优先迁移 apps sidecar scan 到 Tauri command。
4. 再逐步迁移 drawers/todos/windows。
