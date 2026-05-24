# Go Sidecar PoC：apps/cache 协议验证

## 目标

本 PoC 验证 TidyDesk 后续 Go 化的最小可行路径：通过 stdio JSON-RPC 让 Electron 主进程调用 Go sidecar。

本阶段只验证协议与缓存读取，不替换现有应用扫描逻辑，不接管窗口、托盘、截图、自动更新等壳能力。

## 当前边界

```text
React UI
  -> nativeClient.apps
    -> electronAdapter
      -> Electron IPC
        -> Electron main/service
          -> Go sidecar PoC（可选，暂不接管生产路径）
```

## 协议格式

请求按行传输，每行一个 JSON：

```json
{
  "id": "1",
  "method": "apps.cacheInfo",
  "params": {
    "userDataPath": "C:/Users/.../AppData/Roaming/TidyDesk"
  }
}
```

响应：

```json
{
  "id": "1",
  "ok": true,
  "data": {}
}
```

错误响应：

```json
{
  "id": "1",
  "ok": false,
  "error": "message"
}
```

## 已实现方法

- `ping`
  - 验证 sidecar 存活。

- `apps.cacheInfo`
  - 读取当前 Electron app cache 元信息。
  - 返回 `exists`、`valid`、`appCount`、`ageMinutes`、`timestamp`、`version`。

- `apps.readCache`
  - 读取当前 app cache 原始内容。
  - 仅用于 PoC 验证，不作为生产数据源。

## 文件结构

```text
sidecars/apps-cache/
  go.mod
  main.go

electron/services/go-sidecar-client.cjs
scripts/test-go-sidecar.cjs
```

## 验证方式

构建 sidecar：

```powershell
go build -o sidecars/apps-cache/tidydesk-apps-cache.exe ./sidecars/apps-cache
```

运行协议测试：

```powershell
node scripts/test-go-sidecar.cjs
```

## 为什么先做 cache 而不是 scan

当前历史分析显示应用扫描慢点主要来自 Electron `app.getFileIcon()`，Go 无法直接优化这一部分。因此 Go 化第一步选择缓存读取与协议验证，更低风险。

后续如果要 Go 化扫描，可以先让 Go 返回无图标的 app metadata，再由 Electron 逐步补图标，避免一次性替换全部链路。

## 下一步

- 在 Electron main 中增加可选实验开关。
- 只在开关启用时调用 Go sidecar 的 `apps.cacheInfo`。
- 若稳定，再新增 `apps.scanMetadata`，由 Go 负责扫描 `.lnk` 元数据，Electron 负责图标补全。

## apps.scanMetadata 扩展

阶段四新增 `apps.scanMetadata`：

- Go 扫描开始菜单与桌面的 `.lnk` 元数据。
- 返回扫描路径、快捷方式列表和耗时。
- 不解析 target，不获取图标，不替换生产扫描逻辑。

验证结果：

```text
shortcutCount: 141
durationMs: 35
```

下一步建议：增加 `TIDYDESK_GO_APPS=1` 实验开关，由 Electron 调用 Go metadata，再由 Electron 补 target 和 icon。

## TIDYDESK_GO_APPS 实验路径

阶段五新增可选实验路径：

```text
TIDYDESK_GO_APPS=1
  -> Go apps.scanMetadata
  -> Electron shell.readShortcutLink
  -> Electron app.getFileIcon
```

验证结果：

```text
Go metadata scan completed in 41ms, found 141 shortcuts
Go metadata + Electron completion found 77 installed applications
Full script duration: 6539ms
```

当前不默认启用，不替换原 JS 扫描路径。下一步建议做扫描结果一致性对比和失败项诊断。

## JS vs Go 扫描对比

阶段六新增：

```text
scripts/compare-app-scans.cjs
```

结果：

```text
JS scan: 77 apps / 4279ms
Go scan: 77 apps / 520ms
onlyInJs: 0
onlyInGo: 0
categoryMismatches: 0
```

结论：Go metadata + Electron 补全路径与原 JS 扫描结果一致，并显著降低耗时。剩余失败项来自 Electron `shell.readShortcutLink()`。

## Go Sidecar 唯一扫描入口

阶段七完成策略调整：应用扫描不再保留 JS 手动路径或 JS 回退路径。

当前路径：

```text
Go apps.scanMetadata
  -> Electron shell.readShortcutLink
  -> Electron app.getFileIcon
```

构建配置：

```text
npm run build:sidecar
npm run desktop
npm run build:electron
npm run build:publish
```

`desktop` / `build:electron` / `build:publish` 都会先构建 sidecar。

electron-builder 使用 `extraResources` 打包 sidecar，打包后从 `process.resourcesPath/sidecars/apps-cache/tidydesk-apps-cache.exe` 加载。

验证结果：

```text
Final apps: 77
failedShortcuts: 5
skippedShortcuts: 59
iconless: 0
```

## Sidecar version/health

阶段八新增 RPC 方法：

```text
sidecar.version
sidecar.health
```

Electron client 新增：

```text
getVersion()
getHealth()
```

主进程启动时执行：

```text
ping -> sidecar.version -> sidecar.health
```

验证摘要：

```text
name: tidydesk-apps-cache-sidecar
version: 0.1.0
protocolVersion: 1
methods: 6
health.status: ok
scanMetadata: 141 shortcuts / 44ms
```

## electron-builder packaged sidecar 验证

阶段九新增：

```text
scripts/verify-packaged-sidecar.cjs
npm run build:electron:dir
npm run verify:packaged-sidecar
```

验证路径：

```text
release/win-unpacked/resources/sidecars/apps-cache/tidydesk-apps-cache.exe
```

验证结果：

```text
size: 3392512
ping: tidydesk-apps-cache-sidecar
version: 0.1.0
protocolVersion: 1
runtime: go1.26.1
methods: 6
health.status: ok
```

结论：electron-builder 的 `extraResources` 输出路径与 `process.resourcesPath` 加载约定一致。
