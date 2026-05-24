# 手柄窗口不可见问题分析

**发现时间**: 2026-05-24 22:20  
**严重程度**: 🚨 P0（严重）  
**状态**: ✅ 已解决

---

## 问题描述

**现象**: 应用启动后，手柄（handleWindow）不可见，用户无法使用应用

**影响**: 
- 用户无法打开抽屉
- 应用看起来像没有启动
- 只能通过托盘图标退出

---

## 根本原因

### 问题 1: 前端开发服务器未运行

**错误日志**:
```
(node:92236) electron: Failed to load URL: http://localhost:3000/?mode=rail with error: ERR_CONNECTION_REFUSED
(node:92236) electron: Failed to load URL: http://localhost:3000/?mode=drawer with error: ERR_CONNECTION_REFUSED
```

**原因**: 
- 在开发模式下，Electron 尝试连接 `http://localhost:3000`
- 但 Vite 开发服务器没有运行
- 窗口加载失败，显示空白

**代码位置**: `electron/services/windows.cjs`

```javascript
function loadRenderer(win, mode) {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    win.loadURL(`http://localhost:3000?mode=${mode}`);  // ← 连接失败
    if (process.env.TIDYDESK_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    win.loadFile(path.join(electronDir, '../dist/index.html'), { query: { mode } });
  }
}
```

### 问题 2: 没有错误提示

**问题**: 
- 窗口加载失败时，没有明显的错误提示
- 用户不知道发生了什么
- 只能通过控制台日志发现问题

---

## 解决方案

### 方案 1: 使用正确的启动命令（推荐）

**开发模式**:
```bash
# 方法 1: 使用 desktop 命令（推荐）
npm run desktop

# 这个命令会：
# 1. 启动 Vite 开发服务器（http://localhost:3000）
# 2. 等待服务器就绪
# 3. 启动 Electron 应用
```

**生产模式**:
```bash
# 1. 构建前端
npm run build

# 2. 启动 Electron（使用打包后的文件）
npx electron .
```

### 方案 2: 手动启动（用于调试）

**步骤**:
```bash
# 终端 1: 启动 Vite
npm run dev

# 终端 2: 启动 Electron
npx electron .
```

### 方案 3: 添加错误处理（长期方案）

**修改 `loadRenderer()` 函数**:

```javascript
function loadRenderer(win, mode) {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    const devUrl = `http://localhost:3000?mode=${mode}`;
    
    // 添加加载失败处理
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`[TIDYDESK] Failed to load ${devUrl}:`, errorDescription);
      
      // 显示错误页面
      win.loadURL(`data:text/html,
        <html>
          <body style="background: #1e1e1e; color: #fff; font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>⚠️ 开发服务器未运行</h1>
            <p>请先启动 Vite 开发服务器：</p>
            <pre style="background: #2d2d2d; padding: 20px; border-radius: 8px;">npm run dev</pre>
            <p>或使用：</p>
            <pre style="background: #2d2d2d; padding: 20px; border-radius: 8px;">npm run desktop</pre>
            <p style="margin-top: 40px; color: #888;">错误: ${errorDescription}</p>
          </body>
        </html>
      `);
    });
    
    win.loadURL(devUrl);
    
    if (process.env.TIDYDESK_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    win.loadFile(path.join(electronDir, '../dist/index.html'), { query: { mode } });
  }
}
```

### 方案 4: 自动启动开发服务器（最佳方案）

**修改 `electron/main.cjs`**:

```javascript
// 在 app.whenReady() 之前添加
if (process.env.NODE_ENV === 'development' && !app.isPackaged) {
  const { spawn } = require('child_process');
  const http = require('http');
  
  // 检查开发服务器是否运行
  function checkDevServer() {
    return new Promise((resolve) => {
      http.get('http://localhost:3000', (res) => {
        resolve(true);
      }).on('error', () => {
        resolve(false);
      });
    });
  }
  
  // 启动开发服务器
  async function startDevServer() {
    const isRunning = await checkDevServer();
    if (isRunning) {
      console.log('[TIDYDESK] Dev server already running');
      return;
    }
    
    console.log('[TIDYDESK] Starting dev server...');
    const devServer = spawn('npm', ['run', 'dev'], {
      shell: true,
      stdio: 'inherit'
    });
    
    // 等待服务器启动
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const isRunning = await checkDevServer();
      if (isRunning) {
        console.log('[TIDYDESK] Dev server started');
        return;
      }
    }
    
    throw new Error('Dev server failed to start');
  }
  
  // 在 app.whenReady() 之前启动
  app.on('ready', async () => {
    try {
      await startDevServer();
    } catch (err) {
      console.error('[TIDYDESK] Failed to start dev server:', err);
      dialog.showErrorBox(
        'TidyDesk 启动失败',
        '无法启动开发服务器。请手动运行 "npm run dev"'
      );
      app.quit();
    }
  });
}
```

---

## 实施建议

### 短期（立即）

1. **更新 README.md**，明确说明启动命令：
   ```markdown
   ## 开发

   ```bash
   # 推荐方式（自动启动前端和后端）
   npm run desktop

   # 或手动启动
   # 终端 1
   npm run dev
   
   # 终端 2
   npx electron .
   ```
   ```

2. **更新 package.json**，确保 `desktop` 命令存在：
   ```json
   {
     "scripts": {
       "dev": "vite",
       "desktop": "concurrently \"vite\" \"wait-on http://localhost:3000 && electron .\"",
       "build": "tsc && vite build",
       "build:electron": "npm run build && electron-builder --win --publish never"
     }
   }
   ```

### 中期（本周）

3. **实施方案 3**：添加错误处理，显示友好的错误页面

4. **添加启动检查**：在 `main.cjs` 中检查开发服务器是否运行

### 长期（下周）

5. **实施方案 4**：自动启动开发服务器

6. **添加健康检查**：定期检查前端连接状态

---

## 预防措施

### 1. 文档改进

**在 README.md 中添加**:

```markdown
## ⚠️ 常见问题

### 应用启动后看不到手柄

**原因**: 开发服务器未运行

**解决方案**:
1. 使用 `npm run desktop` 启动（推荐）
2. 或先运行 `npm run dev`，再运行 `npx electron .`

### 窗口显示空白

**原因**: 前端加载失败

**解决方案**:
1. 检查控制台是否有 `ERR_CONNECTION_REFUSED` 错误
2. 确保 Vite 开发服务器在 http://localhost:3000 运行
3. 检查端口 3000 是否被占用
```

### 2. 启动脚本改进

**创建 `start-dev.bat`**:

```batch
@echo off
echo Starting TidyDesk in development mode...
echo.

echo [1/2] Starting Vite dev server...
start "Vite Dev Server" cmd /k npm run dev

echo [2/2] Waiting for dev server...
timeout /t 5 /nobreak > nul

echo Starting Electron...
npx electron .
```

### 3. 添加启动检查

**在 `electron/main.cjs` 开头添加**:

```javascript
// 开发模式检查
if (process.env.NODE_ENV === 'development' && !app.isPackaged) {
  const http = require('http');
  
  http.get('http://localhost:3000', (res) => {
    console.log('[TIDYDESK] Dev server is running ✓');
  }).on('error', (err) => {
    console.error('[TIDYDESK] Dev server is not running!');
    console.error('[TIDYDESK] Please run: npm run dev');
    console.error('[TIDYDESK] Or use: npm run desktop');
    
    // 延迟退出，让用户看到错误信息
    setTimeout(() => {
      app.quit();
    }, 5000);
  });
}
```

---

## 测试验证

### 测试场景 1: 正常启动

```bash
npm run desktop
```

**预期**: 
- ✅ Vite 启动
- ✅ Electron 启动
- ✅ 手柄可见
- ✅ 功能正常

### 测试场景 2: 缺少开发服务器

```bash
npx electron .  # 不启动 Vite
```

**预期**:
- ❌ 窗口空白
- ❌ 控制台错误: `ERR_CONNECTION_REFUSED`
- ⚠️ 应该显示错误提示（实施方案 3 后）

### 测试场景 3: 生产模式

```bash
npm run build
npx electron .
```

**预期**:
- ✅ 加载打包后的文件
- ✅ 手柄可见
- ✅ 功能正常

---

## 总结

### 问题根源

**开发模式下缺少前端开发服务器**，导致窗口加载失败

### 解决方案

1. ✅ **立即**: 使用 `npm run desktop` 启动
2. ⏳ **短期**: 更新文档，添加错误处理
3. ⏳ **长期**: 自动启动开发服务器

### 经验教训

1. **开发环境依赖要明确** - 文档中应该清楚说明
2. **错误处理要友好** - 不要让用户看到空白窗口
3. **启动流程要简化** - 一个命令搞定所有事情

---

**创建时间**: 2026-05-24 22:30  
**状态**: 已解决  
**优先级**: P0

