# TidyDesk 前端 TypeScript 强化与 Native API 契约收敛交付记录

## 完成概览

本次实施完成第一阶段改造：在不改变 Electron 主进程能力与用户交互行为的前提下，收敛渲染进程对 `window.tidyDesk` 的访问方式，建立统一类型契约，并完成一个低风险抽屉组件拆分。

## 已完成变更

- **建立统一 Native API 类型契约**
  - 新增 `src/types/tidydesk-api.ts`。
  - 覆盖窗口控制、抽屉、快捷方式、应用选择器、待办、截图贴纸、自动更新等接口。
  - 将 `src/types/window.d.ts` 改为引用统一 `TidyDeskAPI`，并将 `window.tidyDesk` 定义为可选字段以兼容浏览器模拟模式。

- **建立统一 Native API 客户端入口**
  - 新增 `src/native/tidydesk-client.ts`。
  - 提供 `getTidyDeskApi()` 与 `hasTidyDeskApi()`。
  - 前端模块通过统一入口访问 Electron preload 暴露能力。

- **替换重复 API 声明与 `any` 调用点**
  - 替换 `App.tsx`、`AppPickerApp.tsx`、`SettingsPanel.tsx`、`WorkspaceContext.tsx`、`TodoContext.tsx`、`RailApp.tsx`、`TodoPanel.tsx`、`QuickCaptureApp.tsx`、`SnipOverlayApp.tsx`、`StickerApp.tsx` 中的局部 API 类型与 `(window as any).tidyDesk`。
  - 清理主要前端模块中的 `Promise<any>`、`: any`、重复 `TidyDesk*Api` 类型定义。

- **拆分抽屉文件卡片组件**
  - 新增 `src/modules/drawer/FileTile.tsx`。
  - 从 `App.tsx` 中移出文件卡片、文件大小格式化、分类图标与分类配色逻辑。
  - 保持原有样式、交互、按钮行为不变。

- **修复构建暴露的类型问题**
  - 为 `useEffect` 补充显式 `return undefined`。
  - 为 `RailApp` 模块入口数组补充 `WindowAction` 类型约束。
  - 补充 `AppCacheInfo` 的缓存状态字段类型。

## 验证结果

- **构建验证**
  - 命令：`npm run build`
  - 结果：通过。

- **静态扫描**
  - 已扫描 `src` 下主要 TypeScript/TSX 文件。
  - 未发现剩余 `(window as any).tidyDesk`。
  - 未发现剩余局部 `TidyDesk*Api`、`SnipApi`、`StickerApi` 类型定义。

## 构建输出提示

构建过程中出现非阻塞提示：

- Vite CJS Node API deprecated warning。
- `postcss.config.js` 未声明模块类型导致 Node 重新按 ES module 解析的性能提示。

以上提示不影响本次构建成功，且不属于本阶段改造范围。

## 未执行事项

- **未执行 Electron 手工验证**
  - 本次只完成 `npm run build` 静态构建验证。
  - 未启动 Electron 桌面模式进行窗口、拖拽、截图贴纸等手工验证。

- **未进行 Go 化或 Tauri 换壳**
  - 本阶段仅完成前端类型契约与调用边界收敛。
  - 未引入 Go、Rust、Tauri 或修改 Electron 主进程服务。

## 后续建议

- **继续拆分抽屉界面**
  - 可继续拆出 `DrawerCard`、`DrawerHeader`、`DrawerNotice` 等组件，进一步降低 `App.tsx` 复杂度。

- **建立 IPC 契约测试**
  - 建议后续为 `tidydesk-api.ts` 与 `electron/preload.cjs` 暴露接口建立契约检查，防止类型和实际 preload API 漂移。

- **Tauri PoC 前置条件**
  - 当前统一客户端入口已经为 Tauri adapter 做了第一步准备。
  - 后续可新增 `tauri-adapter`，但不建议在完成更多抽屉组件拆分前直接换壳。

---

# 阶段二：NativeClient 业务化封装交付记录

## 完成概览

本阶段在已完成的 `window.tidyDesk` 类型契约基础上，新增了业务化 `NativeClient` 分层，让前端模块通过业务域访问本机能力，而不是直接感知 Electron preload API。

## 已完成变更

- **新增 NativeClient 类型分层**
  - 新增 `src/native/types.ts`。
  - 定义 `files`、`drawers`、`shortcuts`、`todos`、`apps`、`windows`、`clipboard`、`capture`、`stickers`、`updates`、`events` 等业务域接口。

- **新增 Electron Adapter**
  - 新增 `src/native/electron-adapter.ts`。
  - 将业务化方法映射到当前 `window.tidyDesk` preload API。
  - Electron 细节被限制在 adapter 内部。

- **新增 NativeClient 入口**
  - 新增 `src/native/native-client.ts`。
  - 当前默认导出 Electron adapter 实例。
  - 后续可替换或新增 Go sidecar adapter、Tauri adapter。

- **替换前端直接 Native API 调用**
  - 核心数据流：`WorkspaceContext.tsx`、`TodoContext.tsx`。
  - 窗口入口：`RailApp.tsx`、`QuickCaptureApp.tsx`。
  - 应用选择器：`AppPickerApp.tsx`、`components/AppPicker.tsx`。
  - 辅助模块：`SettingsPanel.tsx`、`SnipOverlayApp.tsx`、`StickerApp.tsx`、`TodoPanel.tsx`、`App.tsx`。

- **保留浏览器模拟模式**
  - `nativeClient.isAvailable()` 用于判断 Electron API 是否存在。
  - `WorkspaceContext` 和 `TodoContext` 的模拟数据 fallback 仍保留。

## 验证结果

- **构建验证**
  - 命令：`npm run build`
  - 结果：通过。

- **静态扫描结果**
  - 前端业务模块不再直接导入 `getTidyDeskApi()`。
  - `getTidyDeskApi()` 只保留在基础 `tidydesk-client.ts` 和 `electron-adapter.ts` 内部。
  - `window.tidyDesk` 只保留在全局类型声明和底层访问入口中。

## 非阻塞提示

构建仍有既有警告：

- Vite CJS Node API deprecated。
- `postcss.config.js` 模块类型提示。

这些不影响本阶段构建通过，且未在本阶段处理。

## 下一步建议

下一阶段建议进入 **Go sidecar 协议设计与最小 PoC**：

- 先定义 JSON-RPC/stdio 协议。
- 先选择一个低耦合模块做 PoC，推荐 `apps.scan` 或缓存读取。
- 暂不迁移窗口、托盘、截图和自动更新。
- Tauri PoC 应在 Go sidecar 一个模块跑通后再开始。

---

# 阶段三：Go Sidecar apps/cache PoC 交付记录

## 完成概览

本阶段完成 Go sidecar 最小协议验证。PoC 使用 stdio JSON-RPC，让 Electron 侧客户端可以启动 Go 进程并调用 `ping`、`apps.cacheInfo`、`apps.readCache`。

本阶段没有替换现有 Electron 应用扫描生产逻辑，只验证未来 Go 化服务边界。

## 已完成变更

- **新增 Go sidecar**
  - `sidecars/apps-cache/go.mod`
  - `sidecars/apps-cache/main.go`

- **新增 Electron sidecar 客户端**
  - `electron/services/go-sidecar-client.cjs`
  - 支持 stdio JSON-RPC、请求超时、进程退出清理。

- **新增测试脚本**
  - `scripts/test-go-sidecar.cjs`
  - 通过 Electron 环境获取 `app.getPath('userData')` 后调用 Go sidecar。

- **新增文档**
  - `docs/development/GO_SIDECAR_POC.md`

## 验证结果

- **协议测试**
  - 命令：`npx electron scripts/test-go-sidecar.cjs`
  - 结果：通过。
  - 返回：`ping` 成功，`cacheInfo/readCache` 可正常响应。

- **Go 测试**
  - 命令：`go test ./...`
  - 结果：通过。

- **Go 编译检查**
  - 命令：`go -C sidecars/apps-cache build -o "%TEMP%/tidydesk-apps-cache-test.exe" .`
  - 结果：通过。
  - 临时构建产物已清理。

- **前端构建**
  - 命令：`npm run build`
  - 结果：通过。

## 当前边界

当前 Go sidecar 只作为 PoC 存在，不影响生产功能。现有应用扫描仍走 Electron `appService/appCache`。

## 下一步建议

下一阶段建议做 **Go apps.scanMetadata PoC**：

- Go 负责扫描开始菜单和桌面快捷方式元数据。
- Electron 继续负责图标补全。
- 增加实验开关控制是否启用 Go metadata 扫描。
- 验证性能收益与稳定性。

Tauri PoC 建议在 Go metadata 扫描稳定后启动。

---

# 阶段四：Go apps.scanMetadata PoC 交付记录

## 完成概览

本阶段完成 Go sidecar 的 `apps.scanMetadata` PoC。Go 现在可以扫描开始菜单和桌面中的 `.lnk` 快捷方式元数据，并通过 stdio JSON-RPC 返回给 Electron 侧客户端。

本阶段仍未替换现有 Electron 生产应用扫描逻辑。

## 已完成变更

- **Go sidecar 新增方法**
  - `apps.scanMetadata`
  - 返回快捷方式名称、路径、来源、分类建议、文件大小、修改时间、递归深度。

- **Electron sidecar client 扩展**
  - `electron/services/go-sidecar-client.cjs` 新增 `scanMetadata()`。
  - 默认使用全局开始菜单、用户开始菜单和桌面路径。

- **测试脚本扩展**
  - `scripts/test-go-sidecar.cjs` 输出 `scanMetadata` 结果摘要和样例。

## 验证结果

- **Go 测试**：通过。
- **Go 编译检查**：通过。
- **Electron 协议测试**：通过。
- **前端构建**：通过。

`npx electron scripts/test-go-sidecar.cjs` 输出摘要：

```text
scanMetadata:
  scannedPaths: 3
  shortcutCount: 141
  durationMs: 35
```

## 重要说明

`apps.scanMetadata` 当前只枚举 `.lnk` 文件元数据，不解析 target，也不获取图标。这样做是为了将 Go 的职责限制在文件系统扫描层，避免一次性迁移 Electron 专属能力。

## 下一步建议

下一阶段建议实现 **Go metadata + Electron icon 补全实验路径**：

- 增加 `TIDYDESK_GO_APPS=1` 实验开关。
- Electron 调用 Go `apps.scanMetadata`。
- Electron 对返回的 shortcut 调用 `shell.readShortcutLink()`。
- Electron 继续使用 `app.getFileIcon()` 获取图标。
- 和现有 JS 扫描结果做数量、耗时、一致性对比。

如果该实验稳定，再启动最小 Tauri shell PoC。

---

# 阶段五：TIDYDESK_GO_APPS 实验路径交付记录

## 完成概览

本阶段将 Go `apps.scanMetadata` 接入 Electron 应用扫描服务的可选实验路径。默认生产路径不变，只有设置 `TIDYDESK_GO_APPS=1` 且 sidecar exe 存在时才启用。

## 已完成变更

- **Electron appService 接入 Go metadata**
  - `electron/services/apps.cjs` 新增 `goAppsClient` 可选参数。
  - 新增 `scanInstalledAppsWithGoMetadata()`。
  - 新增 `addShortcutApp()`，复用 Electron `shell.readShortcutLink()` 和 `app.getFileIcon()`。
  - Go 路径失败时自动回退原 JS 扫描。

- **Electron main 接入实验开关**
  - `electron/main.cjs` 新增 `TIDYDESK_GO_APPS=1` 检查。
  - sidecar exe 存在时创建 `goAppsClient`。
  - 退出时清理 `goAppsClient`。

- **新增完整扫描测试脚本**
  - `scripts/test-go-app-scan.cjs`

## 验证结果

已通过：

```text
node --check electron/main.cjs
node --check electron/services/apps.cjs
node --check electron/services/go-sidecar-client.cjs
node --check scripts/test-go-app-scan.cjs
go test ./...
go -C sidecars/apps-cache build -o "%TEMP%/tidydesk-apps-cache-test.exe" .
npm run build
```

完整实验链路也已通过：

```text
TIDYDESK_GO_APPS=1 npx electron scripts/test-go-app-scan.cjs
```

结果摘要：

```text
Go metadata: 41ms / 141 shortcuts
Electron completion: 77 apps
Full scan script duration: 6539ms
```

## 观察结论

- Go 负责文件系统 metadata 枚举非常快。
- 总耗时仍主要由 Electron `shell.readShortcutLink()` 和 `app.getFileIcon()` 决定。
- 少量快捷方式解析失败属于现有 Electron 补全阶段问题，当前已捕获并跳过。

## 下一步建议

下一阶段建议做 **扫描结果一致性对比与诊断**：

- 同时跑原 JS 扫描和 Go 实验扫描。
- 对比 app 数量、`targetPath`、`shortcutPath`。
- 输出差异报告。
- 记录 `readShortcutLink` 失败项。
- 决定是否把 Go metadata 路径作为后台扫描默认路径。

Tauri PoC 建议在该对比稳定后开始。

---

# 阶段六：扫描结果一致性对比与诊断交付记录

## 完成概览

本阶段新增 JS vs Go 扫描对比脚本，用于验证原 Electron JS 扫描与 Go metadata + Electron 补全路径的一致性。

## 已完成变更

- **新增对比脚本**
  - `scripts/compare-app-scans.cjs`

脚本能力：

- 不写真实 app cache。
- 分别运行原 JS 扫描与 Go 实验扫描。
- 对比数量、耗时、target 差异、重复项、分类差异、icon 缺失和失败警告。

## 验证结果

已通过：

```text
node --check scripts/compare-app-scans.cjs
node --check scripts/test-go-app-scan.cjs
node --check electron/services/apps.cjs
node --check electron/main.cjs
go test ./...
npm run build
npx electron scripts/compare-app-scans.cjs
```

对比摘要：

```text
JS scan: 77 apps / 4279ms
Go scan: 77 apps / 520ms
sharedTargetCount: 76
onlyInJs: 0
onlyInGo: 0
categoryMismatches: 0
iconless: 0
```

共同问题：

```text
duplicate target: c:\windows\system32\cmd.exe, count 2
readShortcutLink failures: 5 shortcuts
```

## 结论

Go metadata + Electron 补全路径在当前机器上与原 JS 扫描结果一致，且耗时明显更低。剩余失败项来自 Electron `shell.readShortcutLink()`，不是 Go metadata 枚举阶段。

## 下一步建议

下一阶段建议做 **失败快捷方式诊断与默认后台扫描策略**：

- 结构化记录 `readShortcutLink` 失败项。
- 给扫描结果增加诊断报告。
- 将 Go metadata 路径作为后台扫描候选。
- 保留原 JS 路径用于手动刷新或失败回退。

完成后再进入 Tauri 最小壳 PoC。

---

# 阶段七：Go Sidecar 成为唯一应用扫描入口交付记录

## 完成概览

本阶段根据决策移除了 JS 应用扫描作为手动路径或回退路径的角色。应用扫描现在统一依赖 Go `apps.scanMetadata`，再由 Electron 完成 target 解析和图标补全。

## 已完成变更

- **扫描策略调整**
  - 移除 `TIDYDESK_GO_APPS` 实验开关。
  - `electron/main.cjs` 默认尝试创建 Go apps sidecar client。
  - `electron/services/apps.cjs` 无 `goAppsClient` 时直接报错。
  - 删除 JS 目录扫描函数。
  - 删除 JS 单项快捷方式搜索函数。
  - 注册表增量安装事件改为 Go 全量扫描。

- **诊断增强**
  - 记录 `failedShortcuts`。
  - 记录 `skippedShortcuts`。
  - 记录 metadata 扫描耗时、快捷方式数量和扫描路径。

- **构建/打包配置**
  - 新增 `build:sidecar`。
  - `desktop` / `build:electron` / `build:publish` 自动先构建 sidecar。
  - electron-builder 使用 `extraResources` 打包 sidecar exe。
  - 打包后从 `process.resourcesPath` 加载 sidecar。

- **诊断脚本调整**
  - `scripts/compare-app-scans.cjs` 改为 Go 唯一路径扫描诊断脚本。

## 验证结果

已通过：

```text
node --check electron/main.cjs
node --check electron/services/apps.cjs
node --check scripts/test-go-app-scan.cjs
node --check scripts/compare-app-scans.cjs
go test ./...
npm run build:sidecar
npm run build
npx electron scripts/compare-app-scans.cjs
```

诊断结果：

```text
Go metadata: 141 shortcuts
Final apps: 77
Full duration: 4932ms
Iconless: 0
failedShortcuts: 5
skippedShortcuts: 59
```

## 结论

应用扫描已经从“JS 与 Go 并存/可回退”推进为“Go sidecar 唯一入口”。未来不再维护 JS 扫描路径。

## 下一步建议

下一阶段建议做 sidecar 发布质量增强：

- 增加 sidecar `version` / `health`。
- 主进程启动时校验 sidecar 可用性。
- 验证 electron-builder 实际产物中的 sidecar 路径。
- 然后进入 Tauri 最小壳 PoC。

---

# 阶段八：Sidecar 发布质量与启动校验交付记录

## 完成概览

本阶段为 Go sidecar 增加协议自描述和健康检查能力，并在 Electron 主进程启动时执行 sidecar 校验。由于 Go sidecar 已是唯一应用扫描入口，这一步用于尽早暴露 sidecar 缺失或协议异常。

## 已完成变更

- **Go sidecar 协议扩展**
  - `sidecar.version`
  - `sidecar.health`
  - 返回 name/version/protocolVersion/runtime/os/arch/methods/uptimeMs。

- **Electron client 扩展**
  - `getVersion()`
  - `getHealth()`

- **主进程启动校验**
  - 新增 `validateGoAppsSidecar()`。
  - 启动时调用 `ping`、`getVersion()`、`getHealth()`。

- **测试脚本扩展**
  - `scripts/test-go-sidecar.cjs` 输出 version 和 health。

## 验证结果

已通过：

```text
node --check electron/main.cjs
node --check electron/services/go-sidecar-client.cjs
node --check scripts/test-go-sidecar.cjs
node --check scripts/compare-app-scans.cjs
node --check scripts/test-go-app-scan.cjs
gofmt -w sidecars/apps-cache/main.go
go test ./...
npm run build
npm run build:sidecar
npx electron scripts/test-go-sidecar.cjs
```

协议输出摘要：

```text
ping: tidydesk-apps-cache-sidecar
version: 0.1.0
protocolVersion: 1
methods: 6
health.status: ok
scanMetadata: 141 shortcuts / 44ms
```

## 结论

sidecar 现在具备启动校验所需的版本和健康检查协议。Electron 启动时可以确认 sidecar 是否可用，并在异常时提前输出错误。

## 下一步建议

下一阶段建议做 **electron-builder 产物验证**：

- 构建 unpacked 或安装包产物。
- 检查 sidecar 是否在 `resources/sidecars/apps-cache/tidydesk-apps-cache.exe`。
- 启动打包产物确认 `validateGoAppsSidecar()` 通过。
- 完成后进入 Tauri 最小壳 PoC。

---

# 阶段九：electron-builder 产物 Sidecar 路径验证交付记录

## 完成概览

本阶段验证了 electron-builder unpacked 产物中的 Go sidecar 路径和协议可用性，确认 `extraResources` 与主进程 `process.resourcesPath` 加载约定匹配。

## 已完成变更

- **新增验证脚本**
  - `scripts/verify-packaged-sidecar.cjs`

- **新增 package scripts**
  - `build:electron:dir`
  - `verify:packaged-sidecar`

## 验证结果

已通过：

```text
node --check scripts/verify-packaged-sidecar.cjs
go test ./...
npm run build:electron:dir
npm run verify:packaged-sidecar
```

packaged sidecar 路径：

```text
release/win-unpacked/resources/sidecars/apps-cache/tidydesk-apps-cache.exe
```

协议验证：

```text
ping: tidydesk-apps-cache-sidecar
version: 0.1.0
protocolVersion: 1
runtime: go1.26.1
methods: 6
health.status: ok
```

## 清理结果

已清理：

```text
release/
sidecars/apps-cache/tidydesk-apps-cache.exe
```

## 结论

Go sidecar 可以被 electron-builder 正确打包到 `resources/sidecars/apps-cache/`，该路径与 `electron/main.cjs` 的 packaged 查找路径一致。packaged sidecar 可独立通过 stdio 协议响应 `ping/version/health`。

## 下一步建议

进入 **Tauri 最小壳 PoC**：

- 复用 React 前端。
- 建立最小 Tauri shell。
- 先验证窗口、托盘、sidecar 调用。
- 再逐步迁移 NativeClient 后端实现。

---

# 阶段十：Tauri 最小壳 PoC 交付记录

## 完成概览

本阶段新增了不影响 Electron 入口的 Tauri 最小壳 PoC。PoC 复用现有 React/Vite 前端，并通过 Tauri command 调用 Go sidecar 的 stdio JSON-RPC。

## 已完成变更

- **前端 PoC 页面**
  - `src/TauriPocApp.tsx`
  - `src/main.tsx` 新增 `mode=tauri-poc`

- **Tauri 工程**
  - `src-tauri/Cargo.toml`
  - `src-tauri/build.rs`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/src/main.rs`

- **Rust command**
  - `probe_go_sidecar`
  - 调用 Go sidecar：`ping`、`sidecar.version`、`sidecar.health`

- **脚本**
  - `tauri:poc:dev`
  - `tauri:poc:build`

- **文档**
  - `docs/development/TAURI_POC.md`

## 验证结果

已通过：

```text
JSON config check
npm run build
cargo fmt -- --check
go test ./...
```

未完成项：

```text
cargo check --offline
```

原因：本机没有缓存 `tauri` crate。需要允许联网下载 Rust 依赖后再执行完整 Rust 编译或运行 `npm run tauri:poc:dev`。

## 当前边界

此阶段没有迁移完整 Electron IPC，也没有替换生产 Electron 入口。Tauri 仅作为独立 PoC 壳存在。

## 下一步建议

下一阶段在允许拉取 Tauri 依赖后：

```text
npm run tauri:poc:dev
```

若窗口和 sidecar probe 成功，再开始：

- Tauri adapter
- NativeClient 运行时选择
- apps sidecar scan 迁移
- drawers/todos/windows 迁移
