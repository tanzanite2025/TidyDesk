# Tauri PoC

## 目标

当前 PoC 在 Tauri 最小壳基础上验证 AppPicker add-to-drawer 链路，不迁移完整 Electron IPC。

当前 PoC 覆盖：

- 复用现有 Vite/React 前端。
- 新增 `mode=tauri-poc` 页面。
- 新增 Tauri v2 `src-tauri/` 壳。
- 新增 Rust command：`probe_go_sidecar`。
- 新增 Rust command：`apps_scan_metadata`。
- 新增 Rust command：`apps_scan_installed`。
- 新增 Rust command：`apps_add_to_drawer`。
- 新增 Rust command：`open_app_picker_poc` / `close_app_picker_poc`。
- 新增 Tauri `NativeClient` adapter。
- 复用 `AppPickerApp` 展示 target-aware 应用列表并复制 `.lnk` 到抽屉。
- Rust 通过 stdio JSON-RPC 调用现有 Go sidecar：
  - `ping`
  - `sidecar.version`
  - `sidecar.health`
  - `apps.scanMetadata`
- 初始化基础托盘菜单。

## 新增文件

```text
src/TauriPocApp.tsx
src/native/tauri-adapter.ts
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

AppPicker PoC 窗口打开：

```text
index.html?mode=app-picker
```

AppPicker PoC 当前支持 add-to-drawer：

- 列表来自 Go sidecar `apps.scanMetadata`。
- Rust 侧使用 Windows COM `IShellLinkW` 解析 `.lnk` targetPath。
- 过滤无法解析 target、target 不存在、target 非 `.exe`、重复 target 的快捷方式。
- Tauri adapter 的 `scanInstalled`、`refresh`、`getCacheInfo` 走 `apps_scan_installed`。
- Tauri adapter 的 `addToDrawer` 走 `apps_add_to_drawer`。
- Rust 侧将 `.lnk` 复制到 `app_data_dir/drawers/<targetFolder>`。
- 默认目标抽屉为 `收纳抽屉`。
- 暂不提取应用图标。

## 当前边界

当前 PoC 不做：

- 不迁移抽屉文件系统 IPC。
- 不迁移 todo IPC。
- 不迁移截图/贴纸 IPC。
- 不迁移更新 IPC。
- 不替换 Electron 生产入口。
- 不实现 Tauri 版图标提取。

## 当前验证记录

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

add-to-drawer 阶段已验证：

```text
apps_scan_installed
apps_add_to_drawer
Rust IShellLinkW targetPath 解析
Tauri adapter scanInstalled/refresh/getCacheInfo/addToDrawer
AppPicker Tauri add-to-drawer 提示与点击路径
```

已执行：

```text
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
go -C sidecars/apps-cache test ./...
node --check scripts/prepare-tauri-sidecar.cjs
npm run tauri:poc:dev
```

## 下一步建议

下一步建议：

1. 设计 Tauri 版图标提取策略。
2. 将 Tauri add-to-drawer 结果接入主窗口抽屉列表刷新。
3. 迁移 Tauri drawers read/rename/delete/open 能力。
4. 再逐步迁移 drawers/todos/windows。
