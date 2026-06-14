# TidyDesk 文档中心

这里保留当前仍建议阅读的文档入口；历史实现总结和旧版本发布材料统一放在 `docs/archive/`，避免和当前 Tauri 架构混在一起。

## 推荐阅读顺序

### 用户

1. [快速开始](./user/QUICK_START.md) - 安装后如何使用抽屉、快捷方式、更新。
2. [自动更新指南](./user/AUTO_UPDATE_GUIDE.md) - 如何检查更新、发布签名更新包、排查更新失败。
3. [从这里开始](./user/START_HERE.md) - 按用户/维护者/开发者角色选择文档入口。

### 开发者

1. [主项目 README](../README.md) - 当前架构、目录职责、开发/构建/测试命令。
2. [安全与结构审计](../SECURITY_AND_STRUCTURE_AUDIT.md) - 已完成的安全修复和结构拆分记录。
3. [更新日志](../CHANGELOG.md) - 版本变化和历史功能记录。

### 发布维护

- [自动更新指南](./user/AUTO_UPDATE_GUIDE.md)
- [v3.4.1 发布说明](./releases/v3.4.1/RELEASE_NOTES.md)
- [历史发布文档](./archive/)

## 当前文档分区

```text
docs/
├── README.md              # 本文件，当前文档入口
├── user/                  # 面向使用者/维护者的当前指南
├── development/           # 仍有参考价值的开发说明；PoC 文档仅保留历史说明
├── releases/              # 近期版本发布说明
└── archive/               # 旧版本、阶段性总结、一次性排障记录
```

## 已清理的过期内容

- `docs/user/START_HERE.md` 已从早期“项目完成/首次发布”说明改为当前入口页。
- `docs/user/AUTO_UPDATE_GUIDE.md` 已从 Electron updater 说明改为 Tauri updater 说明。
- `docs/development/TAURI_POC.md` 已标记为历史 PoC，不再推荐使用旧 `tauri:poc:*` 命令。
- `docs/development/GO_SIDECAR_POC.md` 已标记为历史 PoC；当前应用扫描以 Rust 后端实现为准。

## 归档规则

以下文档应放入 `docs/archive/`，不再作为日常入口：

- 旧版本 release/hotfix/complete 总结。
- 一次性问题复盘、阶段性测试结果、临时修复计划。
- PoC 验证文档，除非它已经被改写为当前架构说明。

以下文档应继续保留在活跃入口：

- README、快速开始、自动更新、当前架构/开发命令。
- 仍会影响代码维护的安全审计、结构审计和发布流程。

**最后更新**: 2026-06-14
