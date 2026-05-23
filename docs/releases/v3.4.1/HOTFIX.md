# TidyDesk v3.4.1 Hotfix

**发布日期**: 2026-05-24  
**发布类型**: Hotfix（紧急修复）  
**优先级**: 高

---

## 🐛 修复的问题

### 截图贴纸置顶问题

**问题描述**:
- 截图贴纸窗口一直置顶在所有窗口之上
- 无法切换到其他应用
- 贴纸挡住所有窗口，严重影响使用

**影响范围**:
- v3.4.0 及之前的所有版本
- 所有使用截图贴纸功能的用户

**修复方案**:
1. 新贴纸默认不置顶
2. 降低置顶级别从 `floating` 到 `normal`
3. 提供修复脚本更新现有贴纸配置

---

## ✅ 修复内容

### 1. 默认行为调整

**修改前**:
```javascript
alwaysOnTop: true  // 默认置顶
```

**修改后**:
```javascript
alwaysOnTop: false  // 默认不置顶
```

**效果**:
- 新创建的贴纸不会挡住其他窗口
- 用户可以正常切换应用
- 需要置顶时可以手动点击置顶按钮

### 2. 置顶级别调整

**修改前**:
```javascript
win.setAlwaysOnTop(true, 'floating')  // floating 级别
```

**修改后**:
```javascript
win.setAlwaysOnTop(true, 'normal')  // normal 级别
```

**效果**:
- 置顶时只在应用内置顶
- 不会挡住其他应用的窗口
- 可以正常切换到其他应用

### 3. 现有贴纸修复

提供修复脚本 `fix-existing-stickers.cjs`:
- 自动备份原配置
- 将所有贴纸的 `alwaysOnTop` 设置为 `false`
- 重启应用后生效

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

在 `electron/services/stickers.cjs` 中添加详细日志：
- `startScreenshot()` - 启动截图
- `createSnipWindow()` - 创建截图窗口
- `captureSelection()` - 捕获截图（包含所有关键步骤）

### 2. 诊断工具

创建 `diagnose-screenshot.cjs` 诊断脚本：
- 检查关键文件是否存在
- 检查函数是否正确定义
- 检查 API 是否正确暴露
- 检查 IPC 处理器是否注册
- 检查存储目录结构

### 3. 文档完善

创建详细的故障排查文档：
- `docs/development/SCREENSHOT_TROUBLESHOOTING.md` - 故障排查指南
- `docs/development/STICKER_ALWAYSONTOP_FIX.md` - 置顶问题修复文档

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
2. 运行修复脚本：
   ```bash
   node fix-existing-stickers.cjs
   ```
3. 重启 TidyDesk

---

## 🧪 测试验证

### 测试步骤

1. **测试新贴纸**
   - 创建新的截图贴纸
   - 验证贴纸默认不置顶 ✅
   - 可以点击贴纸后面的窗口 ✅
   - 可以正常切换应用 ✅

2. **测试置顶功能**
   - 点击贴纸右上角的置顶按钮
   - 验证贴纸置顶（在应用内）✅
   - 切换到其他应用，验证不会被挡住 ✅
   - 再次点击取消置顶 ✅

3. **测试现有贴纸**
   - 运行修复脚本
   - 重启应用
   - 验证现有贴纸不再置顶 ✅

---

## 📝 修改的文件

### 核心修复
- `electron/services/stickers.cjs` - 修复置顶逻辑

### 工具脚本
- `fix-existing-stickers.cjs` - 修复现有贴纸配置
- `diagnose-screenshot.cjs` - 诊断脚本

### 文档
- `CHANGELOG.md` - 更新日志
- `docs/development/SCREENSHOT_TROUBLESHOOTING.md` - 故障排查指南
- `docs/development/STICKER_ALWAYSONTOP_FIX.md` - 修复文档
- `docs/releases/v3.4.1/HOTFIX.md` - 本文档

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
**优先级**: 高
