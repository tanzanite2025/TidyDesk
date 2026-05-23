# TidyDesk 常驻机制快速实施指南

**5 分钟快速上手** | v3.2.0 实施方案

---

## 🎯 核心目标

让 TidyDesk 成为真正的常驻应用，关闭窗口不退出，始终在后台运行。

---

## 🔑 关键技术点

### 1. 系统托盘（最重要）⭐⭐⭐⭐⭐

```javascript
const { Tray, Menu } = require('electron');

let tray = null;
let isQuitting = false;

// 创建托盘
function createTray() {
  tray = new Tray('path/to/icon.ico');
  
  const menu = Menu.buildFromTemplate([
    { label: '显示', click: () => handleWindow.show() },
    { label: '隐藏', click: () => handleWindow.hide() },
    { type: 'separator' },
    { 
      label: '退出', 
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(menu);
  tray.setToolTip('TidyDesk');
}

// 防止关闭窗口时退出
app.on('window-all-closed', () => {
  // 什么都不做，保持运行
});

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    handleWindow.hide();
  }
});
```

### 2. 开机自启动 ⭐⭐⭐⭐

```javascript
// 设置开机自启
app.setLoginItemSettings({
  openAtLogin: true,
  openAsHidden: false
});

// 检查是否已设置
const isAutoStart = app.getLoginItemSettings().openAtLogin;
```

### 3. 单实例锁 ⭐⭐⭐⭐

```javascript
// 确保只运行一个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 聚焦到已有实例
    if (handleWindow) {
      handleWindow.show();
      handleWindow.focus();
    }
  });
}
```

### 4. 内存监控 ⭐⭐⭐

```javascript
// 每 10 分钟检查一次内存
setInterval(() => {
  const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  console.log(`Memory: ${memMB}MB`);
  
  if (memMB > 500) {
    if (global.gc) global.gc(); // 触发垃圾回收
  }
}, 10 * 60 * 1000);
```

---

## 📋 实施步骤

### Step 1: 准备托盘图标

在 `build/` 目录创建 `tray-icon.ico`（16x16 像素）

### Step 2: 创建 resident.js 模块

复制完整代码到 `electron/resident.js`（见详细文档）

### Step 3: 更新 config.js

```javascript
// 添加常驻配置
RESIDENT: {
  ENABLE_TRAY: true,
  ENABLE_AUTO_START: true,
  HIDE_ON_CLOSE: true,
  MEMORY_CHECK_INTERVAL: 10 * 60 * 1000
}
```

### Step 4: 集成到 main.cjs

```javascript
const resident = require('./resident');

app.whenReady().then(() => {
  createWindows();
  resident.initializeResident(handleWindow, drawerWindow);
});

app.on('before-quit', () => {
  if (!resident.isAppQuitting()) return;
  resident.cleanupResident();
});
```

---

## ✅ 验证测试

1. **启动应用** → 托盘出现图标 ✓
2. **关闭窗口** → 应用仍在运行 ✓
3. **右键托盘** → 菜单正常显示 ✓
4. **双击托盘** → 窗口重新显示 ✓
5. **重启电脑** → 自动启动（如果已设置）✓
6. **再次启动** → 聚焦到已有实例 ✓

---

## 🎨 托盘图标设计建议

```
尺寸: 16x16 像素
格式: .ico
颜色: 单色或简单双色
风格: 简洁、易识别
背景: 透明
```

可以使用在线工具：
- https://www.icoconverter.com/
- https://convertio.co/zh/png-ico/

---

## 🚨 常见问题

### Q: 托盘图标不显示？
A: 检查图标路径是否正确，确保 .ico 文件存在

### Q: 关闭窗口还是退出了？
A: 确保 `isQuitting` 标志正确设置，检查 `before-quit` 事件处理

### Q: 开机自启不生效？
A: Windows 可能需要管理员权限，检查注册表或任务计划程序

### Q: 内存占用过高？
A: 检查是否有内存泄漏，确保定期清理缓存和事件监听器

---

## 📊 预期效果

| 功能 | 状态 |
|------|------|
| 关闭窗口不退出 | ✅ |
| 托盘图标常驻 | ✅ |
| 开机自动启动 | ✅ |
| 单实例运行 | ✅ |
| 内存自动管理 | ✅ |

---

## 🔗 相关文档

- [完整实施指南](./RESIDENT_MECHANISM_GUIDE.md)
- [配置文件说明](./electron/config.js)
- [Electron 托盘文档](https://www.electronjs.org/docs/latest/api/tray)

---

**快速开始，5 分钟让 TidyDesk 真正常驻！** 🚀
