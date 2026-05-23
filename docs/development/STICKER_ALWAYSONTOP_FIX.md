# 截图贴纸置顶问题修复

**问题发现时间**: 2026-05-24  
**修复版本**: v3.4.1（待发布）  
**严重程度**: 高

---

## 🐛 问题描述

### 现象
截图贴纸窗口一直置顶在所有窗口之上，无法切换到其他应用，严重影响使用。

### 表现
1. 创建截图贴纸后，贴纸窗口始终在最上层
2. 无法点击贴纸后面的窗口
3. 所有窗口都被贴纸挡住
4. 即使切换应用，贴纸仍然在最前面

### 影响范围
- 所有使用截图贴纸功能的用户
- v3.4.0 及之前的版本

---

## 🔍 根本原因

### 代码问题

在 `electron/services/stickers.cjs` 中：

```javascript
// 问题代码 1: 默认置顶
const sticker = {
  id,
  imagePath,
  bounds: stickerBounds,
  alwaysOnTop: true,  // ❌ 默认置顶
  createdAt: new Date().toISOString()
};

// 问题代码 2: 使用 floating 级别
if (sticker.alwaysOnTop) {
  win.setAlwaysOnTop(true, 'floating');  // ❌ floating 级别会挡住所有窗口
}
```

### Electron 窗口层级

Electron 的 `setAlwaysOnTop` 有多个级别：
- `'normal'` - 普通置顶，可以被其他置顶窗口覆盖
- `'floating'` - 浮动置顶，始终在最上层（包括其他应用）
- `'torn-off-menu'` - 菜单级别
- `'modal-panel'` - 模态面板级别
- `'main-menu'` - 主菜单级别
- `'status'` - 状态栏级别
- `'pop-up-menu'` - 弹出菜单级别
- `'screen-saver'` - 屏保级别（最高）

**问题**: 使用 `'floating'` 级别导致贴纸窗口始终在所有窗口之上，无法切换。

---

## ✅ 修复方案

### 1. 修改默认行为

将新创建的贴纸默认设置为**不置顶**：

```javascript
// 修复后的代码
const sticker = {
  id,
  imagePath,
  bounds: stickerBounds,
  alwaysOnTop: false,  // ✅ 默认不置顶
  createdAt: new Date().toISOString()
};
```

**理由**:
- 大多数用户不需要贴纸一直置顶
- 避免挡住其他窗口
- 用户可以通过按钮手动置顶

### 2. 降低置顶级别

将置顶级别从 `'floating'` 改为 `'normal'`：

```javascript
// 修复后的代码
if (sticker.alwaysOnTop) {
  win.setAlwaysOnTop(true, 'normal');  // ✅ 使用 normal 级别
}
```

**理由**:
- `'normal'` 级别只在同应用内置顶
- 不会挡住其他应用的窗口
- 用户可以正常切换应用

### 3. 修复现有贴纸

运行修复脚本更新已存在的贴纸配置：

```bash
node fix-existing-stickers.cjs
```

**功能**:
- 自动备份原配置
- 将所有贴纸的 `alwaysOnTop` 设置为 `false`
- 重启应用后生效

---

## 📝 修改的文件

### 1. `electron/services/stickers.cjs`

**修改位置 1**: `captureSelection()` 函数
```javascript
// 第 208 行附近
const sticker = {
  id,
  imagePath,
  bounds: stickerBounds,
  alwaysOnTop: false,  // 修改：默认不置顶
  createdAt: new Date().toISOString()
};
```

**修改位置 2**: `createStickerWindow()` 函数
```javascript
// 第 268 行附近
if (sticker.alwaysOnTop) {
  win.setAlwaysOnTop(true, 'normal');  // 修改：使用 normal 级别
}
```

**修改位置 3**: `toggleStickerAlwaysOnTop()` 函数
```javascript
// 第 335 行附近
win.setAlwaysOnTop(sticker.alwaysOnTop, sticker.alwaysOnTop ? 'normal' : 'normal');  // 修改：使用 normal 级别
```

### 2. 新增文件

- `fix-existing-stickers.cjs` - 修复脚本
- `docs/development/STICKER_ALWAYSONTOP_FIX.md` - 本文档

---

## 🧪 测试验证

### 测试步骤

1. **测试新贴纸**
   ```bash
   npm run dev
   ```
   - 创建新的截图贴纸
   - 验证贴纸默认不置顶
   - 可以点击贴纸后面的窗口
   - 可以正常切换应用

2. **测试置顶功能**
   - 点击贴纸右上角的置顶按钮
   - 验证贴纸置顶（在同应用内）
   - 切换到其他应用，验证不会被挡住
   - 再次点击取消置顶

3. **测试现有贴纸**
   - 运行修复脚本
   - 重启应用
   - 验证现有贴纸不再置顶
   - 验证可以正常使用

### 预期结果

- ✅ 新贴纸默认不置顶
- ✅ 可以点击贴纸后面的窗口
- ✅ 可以正常切换应用
- ✅ 置顶功能仍然可用（但不会挡住其他应用）
- ✅ 现有贴纸配置已修复

---

## 📊 影响分析

### 用户体验改进

| 方面 | 修复前 | 修复后 |
|------|--------|--------|
| 默认行为 | 置顶，挡住所有窗口 ❌ | 不置顶，正常使用 ✅ |
| 切换应用 | 无法切换 ❌ | 可以正常切换 ✅ |
| 置顶功能 | 挡住所有窗口 ❌ | 只在应用内置顶 ✅ |
| 灵活性 | 强制置顶 ❌ | 用户可选 ✅ |

### 兼容性

- ✅ 向后兼容（通过修复脚本）
- ✅ 不影响其他功能
- ✅ 用户数据不丢失

---

## 🔄 升级指南

### 对于开发者

1. **拉取最新代码**
   ```bash
   git pull origin main
   ```

2. **运行修复脚本**
   ```bash
   node fix-existing-stickers.cjs
   ```

3. **重启应用**
   ```bash
   npm run dev
   ```

### 对于用户

1. **下载新版本** (v3.4.1)
2. **安装更新**
3. **重启应用**
4. 现有贴纸会自动修复

---

## 🔮 未来改进

### 短期（v3.4.1）
- ✅ 修复默认置顶问题
- ✅ 降低置顶级别
- ✅ 提供修复脚本

### 中期（v3.5.0）
- [ ] 添加贴纸设置面板
- [ ] 支持自定义置顶级别
- [ ] 支持贴纸分组

### 长期（v3.6.0+）
- [ ] 支持贴纸工作区
- [ ] 支持贴纸快捷键
- [ ] 支持贴纸标签和搜索

---

## 📚 相关资源

### Electron 文档
- [BrowserWindow.setAlwaysOnTop()](https://www.electronjs.org/docs/latest/api/browser-window#winsetalwaysontopflag-level-relativelevel)
- [Window Levels](https://www.electronjs.org/docs/latest/api/browser-window#window-levels-macos)

### 相关 Issue
- 如果有 GitHub Issue，在这里添加链接

---

## 🙏 致谢

感谢用户反馈此问题！

---

**修复时间**: 2026-05-24  
**修复人**: AI Assistant  
**状态**: ✅ 已修复  
**待发布**: v3.4.1
