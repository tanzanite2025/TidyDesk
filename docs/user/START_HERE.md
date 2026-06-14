# 从这里开始 - TidyDesk

这个页面只做入口导航。旧的“项目完成 / 首次发布 / Electron 构建”说明已经过期，当前请以根目录 README 和 Tauri 构建命令为准。

## 我是用户

建议阅读：

1. [快速开始](./QUICK_START.md)
2. [自动更新指南](./AUTO_UPDATE_GUIDE.md)
3. [更新日志](../../CHANGELOG.md)

你主要会用到：桌面抽屉、快捷方式体检、应用导入、Todo、Quick Notes、截图贴纸和自动更新。

## 我是开发者

建议阅读：

1. [主项目 README](../../README.md)
2. [文档中心](../README.md)
3. [安全与结构审计](../../SECURITY_AND_STRUCTURE_AUDIT.md)

常用命令都在仓库根目录（包含 `package.json` 的 `TidyDesk/`）执行：

```powershell
npm install
npm run dev
npm run build
npm run check:rust
```

涉及桌面窗口行为时再跑：

```powershell
npm run test:e2e:install
npm run test:e2e:tauri
```

## 我是发布维护者

建议阅读：

1. [主项目 README 的打包发布章节](../../README.md#打包发布)
2. [自动更新指南](./AUTO_UPDATE_GUIDE.md)
3. [CHANGELOG.md](../../CHANGELOG.md)

核心命令：

```powershell
npm run tauri:bundle
npm run tauri:build
npm run tauri:release
```

发布前至少确认：

- `TAURI_SIGNING_PRIVATE_KEY` 或 `TAURI_SIGNING_PRIVATE_KEY_PATH` 已配置。
- 如私钥有密码，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 已配置。
- `src-tauri/tauri.conf.json` 的 updater endpoint 指向正确的 GitHub Releases `latest.json`。
- `release-tauri/latest.json` 和安装包 `.sig` 已随 release 一起发布。

## 哪些文档是历史资料

`docs/archive/` 下的大量 release、hotfix、阶段性测试和排障文档只保留历史上下文，不建议作为当前开发入口。

`docs/development/*POC*.md` 也只保留 PoC 背景：Tauri 和应用扫描已经进入 Rust 主线实现，当前命令以 README 为准。
