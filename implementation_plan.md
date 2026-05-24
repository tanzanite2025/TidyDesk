# TidyDesk 阶段十：Tauri 最小壳 PoC 实施方案

## 一、目标

阶段十只建立 Tauri 最小壳，不迁移完整后端能力。PoC 目标是证明：

```text
React/Vite 前端
  -> Tauri command
  -> Go sidecar stdio JSON-RPC
```

这条链路可行。

## 二、新增前端页面

新增：

```text
src/TauriPocApp.tsx
```

`src/main.tsx` 新增模式：

```text
?mode=tauri-poc
```

页面会调用：

```text
probe_go_sidecar
```

并展示：

- sidecar 路径
- ping
- version
- protocolVersion
- runtime
- health
- methods 数量

## 三、新增 Tauri 工程

新增：

```text
src-tauri/Cargo.toml
src-tauri/build.rs
src-tauri/tauri.conf.json
src-tauri/src/main.rs
```

Tauri 配置：

```text
beforeDevCommand: npm run prepare:tauri-sidecar && npm run dev
beforeBuildCommand: npm run prepare:tauri-sidecar && npm run build
devUrl: http://localhost:3000?mode=tauri-poc
frontendDist: ../dist
```

`prepare:tauri-sidecar` 会构建 Go sidecar，并复制为 Tauri `externalBin` 需要的 target-triple 文件名：

```text
src-tauri/sidecars/apps-cache/tidydesk-apps-cache-x86_64-pc-windows-msvc.exe
```

Rust command：

```text
probe_go_sidecar
```

Rust 侧按候选路径查找 sidecar：

```text
sidecars/apps-cache/tidydesk-apps-cache.exe
resource_dir/sidecars/apps-cache/tidydesk-apps-cache.exe
current_dir/sidecars/apps-cache/tidydesk-apps-cache.exe
```

## 四、新增 scripts

```text
npm run tauri:poc:dev
npm run tauri:poc:build
npm run prepare:tauri-sidecar
```

当前使用：

```text
npx @tauri-apps/cli@2
```

避免立刻写入 npm lockfile。

## 五、验证记录

已执行：

```text
node -e "JSON.parse(package.json); JSON.parse(src-tauri/tauri.conf.json)"
npm run build
cargo fmt -- --check
go test ./...
npm run prepare:tauri-sidecar
cargo check
npm run tauri:poc:dev
```

结果：

- JSON 检查通过。
- TypeScript/Vite 构建通过。
- Rust 格式检查通过。
- Go sidecar 测试通过。
- `cargo check` 通过。
- `npm run tauri:poc:dev` 成功编译并运行 `target\debug\tidydesk-tauri-poc.exe`。
- 已修复 Tauri `externalBin` 需要 target-triple 后缀 sidecar 文件名的问题。
- Tauri PoC 页面已验证按钮可点击，`ping/version/health/methods` 均正常返回。
- `Sidecar path` 空白问题已通过 `serde(rename_all = "camelCase")` 修复。

## 六、下一步建议

下一步：

1. `src/native/tauri-adapter.ts`。
2. NativeClient 运行时 adapter 选择。
3. apps sidecar scan 迁移。
4. drawers/todos/windows 逐步迁移。
