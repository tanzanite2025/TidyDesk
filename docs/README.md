# TidyDesk 文档中心

欢迎来到 TidyDesk 文档中心！这里包含了所有的用户文档、开发文档和版本发布说明。

---

## 📚 文档导航

### 👤 用户文档

- [快速开始](./user/QUICK_START.md) - 5 分钟上手 TidyDesk
- [自动更新指南](./user/AUTO_UPDATE_GUIDE.md) - 了解自动更新功能
- [开始使用](./user/START_HERE.md) - 详细的使用指南

### 💻 开发文档

#### 性能优化
- [应用扫描优化](./development/APP_SCAN_OPTIMIZATION.md) - 缓存方案实施（v3.2.4）
- [后台扫描实施](./development/BACKGROUND_SCAN_IMPLEMENTATION.md) - 后台扫描功能（v3.3.0）
- [增量更新实施](./development/INCREMENTAL_UPDATE_IMPLEMENTATION.md) - 注册表监听（v3.4.0）

#### 技术分析
- [WASM 方案分析](./development/WASM_ANALYSIS.md) - 为什么不用 WASM
- [缓存实施指南](./development/CACHE_IMPLEMENTATION_GUIDE.md) - 缓存机制详解
- [增量更新计划](./development/INCREMENTAL_UPDATE_PLAN.md) - v3.4.0 规划文档

### 📦 版本发布

#### v3.4.0（最新）
- [发布说明](./releases/v3.4.0/RELEASE_NOTES.md) - 增量更新功能

#### v3.3.0
- [发布说明](./releases/v3.3.0/RELEASE_NOTES.md) - 后台扫描功能
- [完成报告](./releases/v3.3.0/COMPLETE.md)

#### v3.2.4
- [Hotfix 说明](./releases/v3.2.4/HOTFIX.md) - 修复启动问题
- [发布说明](./releases/v3.2.4/RELEASE_NOTES.md)
- [完成报告](./releases/v3.2.4/COMPLETE.md)

#### 历史版本
- [查看归档](./archive/) - v3.0 - v3.2.3 的文档

---

## 🚀 快速链接

### 新用户
1. [快速开始](./user/QUICK_START.md) - 5 分钟上手
2. [自动更新指南](./user/AUTO_UPDATE_GUIDE.md) - 了解更新机制

### 开发者
1. [性能优化历程](./development/APP_SCAN_OPTIMIZATION.md) - 从 8-12s 到 < 100ms
2. [技术决策](./development/WASM_ANALYSIS.md) - 为什么选择缓存而不是 WASM

### 贡献者
1. [开发文档](./development/) - 所有技术文档
2. [版本发布](./releases/) - 发布流程和说明

---

## 📊 性能演进

| 版本 | 首次打开 | 检测延迟 | 更新时间 | 核心特性 |
|------|----------|----------|----------|----------|
| v3.2.4 | 8-12s | 24h | 8-12s | 缓存方案 |
| v3.3.0 | < 100ms | 1h | 8-12s | 后台扫描 |
| v3.4.0 | < 100ms | < 5s | < 1s | 增量更新 |

**总提升**: 
- 首次打开：99% 提升
- 检测延迟：99.99% 提升
- 更新时间：90% 提升

---

## 🔗 相关链接

- [主项目 README](../README.md)
- [更新日志](../CHANGELOG.md)
- [GitHub 仓库](https://github.com/tanzanite2025/TidyDesk)
- [问题反馈](https://github.com/tanzanite2025/TidyDesk/issues)

---

## 📝 文档规范

### 文档命名
- 用户文档：大写 + 下划线（如 `QUICK_START.md`）
- 开发文档：大写 + 下划线（如 `IMPLEMENTATION_GUIDE.md`）
- 版本文档：按版本号组织（如 `v3.4.0/RELEASE_NOTES.md`）

### 文档结构
```
docs/
├── README.md              # 本文件
├── user/                  # 用户文档
├── development/           # 开发文档
├── releases/              # 版本发布文档
└── archive/               # 历史文档归档
```

### 临时文档
临时文档（如 `*_TEMP.md`, `*_DRAFT.md`）不应提交到 Git，已在 `.gitignore` 中排除。

---

**最后更新**: 2026-05-24  
**文档版本**: v3.4.0
