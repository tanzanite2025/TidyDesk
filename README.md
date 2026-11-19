# TidyDesk

TidyDesk 是一个面向 Windows 的桌面整理工具，使用 `Tauri 2 + React + TypeScript + Rust` 构建，并由 Rust 后端扫描本机已安装应用。它的目标不是强行搬走你的文件，而是提供抽屉入口、待办、便签和截图贴纸这些轻量工作流，让桌面更干净，同时尽量降低误操作风险。

## 当前能力

- 桌面抽屉：把桌面文件收纳到抽屉中，默认优先创建快捷方式入口，避免直接破坏原始文件布局。
- 快捷方式体检：检测失效快捷方式，支持批量校验、有限自动修复和事件提示。
- 已安装应用导入：通过 Rust 后端扫描开始菜单和桌面快捷方式，并加入抽屉。
- Todo 面板：独立待办窗口，支持列管理和 Markdown 内容编辑。
- Quick Notes：抽屉侧栏快速记录便签。
- 截图贴纸：支持框选截图，默认按 `Ctrl+Alt+V` 后才贴到桌面，并支持置顶、复制和另存。
- 自动更新：基于 `tauri-plugin-updater`，支持检查、下载和安装签名更新包。

## 技术栈

- 前端：`React 18`、`TypeScript`、`Vite`、`Tailwind CSS`
- 桌面容器：`Tauri 2`
- 原生逻辑：`Rust`
- 桌面 smoke 测试：`tauri-driver` + `WebDriverIO`

## 目录结构

```text
TidyDesk/
├─ src/                     React 前端
│  ├─ components/           通用设置、热键弹窗等组件（settings/*）
│  ├─ context/              Workspace / Todo 全局状态
│  ├─ modules/              drawer / rail / handle / todos / notes / stickers / apps
│  ├─ native/               前端到 Tauri IPC 的 adapter
│  ├─ services/             前端服务（updater、workspace 等）
│  └─ types/                共享 TypeScript 类型
├─ src-tauri/               Tauri / Rust 后端
│  ├─ src/
│  │  ├─ apps_classifier/   已安装应用扫描、分类与缓存
│  │  ├─ asset_protocol.rs  tidydesk-asset:// 受控只读资产协议（截图内存/图标/贴纸）
│  │  ├─ capture/           GDI 截屏捕获、显示器快照与 snip 遮罩流程
│  │  ├─ commands/          IPC 命令分组与 E2E 测试命令桥
│  │  ├─ files/             桌面与抽屉扫描、图标、导入、还原与抽屉 CRUD
│  │  ├─ files_rules/       文件分类、路径清洗、storage、shortcut、shell open
│  │  ├─ hotkeys/           热键解析、持久化、冲突检测与全局注册
│  │  ├─ shell/             把手/抽屉窗口状态、布局与生命周期
│  │  ├─ shortcuts/         快捷方式监听与启发式修复
│  │  ├─ stickers/          贴纸持久化模型与 Win32 WS_EX_LAYERED 原生窗口渲染
│  │  ├─ todos/             待办看板与卡片 Markdown 存储（保留未知扩展字段）
│  │  ├─ tool_windows/      Todo / App Picker / Snip 窗口生命周期
│  │  └─ updates/           自动更新配置、状态快照与每日调度
│  └─ tauri.conf.json
├─ e2e-tests/               Tauri 窗口 smoke 测试
├─ scripts/                 构建与发布脚本
├─ build/                   图标等构建资源
└─ docs/                    用户文档、开发说明、历史归档
```

## 职责边界

- `src/modules/*` 与 `src/components/*` 只负责 UI 和用户交互流程。
- `src/native/*` 只负责把前端调用转成 Tauri command，不直接实现系统能力。
- `src-tauri/src/commands/*` 是跨领域命令入口；具体业务逻辑按领域内聚到 `apps*`、`files/`、`todos/`、`hotkeys/`、`shortcuts/`、`capture/`、`stickers/`、`updates/`、`shell/` 模块。
- `src-tauri/src/files_rules/*` 拆分文件分类、路径安全、托管 storage、Windows `.lnk` 和 shell open。
- `src-tauri/src/stickers/native_window.rs` 通过单一 Win32 后台 UI 线程 + `WS_EX_LAYERED` 原生分层窗口承载全部桌面贴纸，不再为单张贴纸启动独立 WebView2 进程。
- `src-tauri/src/tool_windows/*` 管理 Todo、App Picker、截图遮罩（Snip）工具窗口生命周期。
- `src-tauri/src/apps*.rs` 负责已安装应用扫描、cache、分类和导入抽屉，不再依赖额外 sidecar 进程。

## 本地开发

所有 npm 命令都在仓库根目录执行，也就是包含 `package.json` 的 `TidyDesk/`：

```powershell
cd C:\path\to\TidyDesk
```

如果你在别的目录执行 `npm run dev`，npm 会报 `Could not read package.json`。也可以不切目录，直接写：

```powershell
npm --prefix C:\path\to\TidyDesk run dev
```

### 环境要求

- `Node.js 18+`
- `Rust` / `cargo`（默认使用 Windows MSVC 工具链：`stable-x86_64-pc-windows-msvc`）
- `Microsoft Visual Studio C++ Build Tools`（提供 Windows SDK 与 MSVC 链接器）
- `Windows 10/11`

### 安装依赖

```powershell
npm install
```

### 推荐开发启动

日常开发直接使用：

```powershell
npm run dev
```

这条命令会启动完整 Tauri 桌面应用。等价于：

```powershell
npm run tauri:dev
```

### 仅启动前端页面

如果只想看 React/Vite 页面，不启动桌面壳：

```powershell
npm run dev:web
```

注意：`dev:web` 只启动浏览器页面，Tauri IPC、窗口控制、文件系统和截图等桌面能力不可用；看到相关报错时请改用 `npm run dev`。

### Tauri 开发

`npm run tauri:dev` 会启动 Vite dev server，并运行 Rust/Tauri 桌面进程。

```powershell
npm run tauri:dev
```

### 常用检查

这些命令也都在仓库根目录执行：

```powershell
npm run build
npm run check:rust
```

也可以一条命令跑完常用检查：

```powershell
npm run check
```

对应的底层命令是：

```powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
```

### 常见报错

| 报错/现象 | 原因 | 处理 |
| --- | --- | --- |
| `Could not read package.json` | 当前终端不在仓库根目录 | 先 `cd C:\path\to\TidyDesk`，或使用 `npm --prefix C:\path\to\TidyDesk run dev` |
| `Port 3000 is already in use` | 上一次 Vite/Tauri dev 进程还在运行 | 关闭旧终端或结束占用 3000 端口的 node 进程后重试 |
| 浏览器页面里出现 Tauri/IPC/window 相关错误 | 启动的是纯前端 `dev:web`，不是桌面应用 | 用 `npm run dev` |
| `link.exe` 缺失或 MSVC 链接失败 | 未安装 Visual Studio C++ Build Tools 或 `stable-x86_64-pc-windows-msvc` | 安装 C++ Build Tools 并确认 `rustup default stable-x86_64-pc-windows-msvc` |

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

### 版本一致性检查

```bash
npm run tauri:verify-version
```

发布前会校验 `package.json` 和 `src-tauri/Cargo.toml` 版本一致；在 GitHub Actions 发布时还会校验 tag 必须等于 `v<package.json version>`。

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
- 推送 `v*` tag 会触发 `.github/workflows/release.yml`，自动构建并上传 `.exe`、`.exe.sig` 和 `latest.json` 到 GitHub Release。

GitHub Release workflow 需要在仓库 Settings → Secrets and variables → Actions 中配置：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（无密码私钥可设置为空字符串）

### 主要产物路径

- 主程序可执行文件：`src-tauri/target/release/tidydesk.exe`
- NSIS 安装包：`src-tauri/target/release/bundle/nsis/*.exe`（若显式指定了 `CARGO_BUILD_TARGET` / `TAURI_TARGET_TRIPLE`，则位于 `src-tauri/target/<triple>/release/bundle/nsis/*.exe`）
- 安装包签名：`src-tauri/target/release/bundle/nsis/*.exe.sig`
- updater manifest：`release-tauri/latest.json`（可通过 `TIDYDESK_UPDATER_MANIFEST_DIR` 修改目录）
- 若仅需本地验证打包、未配置签名私钥，可直接运行 `npx tauri build` 生成未签名安装包。

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
- 生产测试 IPC 被限定在 debug/test 场景，避免 release 包暴露测试能力。
- updater 不允许通过普通运行时环境变量覆盖公钥；真正需要保密的是签名私钥，不是公钥。
- `stickers`、`todos`、`quick notes` 的本地状态写入已经串行化，降低多窗口同时写入导致的数据覆盖风险。
- 抽屉展开/收起改由纯 CSS GPU 动画配合代际取消实现，移除了高频窗口位置重绘线程。
- 应用扫描已内聚到 Rust 后端，避免 sidecar 进程/RPC/target triple 复制带来的额外失败点。
- 应用内截图背景与图标加载统一收敛到 `tidydesk-asset://` 受控只读自定义协议（内存直出截图 + 磁盘缓存图标 URL），并启用显式 CSP 限制脚本、对象、frame 和跨源连接范围。
- 桌面贴纸采用单一 Win32 后台线程 + `WS_EX_LAYERED` 原生分层窗口，避免多贴纸场景下 WebView2 进程与内存线性膨胀。

## 文档入口

- [文档中心](docs/README.md)：当前用户文档、开发文档和历史归档入口。
- [快速开始](docs/user/QUICK_START.md)：安装后如何使用抽屉、快捷方式、更新。
- [自动更新指南](docs/user/AUTO_UPDATE_GUIDE.md)：Tauri updater 发布和排障。
- [当前优化和 BUG 审计](docs/development/CURRENT_SOFTWARE_OPTIMIZATION_AND_BUG_AUDIT.md)：稳定性、性能和维护性优化建议。

## 当前已知限制

- 快捷方式自动修复仍然是启发式能力，只会在“唯一候选”时自动执行，不能替代人工确认。
- 当前已经补上“应用扫描 -> 导入抽屉”以及首批 Tauri 多窗口 smoke 自动化，但截图成图、恢复链路和更多异常路径还可以继续扩展。
- Tauri E2E 依赖 `tauri-driver` 和与本机 Edge 主版本匹配的 WebDriver，首次运行前需要单独准备。

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

每次改动后，至少建议跑：

```bash
npm run build
npm run check:rust
```

涉及发布、updater 或窗口行为时，再补充对应专项检查：

```bash
npm run tauri:bundle
npm run test:e2e:tauri
```
