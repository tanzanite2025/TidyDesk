# 截屏功能修复 - 快速测试指南

**目的**: 验证截屏功能全屏黑色问题是否已修复  
**预计时间**: 5-10 分钟  
**日期**: 2026-05-24

---

## 🚀 快速测试（3 步）

### 步骤 1: 运行诊断工具（2 分钟）

```bash
# 进入项目目录
cd c:\Users\P16V\Desktop\个人开发\TidyDesk

# 运行诊断脚本
electron diagnose-screenshot.cjs
```

**观察**:
- 应该打开 3 个测试窗口
- 每个窗口应该显示半透明黑色覆盖层
- 你应该能看到桌面内容（图标、壁纸等）

**结果判断**:
- ✅ **如果能看到桌面**: 系统支持透明窗口，继续步骤 2
- ❌ **如果全黑**: 系统级别问题，跳转到"系统级别修复"部分

**关闭测试窗口**: 按 `Esc` 键

---

### 步骤 2: 测试实际应用（3 分钟）

```bash
# 启动应用（确保 Vite 和 Electron 都运行）
npm run desktop
```

**等待应用启动**:
- 应该看到手柄窗口
- 控制台应该显示 Vite 和 Electron 的启动日志

**点击截屏按钮**:
1. 点击手柄上的截屏按钮（或使用快捷键）
2. 观察屏幕

**预期结果**:
- ✅ 显示半透明黑色覆盖层（可以看到桌面）
- ✅ 显示提示文字"拖选截图区域，Esc 取消"
- ✅ 鼠标变成十字光标

**如果看到全黑**:
- 按 `Ctrl+Shift+I` 打开 DevTools
- 查看 Console 是否有错误
- 继续步骤 3（调试）

---

### 步骤 3: 功能测试（2 分钟）

**在半透明覆盖层上**:
1. 按住鼠标左键
2. 拖动选择一个区域
3. 松开鼠标

**预期结果**:
- ✅ 拖动时显示选区边框（天蓝色）
- ✅ 显示选区尺寸（如 "300 x 200"）
- ✅ 松开后创建截图贴纸窗口
- ✅ 贴纸窗口显示截取的内容

**测试取消功能**:
1. 再次点击截屏按钮
2. 按 `Esc` 键
3. 覆盖层应该关闭

---

## 🔍 调试步骤（如果测试失败）

### 检查控制台日志

**主进程（启动应用的终端）**:

应该看到:
```
[STICKER] startScreenshot called
[STICKER] createSnipWindow called
[STICKER] Display info: { id: ..., bounds: { x: 0, y: 0, width: 1920, height: 1080 }, ... }
[STICKER] Snip window created
[STICKER] Window properties: { opacity: 1, backgroundColor: '#00000000', bounds: { ... } }
[STICKER] Snip window renderer loaded
[STICKER] Snip window content loaded
```

**如果看到错误**:
- `ERR_CONNECTION_REFUSED`: Vite 未运行，使用 `npm run desktop`
- `did-fail-load`: 页面加载失败，检查 Vite 是否正常运行

**渲染进程（DevTools Console）**:

1. 截屏窗口打开后，按 `Ctrl+Shift+I`
2. 切换到 Console 标签

应该看到:
```
[SNIP] SnipOverlayApp mounted
[SNIP] Window size: 1920 x 1080
[SNIP] Device pixel ratio: 1
[SNIP] Root element background: rgba(0, 0, 0, 0.18)
```

**如果背景色不是 `rgba(0, 0, 0, 0.18)`**:
- 说明样式未正确应用
- 继续检查计算样式

### 检查计算样式

**在 DevTools 中**:
1. 切换到 Elements 标签
2. 选择根 div 元素（class="snip-overlay-root ..."）
3. 切换到 Computed 标签
4. 搜索 `background-color`

**应该显示**:
```
background-color: rgba(0, 0, 0, 0.18)
```

**如果显示其他值**:
- `rgb(0, 0, 0)` 或 `rgba(0, 0, 0, 1)`: 完全不透明，样式未应用
- `transparent`: 完全透明，需要修改

### 检查 DOM 结构

**在 DevTools Elements 标签中**:

应该看到:
```html
<div class="snip-overlay-root relative h-screen w-screen cursor-crosshair select-none overflow-hidden text-white" style="background-color: rgba(0, 0, 0, 0.18);">
  <div class="pointer-events-none absolute left-1/2 top-7 ...">
    拖选截图区域，Esc 取消
  </div>
</div>
```

**检查项**:
- ✅ `style` 属性存在
- ✅ `background-color: rgba(0, 0, 0, 0.18)` 正确
- ✅ 提示文字存在

---

## 🛠️ 常见问题和解决方案

### 问题 1: 诊断工具的测试窗口也是全黑

**原因**: 系统级别的透明窗口问题

**解决方案**:

1. **检查 Windows 透明效果**:
   - 打开"设置" → "个性化" → "颜色"
   - 确保"透明效果"已启用

2. **检查 Windows Aero**:
   - 按 `Win+R`，输入 `services.msc`
   - 找到"Desktop Window Manager Session Manager"
   - 确保状态为"正在运行"

3. **更新显卡驱动**:
   - 打开"设备管理器"
   - 展开"显示适配器"
   - 右键点击显卡 → "更新驱动程序"

4. **重启电脑**:
   - 有时 DWM 需要重启才能正常工作

### 问题 2: 应用启动后显示 ERR_CONNECTION_REFUSED

**原因**: Vite 开发服务器未运行

**解决方案**:
```bash
# 使用正确的启动命令（同时启动 Vite 和 Electron）
npm run desktop

# 或者分别启动
# 终端 1
npm run dev

# 终端 2
npm run electron
```

### 问题 3: 覆盖层显示但是完全不透明（看不到桌面）

**原因**: 透明度值未正确应用

**临时测试**:

1. 打开 DevTools Console
2. 运行以下代码:
```javascript
document.querySelector('.snip-overlay-root').style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
```
3. 如果现在能看到桌面，说明样式应用有问题

**解决方案**: 尝试备选方案 A（见下文）

### 问题 4: 可以看到桌面但是无法拖选

**原因**: 鼠标事件被阻止

**检查**:
1. 打开 DevTools Elements
2. 检查根 div 的 CSS
3. 确保没有 `pointer-events: none`

**解决方案**:
```javascript
// 在 DevTools Console 中运行
document.querySelector('.snip-overlay-root').style.pointerEvents = 'auto';
```

---

## 🔄 备选方案

### 方案 A: 使用 ARGB 背景色

**如果当前修复不工作，尝试此方案**

**修改文件**: `electron/services/stickers.cjs`

**找到**:
```javascript
snipWindow = new BrowserWindow({
  // ...
  backgroundColor: '#00000000',
  // ...
});
```

**修改为**:
```javascript
snipWindow = new BrowserWindow({
  // ...
  backgroundColor: '#2E000000',  // ARGB: 2E = 18% opacity
  // ...
});
```

**同时修改**: `src/modules/stickers/SnipOverlayApp.tsx`

**找到**:
```tsx
<div
  className="..."
  style={{ backgroundColor: 'rgba(0, 0, 0, 0.18)' }}
>
```

**修改为**:
```tsx
<div
  className="..."
  style={{ backgroundColor: 'transparent' }}
>
```

**重启应用测试**:
```bash
npm run desktop
```

### 方案 B: 调整透明度值

**如果覆盖层太暗或太亮**

**修改**: `src/modules/stickers/SnipOverlayApp.tsx`

```tsx
// 更明显的覆盖层（50% 不透明度）
style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}

// 更淡的覆盖层（10% 不透明度）
style={{ backgroundColor: 'rgba(0, 0, 0, 0.1)' }}
```

---

## ✅ 成功标准

### 功能正常的标志

- ✅ 点击截屏按钮后，显示半透明黑色覆盖层
- ✅ 可以清晰看到桌面内容（图标、壁纸、窗口等）
- ✅ 显示提示文字"拖选截图区域，Esc 取消"
- ✅ 鼠标变成十字光标
- ✅ 可以拖选区域，显示选区边框和尺寸
- ✅ 松开鼠标后成功创建截图贴纸
- ✅ 按 Esc 可以取消截图

### 性能正常的标志

- ✅ 窗口打开速度快（< 200ms）
- ✅ 鼠标移动流畅，无延迟
- ✅ 截图生成速度快（< 500ms）

---

## 📊 测试结果记录

### 测试环境

- **操作系统**: Windows ___
- **屏幕分辨率**: _______
- **DPI 缩放**: ____%
- **显卡**: _______
- **Electron 版本**: _______

### 测试结果

**诊断工具测试**:
- [ ] 测试窗口 1: ✅ 正常 / ❌ 全黑
- [ ] 测试窗口 2: ✅ 正常 / ❌ 全黑
- [ ] 测试窗口 3: ✅ 正常 / ❌ 全黑

**实际应用测试**:
- [ ] 覆盖层显示: ✅ 半透明 / ❌ 全黑 / ❌ 完全透明
- [ ] 拖选功能: ✅ 正常 / ❌ 无法拖选
- [ ] 截图生成: ✅ 成功 / ❌ 失败
- [ ] 取消功能: ✅ 正常 / ❌ 无法取消

**控制台日志**:
- [ ] 主进程日志: ✅ 正常 / ❌ 有错误
- [ ] 渲染进程日志: ✅ 正常 / ❌ 有错误

**计算样式**:
- [ ] background-color: ________________

### 问题和解决方案

**遇到的问题**:
_______________________________________

**使用的解决方案**:
_______________________________________

**最终结果**:
- [ ] ✅ 修复成功
- [ ] ❌ 仍有问题（需要进一步调查）

---

## 📞 需要帮助？

如果测试失败或遇到问题：

1. **收集信息**:
   - 截图（显示问题）
   - 控制台日志（主进程和渲染进程）
   - 系统信息（Windows 版本、显卡等）

2. **查看详细文档**:
   - `docs/development/SCREENSHOT_FIX_IMPLEMENTATION.md` - 完整修复说明
   - `docs/development/SCREENSHOT_TROUBLESHOOTING.md` - 详细诊断步骤

3. **尝试备选方案**:
   - 方案 A: ARGB 背景色
   - 方案 B: 调整透明度值
   - 方案 C: Canvas 渲染（见完整文档）

---

**文档创建时间**: 2026-05-24 22:50  
**预计测试时间**: 5-10 分钟  
**下一步**: 根据测试结果决定是否需要实施备选方案
