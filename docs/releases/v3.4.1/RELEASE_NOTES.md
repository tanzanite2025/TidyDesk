# TidyDesk v3.4.1 发布说明

**发布日期**: 2026-05-24  
**发布类型**: Hotfix（紧急修复）  
**优先级**: 高

---

## 🐛 修复的问题

### 截图贴纸置顶问题

**严重程度**: 高  
**影响范围**: v3.4.0 及之前的所有版本

**问题描述**:
- 截图贴纸窗口一直置顶在所有窗口之上
- 无法切换到其他应用
- 贴纸挡住所有窗口，严重影响使用

**修复内容**:
1. ✅ 新贴纸默认不置顶
2. ✅ 降低置顶级别从 `floating` 到 `normal`
3. ✅ 提供修复脚本更新现有贴纸配置

---

## 📊 修复效果对比

| 方面 | v3.4.0 | v3.4.1 |
|------|--------|--------|
| 默认行为 | 置顶，挡住所有窗口 ❌ | 不置顶，正常使用 ✅ |
| 切换应用 | 无法切换 ❌ | 可以正常切换 ✅ |
| 置顶功能 | 挡住所有窗口 ❌ | 只在应用内置顶 ✅ |
| 用户体验 | 严重影响 ❌ | 正常使用 ✅ |

---

## 🔧 技术改进

### 1. 调试日志

在截图服务中添加详细日志：
- 启动截图时的日志
- 创建截图窗口的日志
- 捕获截图的完整流程日志

### 2. 诊断工具

新增诊断脚本：
- `diagnose-screenshot.cjs` - 截图功能诊断
- `diagnose-ui.cjs` - UI 问题诊断
- `fix-existing-stickers.cjs` - 修复现有贴纸配置

### 3. 文档完善

新增详细文档：
- 截图功能故障排查指南
- 置顶问题修复文档
- UI 问题诊断指南

---

## 📦 升级说明

### 自动升级（推荐）

1. 应用会自动检测到新版本
2. 点击"下载更新"
3. 下载完成后点击"安装更新"
4. 应用会自动重启并应用修复

### 手动升级

1. 下载 `TidyDesk-3.4.1-Setup.exe`
2. 运行安装程序（会自动覆盖旧版本）
3. 重启应用

### 现有贴纸修复

如果升级后现有贴纸仍然置顶：

1. 关闭 TidyDesk
2. 在项目目录运行：
   ```bash
   node fix-existing-stickers.cjs
   ```
3. 重启 TidyDesk

---

## 🧪 测试验证

### 测试步骤

1. **测试新贴纸**
   - 按 `Ctrl+Alt+S` 或点击截图按钮
   - 拖选区域创建贴纸
   - 验证贴纸默认不置顶 ✅
   - 可以点击贴纸后面的窗口 ✅
   - 可以正常切换应用 ✅

2. **测试置顶功能**
   - 鼠标悬停在贴纸上
   - 点击右上角的置顶按钮
   - 验证贴纸置顶（在应用内）✅
   - 切换到其他应用，验证不会被挡住 ✅

3. **测试现有贴纸**
   - 运行修复脚本
   - 重启应用
   - 验证现有贴纸不再置顶 ✅

---

## 📝 修改的文件

### 核心修复
- `electron/services/stickers.cjs` - 修复置顶逻辑（3处修改）

### 工具脚本
- `fix-existing-stickers.cjs` - 修复现有贴纸配置（新增）
- `diagnose-screenshot.cjs` - 截图功能诊断（新增）
- `diagnose-ui.cjs` - UI 问题诊断（新增）

### 文档
- `CHANGELOG.md` - 更新日志
- `docs/development/SCREENSHOT_TROUBLESHOOTING.md` - 故障排查指南（新增）
- `docs/development/STICKER_ALWAYSONTOP_FIX.md` - 修复文档（新增）
- `docs/releases/v3.4.1/HOTFIX.md` - Hotfix 文档（新增）
- `docs/releases/v3.4.1/RELEASE_NOTES.md` - 本文档（新增）

### 版本
- `package.json` - 版本号更新到 3.4.1

---

## ⚠️ 注意事项

1. **现有贴纸**: 升级后现有贴纸可能仍然置顶，需要运行修复脚本
2. **置顶功能**: 置顶功能仍然可用，但行为有所改变（只在应用内置顶）
3. **兼容性**: 完全向后兼容，不影响其他功能

---

## 🔗 相关链接

- **GitHub Release**: https://github.com/tanzanite2025/TidyDesk/releases/tag/v3.4.1
- **完整更新日志**: [CHANGELOG.md](../../../CHANGELOG.md)
- **故障排查指南**: [SCREENSHOT_TROUBLESHOOTING.md](../../development/SCREENSHOT_TROUBLESHOOTING.md)
- **修复详情**: [STICKER_ALWAYSONTOP_FIX.md](../../development/STICKER_ALWAYSONTOP_FIX.md)

---

## 🙏 致谢

感谢用户及时反馈此问题，让我们能够快速修复！

---

**发布时间**: 2026-05-24  
**修复时间**: < 2 小时  
**状态**: ✅ 已修复  
**下载地址**: [GitHub Releases](https://github.com/tanzanite2025/TidyDesk/releases/tag/v3.4.1)
