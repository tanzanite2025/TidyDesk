# TidyDesk

TidyDesk 是一个面向 Windows 的桌面整理工具，使用 `Tauri 2 + React + TypeScript + Rust` 构建，并通过一个 Go sidecar 扫描本机已安装应用。它的目标不是“强行搬走你的文件”，而是先建立抽屉式入口、待办、便签和截图工作流，让桌面更干净，同时尽量降低误操作风险。

## 当前能力

- 桌面抽屉：把桌面文件收纳到抽屉中，默认以快捷方式作为入口，避免直接破坏原始文件布局
- 快捷方式体检：检测失效快捷方式，支持批量校验、清理和有限的自动修复
- 已安装应用收纳：通过 Go sidecar 扫描开始菜单/桌面快捷方式，并加入抽屉
- 待办面板：独立 Todo 窗口，支持列管理、Markdown 编辑和预览
- 快捷记录：抽屉侧栏可切换到快速记录面板
- 截图贴纸：支持截图、贴纸展示、置顶、复制和另存为
- 自动更新：基于 Tauri updater，支持检查、下载和安装签名更新包

## 技术栈

- 前端：`React 18`、`TypeScript`、`Vite`、`Tailwind CSS`
- 桌面容器：`Tauri 2`
- 原生逻辑：`Rust`
- 应用扫描 sidecar：`Go`

## 目录结构

```text
TidyDesk/
├─ src/                 React 前端
├─ src-tauri/           Tauri / Rust 代码
│  ├─ src/
│  └─ tauri.conf.json
├─ sidecars/apps-cache/ Go sidecar 源码
├─ scripts/             构建与发布脚本
├─ docs/                补充文档
└─ build/               图标等构建资源
```

## 本地开发

### 环境要求

- `Node.js 18+`
- `Rust` 与 `cargo`
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

`prepare:tauri-sidecar` 会自动编译并复制 sidecar，因此日常启动建议直接使用：

```bash
npm run tauri:dev
```

### 常用检查

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 构建与发布

### 仅构建前端静态资源

```bash
npm run build
```

### 仅构建安装包与签名

```bash
npm run tauri:bundle
```

### 一键构建安装包并生成 updater manifest

```bash
npm run tauri:build
```

### 发布命令别名

```bash
npm run tauri:release
```

当前 `npm run tauri:release` 等价于 `npm run tauri:build`，方便本地与 CI 统一命令。

### 发布前必需环境变量

- `TAURI_SIGNING_PRIVATE_KEY` 或 `TAURI_SIGNING_PRIVATE_KEY_PATH`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

说明：如果签名私钥是加密的，非交互构建必须提供 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；如果当初生成私钥时使用的是空密码，可以显式设为空字符串。

构建脚本会优先读取当前终端环境变量；如果当前终端没有设置，则会自动回退到 Windows 用户环境变量，所以推荐只设置一次：

```powershell
[System.Environment]::SetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PATH', 'C:\Users\你的用户名\.tauri\tidydesk.key', 'User')
[System.Environment]::SetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', '', 'User')
```

如果你只配置了 `TAURI_SIGNING_PRIVATE_KEY_PATH`，`scripts/run-tauri-build.cjs` 会自动读取私钥文件内容并传给 Tauri CLI。

### 常用可选环境变量

- `TIDYDESK_UPDATER_BASE_URL`：覆盖默认的 GitHub Releases 下载地址
- `TIDYDESK_UPDATER_NOTES`：写入 `latest.json` 的更新说明
- `TIDYDESK_UPDATER_MANIFEST_DIR`：修改 `latest.json` 输出目录
- `TAURI_TARGET_TRIPLE`：指定打包目标架构

### 默认发布配置

- `src-tauri/tauri.conf.json` 已内置 GitHub Releases 的 `latest.json` endpoint
- updater 公钥已内置在 `plugins.updater.pubkey` 中，安装后的客户端会直接使用它验证更新签名
- Windows 安装更新默认使用 `passive` 模式，保留进度反馈但减少人工交互
- `bundle.createUpdaterArtifacts` 已开启，`npm run tauri:bundle` 会生成安装包与 `.sig` 签名文件，`npm run tauri:build` 会额外生成 `release-tauri/latest.json`

### updater manifest 说明

- `npm run tauri:manifest` 需要先存在已签名的安装包和对应 `.sig` 文件
- 如果未设置 `TIDYDESK_UPDATER_BASE_URL`，脚本会优先从 `package.json > build.publish` 推导 GitHub Releases 地址，并回退到 `GITHUB_REPOSITORY` 或 `repository.url`

## 数据存储

应用数据保存在 Tauri 的 `app_data_dir()` 下，主要包括：

- `drawers/`：抽屉目录
- `storage/`：TidyDesk 托管的原文件存储区
- `todos/`：待办面板数据
- `stickers/`：贴纸与截图数据

## 安全说明

- 默认优先创建快捷方式入口，而不是直接删除或覆盖原文件
- Rust 命令层对抽屉目录、恢复目录和托管存储目录做了路径边界校验
- 生产包已补上显式 CSP，限制脚本、对象、frame 和跨源连接范围
- updater 依赖签名公钥验证更新包
- updater 公钥可以安全提交到仓库；真正需要严格保密的是签名私钥
- 快捷方式自动修复现在只会在“唯一候选文件”时执行，避免同名文件误修复

## 当前已知限制

- 快捷方式自动修复本质上仍是启发式能力，不能替代人工确认
- 仓库里还没有看到 `src-tauri/capabilities/*.json` 这类窗口级 capability 配置，后续建议把主窗口、待办窗口、贴纸窗口的 Tauri 权限进一步按窗口拆分
- Rust 命令层目前缺少针对路径恢复、抽屉导入和快捷方式修复的自动化测试

## 这次仓库自检结果

已完成的本地检查：

- `npm run build`
- `cargo check`
- `npm audit --omit=dev`
- `npm run tauri:manifest`
  说明：在验证时临时补了一个测试签名文件，仅用于确认 manifest 生成逻辑和 GitHub release URL 推导是否正确，随后已删除

当前结果：

- 前端构建通过
- Rust 编译检查通过
- 生产依赖未发现 `npm audit` 已知漏洞
- updater manifest 脚本现在可以正确推导 `https://github.com/tanzanite2025/TidyDesk/releases/download/v3.0.1`

## 后续建议

如果你准备继续把这个项目做成可稳定发布的桌面应用，建议优先做这三件事：

1. 为不同窗口补齐 Tauri capability 配置，收紧 IPC 和插件权限边界
2. 给 Rust 命令层补少量路径安全与恢复逻辑测试
3. 给前端补一条覆盖“智能整理 -> 导入 -> 刷新”的集成验证，避免后续回归
