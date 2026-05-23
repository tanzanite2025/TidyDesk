# TidyDesk v3.1.1 发布说明

**发布日期**: 2026-05-24  
**版本类型**: 补丁版本（Patch）  
**重点**: 代码优化和重构

---

## 📋 版本概述

v3.1.1 是一个代码质量优化版本，主要聚焦于代码重构和可维护性提升。本次更新将所有硬编码的配置项集中管理，为后续功能扩展打下良好基础。

---

## ✨ 主要改进

### 🔧 配置集中化

创建了统一的配置文件 `electron/config.js`，将所有魔法数字和配置项集中管理：

#### 文件扫描配置
- 最大递归深度: 3 层
- 跳过目录列表（Accessories、Administrative Tools 等）

#### 文件大小限制
- 警告阈值: 1GB
- 拒绝阈值: 5GB
- 批量操作最大文件数: 100

#### 验证配置
- 定期验证间隔: 30 分钟
- 动画时长: 250ms

#### 缓存配置
- 应用扫描缓存时间: 1 小时
- 图标缓存数量: 100

#### 窗口配置
- 手柄尺寸: 56x172
- 抽屉宽度比例: 30%
- 抽屉最小/最大宽度: 360px / 560px
- 圆角半径: 32px（Windows 11）

#### 系统保护
- 系统路径列表（Windows、Program Files 等）
- 应用分类关键词
- 过滤关键词

---

## 🔄 代码重构

### 替换的硬编码值

**main.cjs 中的改进**:
- ✅ 递归深度限制: `3` → `CONFIG.SCAN.MAX_RECURSION_DEPTH`
- ✅ 跳过目录列表: 硬编码数组 → `CONFIG.SCAN.SKIP_DIRECTORIES`
- ✅ 验证间隔: `30 * 60 * 1000` → `CONFIG.VALIDATION.INTERVAL`
- ✅ 动画时长: `250` → `CONFIG.VALIDATION.ANIMATION_DURATION`
- ✅ 手柄尺寸: `56, 172` → `CONFIG.WINDOW.HANDLE_WIDTH/HEIGHT`
- ✅ 抽屉尺寸: `360, 560, 0.3` → `CONFIG.WINDOW.DRAWER_*`
- ✅ 圆角半径: `32` → `CONFIG.WINDOW.CORNER_RADIUS`
- ✅ 窗口最小尺寸: `48, 120` → `CONFIG.WINDOW.MIN_WIDTH/HEIGHT`
- ✅ 系统路径: 硬编码数组 → `CONFIG.SYSTEM_PATHS`

### 代码清理

**删除的文件**:
- `src/components/TidyWizard.tsx` - 未使用的组件
- `cleanup.ps1` - 过时的清理脚本
- `server.js` - Vite 已内置开发服务器

**归档的文档**:
- 19 个历史文档移至 `docs/archive/`
- 保持项目根目录整洁

---

## 📊 技术细节

### 配置文件结构

```javascript
module.exports = {
  SCAN: { /* 扫描配置 */ },
  FILE: { /* 文件限制 */ },
  VALIDATION: { /* 验证配置 */ },
  CACHE: { /* 缓存配置 */ },
  WINDOW: { /* 窗口配置 */ },
  SYSTEM_PATHS: [ /* 系统路径 */ ],
  SEARCH_PATHS: { /* 搜索位置 */ },
  APP_CATEGORIES: { /* 应用分类 */ },
  FILTER_KEYWORDS: { /* 过滤关键词 */ },
  LOG: { /* 日志配置 */ }
};
```

### 优势

1. **可维护性** ⬆️
   - 所有配置集中在一个文件
   - 修改配置无需搜索整个代码库
   - 减少出错可能性

2. **可读性** ⬆️
   - 语义化的常量名称
   - 清晰的配置分类
   - 详细的注释说明

3. **可扩展性** ⬆️
   - 新增配置项更容易
   - 支持环境变量覆盖
   - 便于添加配置验证

4. **可测试性** ⬆️
   - 配置可以独立测试
   - 便于模拟不同配置场景
   - 减少测试复杂度

---

## 🔍 代码质量

### 改进前
```javascript
// 硬编码，难以维护
if (depth > 3) return;
const targetWidth = Math.max(360, Math.min(Math.round(logicalWidth * 0.3), 560));
const VALIDATION_INTERVAL = 30 * 60 * 1000;
```

### 改进后
```javascript
// 语义化，易于理解
if (depth > CONFIG.SCAN.MAX_RECURSION_DEPTH) return;
const targetWidth = Math.max(
  CONFIG.WINDOW.DRAWER_MIN_WIDTH, 
  Math.min(Math.round(logicalWidth * CONFIG.WINDOW.DRAWER_WIDTH_RATIO), 
  CONFIG.WINDOW.DRAWER_MAX_WIDTH)
);
validationInterval = setInterval(async () => {
  // ...
}, CONFIG.VALIDATION.INTERVAL);
```

---

## 📦 版本信息

- **版本号**: 3.1.1
- **发布类型**: 补丁版本
- **兼容性**: 完全向后兼容 v3.0.x
- **升级建议**: 推荐所有用户升级

---

## 🚀 升级指南

### 自动更新（推荐）

1. 启动 TidyDesk
2. 应用会自动检测到新版本
3. 点击"下载更新"
4. 下载完成后点击"安装并重启"

### 手动更新

1. 从 [GitHub Releases](https://github.com/tanzanite2025/TidyDesk/releases) 下载最新版本
2. 运行安装程序
3. 安装程序会自动覆盖旧版本

---

## 🔗 相关链接

- [GitHub 仓库](https://github.com/tanzanite2025/TidyDesk)
- [问题反馈](https://github.com/tanzanite2025/TidyDesk/issues)
- [完整更新日志](./CHANGELOG.md)

---

## 👨‍💻 开发者说明

### 配置文件使用

```javascript
// 在 main.cjs 中导入
const CONFIG = require('./config');

// 使用配置
if (depth > CONFIG.SCAN.MAX_RECURSION_DEPTH) {
  return;
}

// 访问嵌套配置
const width = CONFIG.WINDOW.HANDLE_WIDTH;
const interval = CONFIG.VALIDATION.INTERVAL;
```

### 添加新配置

1. 在 `electron/config.js` 中添加配置项
2. 在 `main.cjs` 中使用 `CONFIG.*` 访问
3. 更新相关文档

---

## 📝 下一步计划

v3.1.1 为后续功能开发打下了良好基础，接下来计划：

- v3.2.0: 主题系统（浅色/深色/自动）
- v3.3.0: 文件搜索功能
- v3.4.0: 云同步功能
- v4.0.0: 重大架构升级

---

## 🙏 致谢

感谢所有用户的支持和反馈！

如有问题或建议，欢迎在 [GitHub Issues](https://github.com/tanzanite2025/TidyDesk/issues) 中提出。

---

**TidyDesk 团队**  
2026-05-24
