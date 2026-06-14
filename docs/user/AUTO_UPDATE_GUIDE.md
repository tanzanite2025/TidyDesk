# TidyDesk 自动更新指南

本文档描述当前 Tauri 版本的自动更新流程。旧 Electron `electron-updater` / `electron-builder` 发布说明已经过期。

## 功能概述

TidyDesk 使用 `tauri-plugin-updater`：

- 应用内检查更新。
- 下载签名更新包。
- 安装并重启。
- 展示版本、进度和更新说明。

更新包签名由 Tauri updater 公钥校验。公钥可以提交到仓库；需要保密的是签名私钥。

## 关键文件

```text
src-tauri/tauri.conf.json                  updater endpoint、公钥、bundle 配置
src-tauri/src/updates.rs                   Rust updater command
src/services/updates/use-update-manager.ts 前端更新状态管理
scripts/run-tauri-build.cjs                Tauri build 包装脚本
scripts/generate-tauri-latest-json.cjs     latest.json 生成脚本
release-tauri/latest.json                  updater manifest 产物
```

## 构建前环境变量

至少需要以下变量之一：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PATH`

如果私钥有密码，还需要：

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

可选变量：

- `TIDYDESK_UPDATER_NOTES`：写入 `latest.json` 的更新说明。
- `TIDYDESK_UPDATER_BASE_URL`：覆盖默认 GitHub Releases 下载地址。
- `TIDYDESK_UPDATER_MANIFEST_DIR`：修改 `latest.json` 输出目录。
- `TAURI_TARGET_TRIPLE`：指定打包目标架构。

## 发布流程

1. 安装依赖并完成基础检查：

```bash
npm install
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
go -C sidecars/apps-cache test ./...
```

2. 打包安装包和签名：

```bash
npm run tauri:bundle
```

3. 生成 updater manifest：

```bash
npm run tauri:manifest
```

或直接一键执行：

```bash
npm run tauri:release
```

4. 在 GitHub Releases 发布以下产物：

- `src-tauri/target/release/bundle/nsis/*.exe`
- `src-tauri/target/release/bundle/nsis/*.exe.sig`
- `release-tauri/latest.json`

`latest.json` 中的下载地址必须能访问到同一个 release 下的安装包。

## 用户更新流程

```text
应用启动或用户点击检查更新
    ↓
读取 tauri.conf.json 中配置的 latest.json endpoint
    ↓
校验 latest.json 与安装包签名
    ↓
下载更新包
    ↓
用户点击安装并重启
    ↓
Tauri updater 安装新版本
```

## 开发和测试

开发模式下通常不应直接安装更新。需要验证 updater 链路时，使用签名 release 构建，并让 `latest.json` 指向可访问的测试 release。

常用检查：

```bash
npm run build
npm run tauri:bundle
npm run tauri:manifest
```

## 故障排除

### 检查更新失败

优先检查：

- `src-tauri/tauri.conf.json` 的 updater endpoint 是否可访问。
- `release-tauri/latest.json` 是否已上传到对应 release。
- `latest.json` 里的安装包 URL 是否正确。
- 网络是否能访问 GitHub Releases。

### 签名校验失败

优先检查：

- 安装包 `.sig` 是否和 `.exe` 来自同一次构建。
- 构建时使用的私钥是否匹配 `tauri.conf.json` 中的公钥。
- release 中是否上传了正确的 `.sig` 文件。

### 安装失败

优先检查：

- 当前安装包是否被杀毒软件拦截。
- 应用进程是否仍在运行。
- 当前用户是否有安装目录写入权限。
- 磁盘空间是否足够。

## 安全注意事项

- 不要提交 `TAURI_SIGNING_PRIVATE_KEY` 或私钥文件。
- 不要在日志中打印私钥或密码。
- release 包应来自受控构建环境。
- updater 公钥变更需要同步更新 `src-tauri/tauri.conf.json` 并重新发布客户端。

**最后更新**: 2026-06-14
