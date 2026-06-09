# TidyDesk

TidyDesk 是一个面向 Windows 的桌面整理工具，使用 `Tauri 2 + React + TypeScript + Rust` 构建，并通过 Go sidecar 扫描本机已安装应用。它的目标不是强行搬走你的文件，而是提供抽屉入口、待办、便签和截图贴纸这些轻量工作流，让桌面更干净，同时尽量降低误操作风险。

## 当前能力

- 桌面抽屉：把桌面文件收纳到抽屉中，默认优先创建快捷方式入口，避免直接破坏原始文件布局。
- 快捷方式体检：检测失效快捷方式，支持批量校验、有限自动修复和事件提示。
- 已安装应用导入：通过 Go sidecar 扫描开始菜单和桌面快捷方式，并加入抽屉。
- Todo 面板：独立待办窗口，支持列管理和 Markdown 内容编辑。
- Quick Notes：抽屉侧栏快速记录便签。
- 截图贴纸：支持框选截图、生成贴纸、置顶、复制和另存。
- 自动更新：基于 `tauri-plugin-updater`，支持检查、下载和安装签名更新包。

## 技术栈

- 前端：`React 18`、`TypeScript`、`Vite`、`Tailwind CSS`
- 桌面容器：`Tauri 2`
- 原生逻辑：`Rust`
- 应用扫描 sidecar：`Go`

## 目录结构

```text
TidyDesk/
├─ src/                     React 前端
├─ src-tauri/               Tauri / Rust 代码
│  ├─ src/
│  └─ tauri.conf.json
├─ sidecars/apps-cache/     Go sidecar 源码
├─ scripts/                 构建与发布脚本
├─ build/                   图标等构建资源
└─ docs/                    补充文档
```

## 本地开发

### 环境要求

- `Node.js 18+`
- `Rust` 和 `cargo`
- `Go 1.20+`
- `Windows 10/11`

### 安装依赖

```bash
npm install
```

### 前端开发

```bash
npm run dev
```

### Tauri 开发

`npm run tauri:dev` 会先执行 `prepare:tauri-sidecar`，自动编译并复制 sidecar。

```bash
npm run tauri:dev
```

### 常用检查

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 打包发布

### 仅构建前端静态资源

```bash
npm run build
```

### 仅打包安装包

```bash
npm run tauri:bundle
```

### 一键打包安装包并生成 updater manifest

```bash
npm run tauri:build
```

### 发布命令别名

```bash
npm run tauri:release
```

当前 `npm run tauri:release` 等价于 `npm run tauri:build`，方便本地和 CI 共用同一条命令。

### 打包前必需环境变量

至少需要以下变量之一：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PATH`

如果私钥是加密的，还需要：

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

构建脚本会优先读取当前终端环境变量；如果当前终端没设置，会自动回退读取 Windows 用户环境变量，所以通常只需要设置一次：

```powershell
[System.Environment]::SetEnvironmentVariable(
  'TAURI_SIGNING_PRIVATE_KEY_PATH',
  "$env:USERPROFILE\.tauri\tidydesk.key",
  'User'
)
[System.Environment]::SetEnvironmentVariable(
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  '',
  'User'
)
```

如果私钥创建时没有密码，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 可以显式设置为空字符串。

### 常用可选环境变量

- `TIDYDESK_UPDATER_NOTES`：写入 `latest.json` 的更新说明。
- `TIDYDESK_UPDATER_BASE_URL`：覆盖默认的 GitHub Releases 下载地址。
- `TIDYDESK_UPDATER_MANIFEST_DIR`：修改 `latest.json` 输出目录。
- `TAURI_TARGET_TRIPLE`：指定打包目标架构。

例如：

```powershell
[System.Environment]::SetEnvironmentVariable(
  'TIDYDESK_UPDATER_NOTES',
  'Bug fixes and stability improvements.',
  'User'
)
```

### 默认发布配置

- `src-tauri/tauri.conf.json` 已内置 GitHub Releases 的 `latest.json` endpoint。
- updater 公钥已内置在 `plugins.updater.pubkey` 中。
- Windows 安装更新默认使用 `passive` 模式，减少安装过程中的额外交互。
- `bundle.createUpdaterArtifacts` 已开启。
- `npm run tauri:bundle` 会生成安装包和对应 `.sig` 文件。
- `npm run tauri:build` 会额外生成 `release-tauri/latest.json`。

### 主要产物路径

- 安装包：`src-tauri/target/release/bundle/nsis/*.exe`
- 安装包签名：`src-tauri/target/release/bundle/nsis/*.exe.sig`
- updater manifest：`release-tauri/latest.json`

## 数据存储

应用数据保存在 Tauri 的 `app_data_dir()` 下，主要包括：

- `drawers/`：抽屉目录
- `storage/`：TidyDesk 托管的原文件存储区
- `todos/`：待办面板数据
- `quick-notes.json`：快速便签数据
- `stickers/`：截图贴纸和状态数据

## 稳定性与安全说明

- 文件收纳默认优先创建快捷方式入口，而不是直接覆盖原始文件。
- Rust 命令层对抽屉目录、恢复目录和托管存储目录做了路径边界校验。
- `stickers`、`todos`、`quick notes` 的本地状态写入已经串行化，降低多窗口同时写入导致的数据覆盖风险。
- 抽屉动画线程现在带有代际取消，避免旧动画继续改窗口位置。
- sidecar 访问改为后台 worker 串行处理，并带超时与自动重启，避免坏进程长期把扫描功能拖死。
- 生产包已启用显式 CSP，限制脚本、对象、frame 和跨源连接范围。
- updater 使用公钥校验更新包签名；真正需要保密的是签名私钥，不是公钥。

## 当前已知限制

- 快捷方式自动修复仍然是启发式能力，只会在“唯一候选”时自动执行，不能替代人工确认。
- 当前已经补上 sidecar 超时/重启、“应用扫描 -> 导入抽屉”以及首批 Tauri 多窗口 smoke 自动化，但截图成图、恢复链路和更多异常路径还可以继续扩展。
- 多窗口能力边界还可以继续细化到 Tauri capability 级别，后续仍值得补。

## Tauri UI 自动化

当前仓库已经内置一套基于 `tauri-driver + WebDriverIO` 的桌面 smoke 测试，优先覆盖：

- 把手窗口打开/关闭抽屉
- Todo 窗口打开/关闭
- 应用选择器打开/关闭
- 截图遮罩打开后 `Esc` 取消，并验证把手仍可继续操作

### 首次准备

1. 安装 `tauri-driver`

```bash
cargo install tauri-driver --locked
```

2. 安装与本机 Microsoft Edge 主版本匹配的 `msedgedriver.exe`

建议把驱动放到固定路径，然后设置：

```powershell
[System.Environment]::SetEnvironmentVariable(
  'TIDYDESK_EDGE_DRIVER_PATH',
  'C:\Tools\msedgedriver.exe',
  'User'
)
```

如果你已经把 `msedgedriver.exe` 加进了 `PATH`，也可以不设这个变量。

3. 安装 E2E 依赖

```bash
npm run test:e2e:install
```

### 运行命令

```bash
npm run test:e2e:tauri
```

默认会先构建一份 `release + no-bundle` 的 Tauri 可执行文件，再启动 `tauri-driver` 跑测试。

如果你刚刚已经手动构建过，也可以跳过这一步：

```powershell
$env:TIDYDESK_SKIP_E2E_BUILD='1'
npm run test:e2e:tauri
```

## 建议回归检查

每次改动后，至少建议跑下面两条：

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml apps::tests -- --nocapture
npm run test:e2e:tauri
```
