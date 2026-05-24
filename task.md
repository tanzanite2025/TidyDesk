# TidyDesk 阶段十：Tauri 最小壳 PoC 任务清单

## 目标

在 Electron + Go sidecar 链路已稳定后，新增一个不影响现有 Electron 入口的 Tauri 最小壳 PoC，验证 Tauri 窗口、托盘和调用 Go sidecar 的基本模型。

## 阶段十任务清单

- [x] **任务 1：确认现有前端构建与 PoC 边界**
  - 复用 Vite/React `dist` 构建产物。
  - 不迁移现有 Electron IPC。
  - 不替换 Electron 生产入口。
  - 新增独立 `mode=tauri-poc` 页面。

- [x] **任务 2：新增 Tauri PoC 前端页面**
  - 新增 `src/TauriPocApp.tsx`。
  - `src/main.tsx` 新增 `mode=tauri-poc` 路由。
  - 页面调用 Tauri command：`probe_go_sidecar`。
  - 前端通过 `@tauri-apps/api/core` 动态加载 `invoke`。

- [x] **任务 3：新增最小 Tauri v2 壳**
  - 新增 `src-tauri/Cargo.toml`。
  - 新增 `src-tauri/build.rs`。
  - 新增 `src-tauri/tauri.conf.json`。
  - 新增 `src-tauri/src/main.rs`。
  - Rust 侧实现 `probe_go_sidecar`。
  - Rust 侧通过 stdio JSON-RPC 调用 Go sidecar：`ping`、`sidecar.version`、`sidecar.health`。
  - 初始化基础托盘菜单。

- [x] **任务 4：补充脚本与文档**
  - 新增 `npm run tauri:poc:dev`。
  - 新增 `npm run tauri:poc:build`。
  - 新增 `npm run prepare:tauri-sidecar`。
  - 新增 `docs/development/TAURI_POC.md`。

- [x] **任务 5：执行可行性验证**
  - `package.json` JSON 检查通过。
  - `src-tauri/tauri.conf.json` JSON 检查通过。
  - `npm run build` 通过。
  - `cargo fmt -- --check` 通过。
  - `go test ./...` 通过。
  - `npm run prepare:tauri-sidecar` 通过。
  - `cargo check` 通过。
  - `npm run tauri:poc:dev` 已成功编译并运行 `target\debug\tidydesk-tauri-poc.exe`。
  - 已修复 Tauri `externalBin` 需要 `-x86_64-pc-windows-msvc.exe` target-triple 文件名的问题。
  - 已验证 Tauri PoC 页面按钮可点击，`ping/version/health/methods` 均正常返回。
  - 已修复 `Sidecar path` 字段序列化命名问题。

## 当前边界

当前 Tauri PoC 不做：

- 不迁移 drawers 文件系统 IPC。
- 不迁移 todos IPC。
- 不迁移截图/贴纸 IPC。
- 不迁移更新 IPC。
- 不替换 Electron 常规启动脚本。

## 下一步

下一阶段建议：

- 新增 `src/native/tauri-adapter.ts`。
- 先迁移 apps sidecar 调用，再迁移 drawers/todos/windows。
