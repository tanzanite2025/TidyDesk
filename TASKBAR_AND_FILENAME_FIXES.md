# 任务栏图标问题修复

## 修复日期
2026-05-24

## 问题描述

**现象**: TidyDesk 的手柄窗口出现在 Windows 底部任务栏中，点击可以显示/隐藏手柄。

**预期行为**: 手柄窗口应该只在系统托盘（Windows 右下角 WiFi 图标区域）显示，不应该出现在任务栏中。

**根本原因**: `createHandleWindow()` 函数中 `skipTaskbar` 设置为 `false`，导致窗口在任务栏显示。

## 修复方案

**文件**: `electron/main.cjs`  
**位置**: `createHandleWindow()` 函数（约第 670-680 行）

**修改前**:
```javascript
function createHandleWindow() {
  handleWindow = new BrowserWindow({
    ...baseWindowOptions(),
    ...getHandleBounds(false),
    alwaysOnTop: true,
    skipTaskbar: false  // ❌ 错误：会在任务栏显示
  });
```

**修改后**:
```javascript
function createHandleWindow() {
  handleWindow = new BrowserWindow({
    ...baseWindowOptions(),
    ...getHandleBounds(false),
    alwaysOnTop: true,
    skipTaskbar: true  // ✅ 正确：不在任务栏显示，只在系统托盘
  });
```

**效果**:
- ✅ 手柄窗口不再出现在 Windows 任务栏
- ✅ 手柄窗口仍然可以通过系统托盘访问
- ✅ 抽屉窗口保持 `skipTaskbar: true`（已经正确）

## 技术细节

### skipTaskbar 属性说明
- `skipTaskbar: true` - 窗口不在任务栏显示（推荐用于工具窗口、托盘应用）
- `skipTaskbar: false` - 窗口在任务栏显示（用于主应用窗口）

### TidyDesk 窗口配置
| 窗口 | skipTaskbar | alwaysOnTop | 说明 |
|------|-------------|-------------|------|
| handleWindow | true | 动态 | 收起时置顶，展开时取消置顶 |
| drawerWindow | true | false | 不置顶，允许用户切换窗口 |

## 测试验证

1. ✅ 启动 TidyDesk
2. ✅ 检查 Windows 任务栏 - 不应该看到 TidyDesk 图标
3. ✅ 检查系统托盘（右下角）- 应该可以看到 TidyDesk
4. ✅ 点击手柄 - 抽屉正常展开/收起

## 相关文件
- `electron/main.cjs` - 主进程代码

## 下一步
这个修复将包含在下一个版本发布中。建议版本号：v3.0.2

## 注意事项
- 这个修复不影响现有功能
- 不需要数据迁移
- 向后兼容所有现有抽屉和快捷方式
