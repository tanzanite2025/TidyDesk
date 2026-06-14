# Tauri PoC

## 目标

当前 PoC 在 Tauri 壳基础上验证 AppPicker add-to-drawer、主窗口 drawer read、基础 drawer 操作、import/restore、基础 windows shell control、shell layout parity、todos IPC、快捷方式验证/修复/watcher、截图/贴纸、拖拽路径解析、原生图标提取与基础事件 send 通道，不迁移完整 Electron IPC。

当前 PoC 覆盖：

- 复用现有 Vite/React 前端。
- Tauri 默认窗口加载现有主界面 `mode=drawer`。
- 新增 Tauri v2 `src-tauri/` 壳。
- 新增 Rust command：`probe_go_sidecar`。
- 新增 Rust command：`apps_scan_metadata`。
- 新增 Rust command：`apps_scan_installed`。
- 新增 Rust command：`apps_add_to_drawer`。
- 新增 Rust command：`files_read_desktop_files`。
- 新增 Rust command：`files_open`。
- 新增 Rust command：`files_import_external_files`。
- 新增 Rust command：`files_restore_to_desktop`。
- 新增 Rust command：`shortcuts_validate_all` / `shortcuts_repair`。
- 新增 Rust command：`drawers_create`。
- 新增 Rust command：`drawers_rename_item`。
- 新增 Rust command：`drawers_delete_item`。
- 新增 Rust command：`apps_get_picker_target`。
- 新增 Rust command：`windows_control`。
- 新增 Rust command：`events_send`。
- 新增 Rust command：`todos_read_state` / `todos_get_counts`。
- 新增 Rust command：`todos_create_card` / `todos_update_card` / `todos_delete_card` / `todos_move_card`。
- 新增 Rust command：`snip_complete_selection` / `snip_cancel`。
- 新增 Rust command：`sticker_get` / `sticker_toggle_pin` / `sticker_copy` / `sticker_save_as` / `sticker_close`。
- 新增 Rust command：`open_app_picker` / `close_app_picker`。
- 新增 Tauri `NativeClient` adapter。
- 复用现有主界面读取 Tauri app data 下的抽屉目录。
- 复用 `AppPickerApp` 展示 target-aware 应用列表并复制 `.lnk` 到目标抽屉。
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
src-tauri/src/icons.rs
src-tauri/src/main.rs
src-tauri/src/stickers.rs
```

## 新增 npm scripts

```text
npm run tauri:poc:dev
npm run tauri:poc:build
```

## 运行前置条件

Tauri PoC 需要本机具备：

- Rust toolchain
- Tauri v2 CLI 使用根项目 `devDependencies` 中锁定的 `@tauri-apps/cli`
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
http://localhost:3000?mode=drawer
```

生产窗口打开：

```text
index.html?mode=drawer
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
- 主窗口通过 `openPicker({ targetFolder })` 将目标抽屉传给 Tauri，AppPicker 通过 `apps_get_picker_target` 读取目标抽屉。
- AppPicker 窗口已打开时，Tauri 通过 `set-target-folder` event 同步新的目标抽屉。
- 已通过 Windows Shell/GDI 提取应用图标并回传 `icon` data URL。

主窗口 drawer 当前支持：

- `files.readDesktopFiles` 走 Tauri command `files_read_desktop_files`。
- 读取桌面根目录文件，过滤 `desktop.ini`、TidyDesk、`node_modules`、`.git`、`.github`、旧版 `桌面收纳盒` 等受保护项。
- 读取 `app_data_dir/drawers` 下的抽屉目录和抽屉内文件。
- 对抽屉内 `.lnk` 使用 Windows COM 解析 `targetPath`，并根据目标是否存在标记 `isValid`。
- 返回结构与 Electron `readDesktopFiles` 对齐：`files`、`folders`、`desktopPath`、`tidyBoxPath`。
- `drawers.create` 走 Tauri command `drawers_create`，用于主界面默认抽屉创建和手动新建抽屉。
- `drawers.renameItem` 走 Tauri command `drawers_rename_item`，支持重命名抽屉与抽屉内入口。
- `drawers.deleteItem` 走 Tauri command `drawers_delete_item`，支持删除抽屉与抽屉内入口。
- `files.open` 走 Tauri command `files_open`，仅允许打开 Tauri drawer root 内的抽屉入口。
- `files.importExternalFiles` 走 Tauri command `files_import_external_files`。
- 导入普通文件时复制或移动到 `app_data_dir/storage/<id>`，再在目标抽屉创建 `.lnk`。
- 导入桌面来源的普通文件时使用移动语义，非桌面来源使用复制语义。
- 导入 `.lnk` / `.url` 时复制快捷方式到目标抽屉；如果来源在桌面，则删除原快捷方式。
- `files.restoreToDesktop` 走 Tauri command `files_restore_to_desktop`。
- 还原仅支持抽屉内 `.lnk`，且目标必须位于 `app_data_dir/storage`，与 Electron 的 managed file 语义对齐。
- `windows.control` 走 Tauri command `windows_control`，当前支持 `close`、`minimize`、`open-files`、`open-todos`、`open-capture`、`close-panel`、`expand-drawer`、`collapse-drawer`、`toggle-drawer`。
- `windows.onDrawerState` / `windows.onModuleState` 通过 Tauri event 监听 `drawer-state` / `module-state`。
- Tauri 可打开现有 React `mode=todos` 与 `mode=capture` 窗口，保持前端 UI 和样式不变。
- Tauri shell state 已对齐 Electron payload 语义：`expanded` 与 `activeModule`。
- Tauri 启动时会创建右侧贴边手柄窗口，窗口 label 为 `handle`，加载 `mode=handle` 的专用 UI。
- Tauri 主窗口会按 Electron drawer 语义定位到屏幕右侧，`open-files` 展开抽屉，`open-todos` / `open-capture` 会隐藏 drawer 并按模块面板位置显示。
- drawer 展开时 `handle` 移动到 drawer 左侧；drawer 收起或模块打开时 `handle` 贴回屏幕右边缘。
- `todos.readState` / `todos.getCounts` 走 Tauri command `todos_read_state` / `todos_get_counts`。
- `todos.createCard` / `todos.updateCard` / `todos.deleteCard` / `todos.moveCard` 走 Tauri command `todos_create_card` / `todos_update_card` / `todos_delete_card` / `todos_move_card`。
- Tauri todo 存储结构与 Electron 对齐：`app_data_dir/todos/boards.json` 与 `app_data_dir/todos/cards/<cardId>.md`。
- Todo 变更后通过 Tauri event `todo-counts-updated` 同步计数。

快捷方式链当前支持：

- `shortcuts.validateAll` 走 Tauri command `shortcuts_validate_all`。
- `shortcuts.repair` 走 Tauri command `shortcuts_repair`。
- Rust 侧会扫描 `app_data_dir/drawers` 下所有 `.lnk`，使用 Windows COM 解析 target，并尝试在常用用户目录中自动修复失效快捷方式。
- Tauri 后台轮询会发出 `target-file-deleted` / `target-file-restored` / `shortcuts-validated` event。
- Tauri adapter 的 `shortcuts.validateAll` / `repair` / `onTargetFileDeleted` / `onTargetFileRestored` / `onValidated` 已接通。

截图 / 贴纸当前支持：

- `windows.control('start-screenshot')` 会打开 `mode=snip` 的全屏透明截图窗口。
- `capture.completeSnipSelection` / `capture.cancelSnip` 走 Tauri command `snip_complete_selection` / `snip_cancel`。
- Rust 侧使用 Windows GDI 抓屏并裁剪 PNG，将贴纸保存到 `app_data_dir/stickers/images`。
- Sticker 状态保存到 `app_data_dir/stickers/stickers.json`，应用启动时会恢复已存在的贴纸窗口。
- `stickers.get` / `togglePin` / `copy` / `saveAs` / `close` 以及 `sticker-updated` event 已接通。

本轮次级补齐：

- Tauri 拖拽导入不再依赖浏览器 `File.path`，主界面通过 `@tauri-apps/api/window` 的 `onDragDropEvent` 直接读取原生 `paths`。
- `events.send(...)` 走 Tauri command `events_send`，当前支持 `user-first-interaction`、`drawer-opened`、`file-dropped` 并记录首次发生状态。
- 新增 `src-tauri/src/icons.rs`，通过 Windows Shell/GDI 提取应用、桌面文件和抽屉文件图标，填充 `InstalledApp.icon` 与 `DesktopFile.icon`。

## 当前边界

当前 PoC 暂不做：

- 不迁移完整 Electron 窗口动画与贴边 handle 行为。
- 不替换 Electron 生产入口。
- 不实现完整 resident / 开机自启询问策略；当前只补 `events_send` 最小 send 通道与交互状态记录。
- `capture.onOpened` 仍未迁移。
- 不在本文展开 updater 发布、签名和 release 配置细节。

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
apps_get_picker_target
Rust IShellLinkW targetPath 解析
Tauri adapter scanInstalled/refresh/getCacheInfo/addToDrawer
Tauri adapter onSetTargetFolder
AppPicker Tauri add-to-drawer 提示与点击路径
```

drawer read/main window 阶段已验证：

```text
files_read_desktop_files
files_open
drawers_create
drawers_rename_item
drawers_delete_item
Tauri adapter files.readDesktopFiles
Tauri adapter files.open
Tauri adapter files.importExternalFiles
Tauri adapter files.restoreToDesktop
Tauri adapter drawers.create
Tauri adapter drawers.renameItem/deleteItem
Tauri adapter windows.control
Tauri adapter windows.onDrawerState/onModuleState
Tauri adapter todos.readState/getCounts
Tauri adapter todos.createCard/updateCard/deleteCard/moveCard
Tauri adapter todos.onCountsUpdated
Tauri 默认窗口 mode=drawer
```

drawer import/restore 阶段已验证：

```text
files_import_external_files
files_restore_to_desktop
Windows COM IShellLinkW/IPersistFile 创建 .lnk
Tauri adapter files.importExternalFiles/restoreToDesktop
```

windows shell control 阶段已验证：

```text
windows_control
open-todos / open-capture / close-panel / open-files
expand-drawer / collapse-drawer / toggle-drawer
drawer-state / module-state Tauri event
expanded / activeModule shell state
handle/drawer/todos/capture bounds calculation
right-edge handle window loading mode=rail
Tauri adapter windows.control/onDrawerState/onModuleState
```

todos IPC 阶段已验证：

```text
todos_read_state
todos_get_counts
todos_create_card
todos_update_card
todos_delete_card
todos_move_card
todo-counts-updated Tauri event
Tauri adapter todos.*
```

快捷方式 / 截图贴纸 / 次级缺口阶段已验证：

```text
shortcuts_validate_all
shortcuts_repair
target-file-deleted / target-file-restored / shortcuts-validated
Tauri adapter shortcuts.*
windows_control start-screenshot
snip_complete_selection
snip_cancel
sticker_get
sticker_toggle_pin
sticker_copy
sticker_save_as
sticker_close
sticker-updated Tauri event
Tauri adapter capture.* / stickers.*
Tauri drag-drop onDragDropEvent path handoff
events_send
native Windows icon extraction for apps/files
```

已执行：

```text
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
npm run prepare:tauri-sidecar
go -C sidecars/apps-cache test ./...
node --check scripts/prepare-tauri-sidecar.cjs
npm run tauri:poc:dev
```

## 下一步建议

下一步建议：

1. 运行 `npm run tauri:poc:dev` 做手动闭环验证：快捷方式自动修复与 watcher 事件、截图贴纸、拖拽导入、AppPicker 图标、桌面/抽屉文件图标。
2. 迁移 `capture.onOpened`，让 `mode=capture` 工具窗口能接收打开事件并与当前剪贴板流程更自然衔接。
3. 决定是否继续补 resident / 开机自启提示策略，把 `events_send` 采集到的首次交互信号接到真实业务。
4. 如有需要，再针对多显示器截图、图标缓存和后台轮询策略做性能优化。
