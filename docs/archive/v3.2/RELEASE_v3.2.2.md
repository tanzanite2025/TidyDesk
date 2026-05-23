# TidyDesk v3.2.2 发布说明

**发布日期**: 2026-05-24  
**版本类型**: 补丁版本（Patch）  
**重点**: 稳定性修复和基础设施完善

---

## 📋 版本概述

v3.2.2 是一个重要的稳定性更新版本，修复了文件监控资源泄漏问题，并添加了完整的日志系统和错误处理机制，为长期稳定运行打下坚实基础。

---

## 🐛 关键修复

### 文件监控资源泄漏 🔴 高优先级

**问题描述**:
- 文件监控 Map 可能无限增长
- 已删除的文件路径不会被清理
- 长时间运行可能导致内存泄漏

**修复方案**:
- 添加定期清理机制（每小时）
- 自动清理无效的监控项
- 记录清理统计信息

**代码示例**:
```javascript
// 每小时自动清理
setInterval(() => {
  cleanupFileWatcher();
}, 60 * 60 * 1000);

function cleanupFileWatcher() {
  let cleaned = 0;
  for (const [targetPath, shortcuts] of watchedTargets.entries()) {
    if (shortcuts.size === 0 || !fs.existsSync(targetPath)) {
      watchedTargets.delete(targetPath);
      fileWatcher.unwatch(targetPath);
      cleaned++;
    }
  }
  console.log(`Cleaned ${cleaned} invalid watch targets`);
}
```

**预期效果**:
- ✅ 内存使用稳定
- ✅ 长时间运行无泄漏
- ✅ 自动资源管理

---

## ✨ 新增功能

### 1. 完整的日志系统

**功能特性**:
- 使用 electron-log 库
- 自动日志文件轮转（最大 10MB）
- 多级别日志（debug, info, warn, error）
- 详细的启动信息记录

**日志文件位置**:
```
Windows: %APPDATA%\TidyDesk\logs\tidydesk.log
```

**日志格式**:
```
[2026-05-24 10:30:45.123] [info] TidyDesk Logger Initialized
[2026-05-24 10:30:45.124] [info] Version: 3.2.2
[2026-05-24 10:30:45.125] [info] Platform: win32
```

**使用方法**:
```javascript
const logger = require('./utils/logger.cjs');

logger.info('Application started');
logger.warn('Warning message');
logger.error('Error occurred', error);
```

**优势**:
- ✅ 便于调试用户问题
- ✅ 自动日志管理
- ✅ 详细的运行记录
- ✅ 支持日志导出（未来版本）

### 2. 统一的错误处理机制

**功能特性**:
- 自定义 TidyDeskError 错误类
- 错误代码和消息映射
- 自动错误日志记录
- 用户友好的错误提示

**错误代码定义**:
```javascript
const ErrorCodes = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  DRAWER_CREATE_FAILED: 'DRAWER_CREATE_FAILED',
  IMPORT_FAILED: 'IMPORT_FAILED',
  // ... 更多
};
```

**使用示例**:
```javascript
const { createError, handleError } = require('./utils/error-handler.cjs');

try {
  // 操作
} catch (err) {
  handleError(
    createError('IMPORT_FAILED', '导入文件失败', { filePath }),
    'import-files',
    { showDialog: true }
  );
}
```

**优势**:
- ✅ 统一的错误处理
- ✅ 用户友好的提示
- ✅ 详细的错误日志
- ✅ 便于错误追踪

---

## 🔧 技术改进

### 配置文件重命名

**问题**: `config.js` 在打包后被当作 ES Module 导致错误

**修复**: 重命名为 `config.cjs`，明确使用 CommonJS

**影响**:
- ✅ 修复模块加载错误
- ✅ 避免打包问题
- ✅ 更清晰的模块类型

---

## 📊 稳定性提升

### 改进前（v3.2.1）

| 指标 | 状态 |
|------|------|
| 长时间运行 | ⚠️ 可能内存泄漏 |
| 错误处理 | ⚠️ 不够完善 |
| 日志记录 | ❌ 只有 console.log |
| 问题调试 | ❌ 困难 |

### 改进后（v3.2.2）

| 指标 | 状态 |
|------|------|
| 长时间运行 | ✅ 稳定，自动清理 |
| 错误处理 | ✅ 统一、完善 |
| 日志记录 | ✅ 完整的日志系统 |
| 问题调试 | ✅ 容易，有详细日志 |

---

## 🚀 升级指南

### 自动更新（推荐）

1. 启动 TidyDesk v3.2.1
2. 应用自动检测到 v3.2.2
3. 点击"下载更新"
4. 下载完成后点击"安装并重启"

### 手动更新

1. 从 [GitHub Releases](https://github.com/tanzanite2025/TidyDesk/releases/tag/v3.2.2) 下载
2. 运行安装程序
3. 自动覆盖旧版本

---

## 📝 使用说明

### 查看日志文件

**Windows**:
1. 按 `Win + R`
2. 输入 `%APPDATA%\TidyDesk\logs`
3. 打开 `tidydesk.log`

**日志内容**:
- 应用启动和关闭
- 文件操作记录
- 错误和警告
- 性能统计

### 日志文件管理

- **自动轮转**: 超过 10MB 自动创建新文件
- **保留策略**: 保留最近的日志文件
- **手动清理**: 可以安全删除旧日志

---

## 🔗 相关链接

- [GitHub 仓库](https://github.com/tanzanite2025/TidyDesk)
- [v3.2.2 Release](https://github.com/tanzanite2025/TidyDesk/releases/tag/v3.2.2)
- [问题反馈](https://github.com/tanzanite2025/TidyDesk/issues)
- [完整更新日志](./CHANGELOG.md)
- [全面复查与规划](./COMPREHENSIVE_REVIEW_AND_ROADMAP.md)

---

## 📈 版本对比

| 功能 | v3.2.1 | v3.2.2 |
|------|--------|--------|
| 文件监控清理 | ❌ | ✅ 每小时自动 |
| 日志系统 | ❌ | ✅ 完整支持 |
| 错误处理 | 基础 | ✅ 统一完善 |
| 长期稳定性 | 一般 | ✅ 优秀 |
| 问题调试 | 困难 | ✅ 容易 |

---

## 🎯 下一步计划

### v3.3.0（计划中）
- 配置文件验证
- 托盘图标备选方案
- 性能监控面板
- 更多稳定性改进

### v3.4.0（计划中）
- 主题系统（浅色/深色/自动）
- 主题配置持久化
- 主题切换动画

---

## 🎉 总结

v3.2.2 是一个重要的稳定性更新：

- ✅ 修复内存泄漏问题
- ✅ 添加完整日志系统
- ✅ 统一错误处理机制
- ✅ 为长期运行打下基础

**现在 TidyDesk 可以更稳定地 7x24 小时运行！** 🚀

---

**TidyDesk 团队**  
2026-05-24
