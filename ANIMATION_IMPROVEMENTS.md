# TidyDesk 动画改进文档

## 🎬 已实现的动画效果

### 1. 窗口滑动动画（Electron 层）

**位置**: `electron/main.cjs` - `animateWindowBounds()` 函数

**特性**:
- ✅ 平滑的 60fps 动画
- ✅ 支持多种缓动函数（easeInCubic, easeOutCubic, easeInOutCubic）
- ✅ 展开时从屏幕右侧滑入（250ms）
- ✅ 收起时滑出到屏幕右侧（200ms）
- ✅ 手柄窗口同步动画（200ms）

**动画参数**:
```javascript
// 展开动画
duration: 250ms
easing: easeOutCubic (缓出三次方)

// 收起动画
duration: 200ms
easing: easeInCubic (缓入三次方)
```

### 2. 内容淡入动画（CSS 层）

**位置**: `src/index.css` - `@keyframes drawer-panel-in/out`

**特性**:
- ✅ 内容从右侧淡入（24px 位移）
- ✅ 延迟 50ms 启动，与窗口动画错开
- ✅ 收起时淡出效果
- ✅ 使用高级缓动曲线 `cubic-bezier(0.16, 1, 0.3, 1)`

**CSS 动画**:
```css
/* 展开动画 */
.animate-drawer-panel-in {
  animation: drawer-panel-in 250ms cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: 50ms;
}

/* 收起动画 */
.animate-drawer-panel-out {
  animation: drawer-panel-out 200ms cubic-bezier(0.7, 0, 0.84, 0) both;
}
```

### 3. 状态管理（React 层）

**位置**: `src/App.tsx` - `DrawerApp` 组件

**特性**:
- ✅ 新增 `isClosing` 状态控制收起动画
- ✅ 监听 Electron 的 `drawer-state` 事件
- ✅ 收起时先播放动画，200ms 后隐藏窗口
- ✅ 关闭按钮改为收起按钮，保持应用运行

## 🎯 动画时间轴

```
展开抽屉:
0ms    ─── 窗口开始从右侧滑入
50ms   ─── 内容开始淡入
250ms  ─── 窗口滑入完成
300ms  ─── 内容淡入完成

收起抽屉:
0ms    ─── 内容开始淡出 + 窗口开始滑出
200ms  ─── 动画完成，窗口隐藏
```

## 🔧 技术细节

### 缓动函数对比

| 函数 | 用途 | 效果 |
|------|------|------|
| `easeOutCubic` | 展开动画 | 快速启动，平滑减速 |
| `easeInCubic` | 收起动画 | 缓慢启动，快速结束 |
| `cubic-bezier(0.16, 1, 0.3, 1)` | 内容淡入 | 弹性效果，更自然 |

### 性能优化

- ✅ 使用 `requestAnimationFrame` 的替代方案（16ms 间隔）
- ✅ 动画期间避免重排（只修改 bounds）
- ✅ 使用 `Math.round()` 避免亚像素渲染
- ✅ 动画完成后清理定时器

## 🎨 用户体验改进

### 之前的问题
- ❌ 窗口突然出现/消失，没有过渡
- ❌ 用户感知不到窗口从哪里来
- ❌ 关闭按钮直接退出应用

### 现在的体验
- ✅ 平滑的滑入/滑出动画
- ✅ 清晰的空间感知（从右侧滑入）
- ✅ 内容与窗口动画协调
- ✅ 关闭按钮变为收起，应用保持运行

## 🚀 未来可优化的方向

1. **弹性动画**: 添加轻微的回弹效果（spring animation）
2. **手势支持**: 支持向右滑动手势收起抽屉
3. **性能监控**: 添加 FPS 监控，确保低端设备流畅
4. **自适应速度**: 根据窗口大小调整动画时长
5. **视差效果**: 手柄和抽屉以不同速度移动

## 📝 测试清单

- [ ] 展开动画流畅无卡顿
- [ ] 收起动画流畅无卡顿
- [ ] 快速点击展开/收起不会出现状态错乱
- [ ] 动画期间拖拽文件正常工作
- [ ] 低端设备上动画帧率可接受
- [ ] 多显示器环境下动画正常

## 🐛 已知问题

1. **Windows 10 vs 11**: Windows 10 的窗口动画可能略有不同
2. **高 DPI 屏幕**: 需要测试 4K 显示器上的动画效果
3. **多显示器**: 跨显示器移动时的动画行为

---

**最后更新**: 2026-05-23
**版本**: v3.0.0
