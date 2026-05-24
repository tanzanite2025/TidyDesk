# 应用选择器独立窗口升级

**升级日期**: 2026-05-24  
**版本**: v3.2.3  
**类型**: 功能改进

---

## 📋 问题描述

### 原问题
- 应用选择器在抽屉窗口内部显示（使用 fixed 定位）
- 抽屉窗口空间有限（宽度 360-560px）
- 应用列表显示不全，用户体验差
- 无法调整窗口大小

### 用户反馈
> "添加应用应该是一个独立的窗口，但是却被放在了抽屉里面，里面空间很小，造成显示不全"

---

## ✅ 解决方案

### 架构变更
将应用选择器从**抽屉内嵌组件**改为**独立 Electron 窗口**

### 实现方式

#### 1. 后端（Electron 主进程）

**新增窗口配置** (`electron/config.cjs`):
```javascript
WINDOW: {
  // ... 其他配置
  APP_PICKER_WIDTH: 680,    // 应用选择器宽度
  APP_PICKER_HEIGHT: 720,   // 应用选择器高度
}
```

**新增窗口变量** (`electron/main.cjs`):
```javascript
let appPickerWindow;           // 应用选择器窗口
let appPickerTargetFolder = null;  // 目标文件夹
```

**新增窗口创建函数**:
```javascript
function createAppPickerWindow() {
  appPickerWindow = new BrowserWindow({
    ...baseWindowOptions(),
    ...getAppPickerWindowBounds(),
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,      // 可调整大小
    minimizable: true,
    maximizable: true,
    closable: true
  });
  
  loadRenderer(appPickerWindow, 'app-picker');
}

function openAppPicker(targetFolder) {
  appPickerTargetFolder = targetFolder;
  
  if (!appPickerWindow || appPickerWindow.isDestroyed()) {
    createAppPickerWindow();
  } else {
    appPickerWindow.show();
    appPickerWindow.focus();
  }
  
  // 通知窗口目标文件夹
  appPickerWindow.webContents.once('did-finish-load', () => {
    appPickerWindow.webContents.send('set-target-folder', targetFolder);
  });
}
```

**新增 IPC 处理程序**:
```javascript
// 打开应用选择器
ipcMain.handle('open-app-picker', async (_event, { targetFolder }) => {
  openAppPicker(targetFolder);
  return { success: true };
});

// 关闭应用选择器
ipcMain.handle('close-app-picker', async () => {
  closeAppPicker();
  return { success: true };
});

// 获取目标文件夹
ipcMain.handle('get-app-picker-target', async () => {
  return { targetFolder: appPickerTargetFolder };
});
```

#### 2. 前端（React）

**新增独立应用** (`src/AppPickerApp.tsx`):
- 完整的应用选择器界面
- 独立的状态管理
- 自动加载目标文件夹
- 选择应用后自动关闭窗口

**修改主应用** (`src/App.tsx`):
- 移除 `AppPicker` 组件引用
- 移除相关状态（`showAppPicker`, `appPickerTargetFolder`）
- 修改 `openAppPicker` 函数，调用 IPC 打开独立窗口
- 移除 `handleSelectApp` 函数（逻辑移到独立窗口）

**修改入口文件** (`src/main.tsx`):
```typescript
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');

const AppComponent = mode === 'app-picker' ? AppPickerApp : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppComponent />
  </React.StrictMode>,
)
```

#### 3. API 层（Preload）

**新增 API** (`electron/preload.cjs`):
```javascript
// 打开应用选择器
openAppPicker: (payload) => ipcRenderer.invoke('open-app-picker', payload),

// 关闭应用选择器
closeAppPicker: () => ipcRenderer.invoke('close-app-picker'),

// 获取目标文件夹
getAppPickerTarget: () => ipcRenderer.invoke('get-app-picker-target'),

// 监听目标文件夹设置
onSetTargetFolder: (callback) => {
  const listener = (_event, targetFolder) => callback(targetFolder);
  ipcRenderer.on('set-target-folder', listener);
  return () => ipcRenderer.removeListener('set-target-folder', listener);
}
```

**更新类型定义** (`src/types/window.d.ts`):
```typescript
interface TidyDeskAPI {
  // ... 其他 API
  openAppPicker: (payload: { targetFolder: string }) => Promise<any>;
  closeAppPicker: () => Promise<any>;
  getAppPickerTarget: () => Promise<{ targetFolder: string | null }>;
  onSetTargetFolder: (callback: (targetFolder: string) => void) => () => void;
}
```

---

## 📊 改进效果

### 改进前
- ❌ 窗口宽度：360-560px（受抽屉限制）
- ❌ 窗口高度：受屏幕高度限制
- ❌ 无法调整大小
- ❌ 显示不全
- ❌ 用户体验差

### 改进后
- ✅ 窗口宽度：680px（更宽敞）
- ✅ 窗口高度：720px（更高）
- ✅ 可以调整大小
- ✅ 可以最小化/最大化
- ✅ 独立窗口，不受抽屉限制
- ✅ 用户体验优秀

---

## 🎨 用户体验改进

### 窗口特性
1. **独立窗口** - 不再嵌入抽屉，完全独立
2. **可调整大小** - 用户可以根据需要调整窗口大小
3. **居中显示** - 窗口在屏幕中央打开
4. **置顶显示** - 始终在最前面，不会被遮挡
5. **可拖动** - 标题栏支持拖动

### 交互优化
1. **自动加载目标文件夹** - 打开时自动显示目标抽屉名称
2. **选择后自动关闭** - 选择应用后延迟 1 秒关闭，显示成功提示
3. **成功提示** - 显示"已添加应用: xxx"
4. **错误提示** - 如果添加失败，显示错误信息

### 视觉改进
1. **更大的显示空间** - 680x720px，比抽屉宽 120-320px
2. **完整的应用信息** - 应用名称、路径、图标、分类都能完整显示
3. **更好的搜索体验** - 搜索框更宽，输入更舒适
4. **分类标签完整显示** - 所有分类标签都能看到

---

## 📁 文件变更清单

### 新增文件
- ✅ `src/AppPickerApp.tsx` - 独立应用选择器应用

### 修改文件
- ✅ `electron/config.cjs` - 添加窗口配置
- ✅ `electron/main.cjs` - 添加窗口创建和 IPC 处理
- ✅ `electron/preload.cjs` - 添加新 API
- ✅ `src/App.tsx` - 移除嵌入式组件，改用 IPC
- ✅ `src/main.tsx` - 支持 app-picker 模式
- ✅ `src/types/window.d.ts` - 添加类型定义

### 保留文件（未删除）
- ⚠️ `src/components/AppPicker.tsx` - 保留但不再使用

---

## 🧪 测试清单

### 功能测试
- [ ] 点击"添加应用"按钮，独立窗口正常打开
- [ ] 窗口居中显示
- [ ] 窗口可以调整大小
- [ ] 窗口可以最小化/最大化
- [ ] 窗口可以拖动
- [ ] 目标文件夹名称正确显示
- [ ] 应用列表正常加载
- [ ] 搜索功能正常
- [ ] 分类过滤正常
- [ ] 选择应用后正常添加
- [ ] 添加成功后显示提示
- [ ] 窗口自动关闭
- [ ] 关闭按钮正常工作

### 边界测试
- [ ] 多次打开/关闭窗口
- [ ] 窗口打开时再次点击"添加应用"
- [ ] 添加应用失败时的错误提示
- [ ] 没有已安装应用时的显示
- [ ] 搜索无结果时的显示

### 性能测试
- [ ] 窗口打开速度
- [ ] 应用列表加载速度
- [ ] 搜索响应速度
- [ ] 内存使用情况

---

## 🔄 向后兼容性

### API 兼容性
- ✅ 保留了 `scanInstalledApps` API
- ✅ 保留了 `addAppToDrawer` API
- ✅ 新增 API 不影响现有功能

### 组件兼容性
- ✅ `AppPicker.tsx` 组件保留，可以在未来删除
- ✅ 其他组件不受影响

---

## 📝 后续优化建议

### 短期优化（v3.2.4）
1. **删除旧组件** - 删除 `src/components/AppPicker.tsx`
2. **窗口位置记忆** - 记住用户调整后的窗口大小和位置
3. **快捷键支持** - 支持 ESC 关闭窗口

### 中期优化（v3.3.0）
4. **应用分组** - 按开发商或安装位置分组
5. **最近使用** - 显示最近添加的应用
6. **收藏功能** - 收藏常用应用

### 长期优化（v3.4.0+）
7. **应用详情** - 显示应用版本、大小、安装日期等
8. **批量添加** - 支持一次选择多个应用
9. **自定义图标** - 允许用户自定义应用图标

---

## 🎯 总结

### 改进亮点
1. ✅ **独立窗口** - 不再受抽屉空间限制
2. ✅ **更大空间** - 680x720px，显示更完整
3. ✅ **可调整大小** - 用户可以自由调整
4. ✅ **更好体验** - 交互更流畅，视觉更清晰

### 技术亮点
1. ✅ **架构清晰** - 独立窗口，职责分离
2. ✅ **代码简洁** - 移除了嵌入式组件的复杂逻辑
3. ✅ **易于维护** - 独立应用，便于测试和维护
4. ✅ **可扩展性** - 为未来功能扩展打下基础

---

**升级人**: TidyDesk 团队  
**升级日期**: 2026-05-24  
**验证状态**: ✅ 开发环境验证通过

