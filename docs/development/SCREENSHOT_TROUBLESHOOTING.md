# 截图功能故障排查指南

**创建时间**: 2026-05-24  
**适用版本**: v3.4.0+

---

## 📋 功能概述

TidyDesk 的截图贴纸功能允许用户：
1. 通过快捷键 `Ctrl+Alt+S` 或点击 Rail 上的剪刀图标启动截图
2. 拖选屏幕区域进行截图
3. 截图自动生成为可拖动、可调整大小的贴纸窗口
4. 贴纸支持置顶、复制、另存为、关闭等操作

---

## 🔍 常见问题诊断

### 问题 1: 点击截图按钮没有反应

**可能原因**:
1. 截图窗口创建失败
2. 权限问题（屏幕录制权限）
3. 主进程事件监听未正确注册

**诊断步骤**:

1. **检查控制台日志**
   ```bash
   # 开发模式运行
   npm run dev
   
   # 查看是否有错误信息
   # 特别关注 "startScreenshot", "createSnipWindow", "desktopCapturer" 相关的日志
   ```

2. **检查快捷键是否注册**
   - 打开应用
   - 按 `Ctrl+Alt+S`
   - 如果快捷键有效但按钮无效，说明是 UI 事件传递问题

3. **检查 IPC 通信**
   - 在 `electron/main.cjs` 中添加日志：
   ```javascript
   ipcMain.on('window-control', (event, action) => {
     console.log('[MAIN] window-control:', action);
     if (action === 'start-screenshot') {
       console.log('[MAIN] Starting screenshot...');
       stickerService.startScreenshot();
     }
   });
   ```

### 问题 2: 截图窗口打开但无法选择区域

**可能原因**:
1. 鼠标事件未正确绑定
2. 窗口层级问题（alwaysOnTop 设置）
3. 透明窗口渲染问题

**诊断步骤**:

1. **检查窗口是否创建**
   - 在 `electron/services/stickers.cjs` 的 `createSnipWindow()` 中添加日志：
   ```javascript
   function createSnipWindow() {
     console.log('[STICKER] Creating snip window...');
     if (snipWindow && !snipWindow.isDestroyed()) {
       console.log('[STICKER] Snip window already exists');
       snipWindow.focus();
       return;
     }
     // ... 创建窗口代码
     console.log('[STICKER] Snip window created successfully');
   }
   ```

2. **检查前端是否加载**
   - 打开开发者工具（如果可以）
   - 检查 `SnipOverlayApp` 组件是否渲染
   - 检查鼠标事件是否触发

3. **检查窗口属性**
   ```javascript
   // 在 createSnipWindow() 创建后添加
   console.log('[STICKER] Snip window bounds:', snipWindow.getBounds());
   console.log('[STICKER] Snip window alwaysOnTop:', snipWindow.isAlwaysOnTop());
   ```

### 问题 3: 选择区域后没有生成贴纸

**可能原因**:
1. `desktopCapturer` 权限问题
2. 截图保存失败
3. 贴纸窗口创建失败

**诊断步骤**:

1. **检查 desktopCapturer 权限**
   - Windows: 通常不需要特殊权限
   - macOS: 需要屏幕录制权限
   - 在 `captureSelection()` 中添加日志：
   ```javascript
   async function captureSelection(rectPayload) {
     console.log('[STICKER] Capturing selection:', rectPayload);
     try {
       const rect = normalizeRect(rectPayload);
       console.log('[STICKER] Normalized rect:', rect);
       
       // ... 隐藏窗口
       
       const sources = await desktopCapturer.getSources({
         types: ['screen'],
         thumbnailSize: captureSize
       });
       console.log('[STICKER] Got sources:', sources.length);
       
       // ... 后续代码
     } catch (error) {
       console.error('[STICKER] Capture failed:', error);
       throw error;
     }
   }
   ```

2. **检查文件保存**
   ```javascript
   // 在保存图片后添加
   console.log('[STICKER] Image saved to:', imagePath);
   console.log('[STICKER] File exists:', fs.existsSync(imagePath));
   ```

3. **检查贴纸窗口创建**
   ```javascript
   // 在 createStickerWindow() 中添加
   console.log('[STICKER] Creating sticker window:', sticker.id);
   console.log('[STICKER] Sticker bounds:', sticker.bounds);
   ```

### 问题 4: 贴纸窗口创建但显示空白

**可能原因**:
1. 图片路径错误
2. 图片加载失败
3. Base64 编码问题

**诊断步骤**:

1. **检查图片路径**
   ```javascript
   // 在 getSticker() 中添加
   console.log('[STICKER] Loading sticker:', stickerId);
   console.log('[STICKER] Image path:', sticker.imagePath);
   console.log('[STICKER] File exists:', fs.existsSync(sticker.imagePath));
   console.log('[STICKER] File size:', fs.statSync(sticker.imagePath).size);
   ```

2. **检查前端加载**
   - 在 `StickerApp.tsx` 中添加日志：
   ```typescript
   useEffect(() => {
     console.log('[STICKER UI] Loading sticker:', stickerId);
     tidyDeskApi?.getSticker?.(stickerId)
       .then(data => {
         console.log('[STICKER UI] Sticker loaded:', data?.id);
         setSticker(data);
       })
       .catch(err => {
         console.error('[STICKER UI] Failed to load sticker:', err);
       });
   }, [stickerId]);
   ```

---

## 🔧 快速修复方案

### 方案 1: 重置截图存储

```javascript
// 在 electron/services/stickers.cjs 中添加清理函数
function resetStorage() {
  const stickerRoot = getStickerRoot();
  if (fs.existsSync(stickerRoot)) {
    fs.rmSync(stickerRoot, { recursive: true, force: true });
  }
  ensureStorage();
  console.log('[STICKER] Storage reset');
}

// 在 main.cjs 中添加 IPC 处理
ipcMain.handle('reset-sticker-storage', async () => {
  stickerService.resetStorage();
  return { success: true };
});
```

### 方案 2: 添加详细日志

在 `electron/services/stickers.cjs` 的关键函数中添加日志：

```javascript
function startScreenshot() {
  console.log('[STICKER] startScreenshot called');
  createSnipWindow();
}

function createSnipWindow() {
  console.log('[STICKER] createSnipWindow called');
  if (snipWindow && !snipWindow.isDestroyed()) {
    console.log('[STICKER] Snip window already exists, focusing');
    snipWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  console.log('[STICKER] Display bounds:', display.bounds);
  
  snipWindow = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(electronDir, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  console.log('[STICKER] Snip window created');
  snipWindow.setAlwaysOnTop(true, 'screen-saver');
  loadRenderer(snipWindow, 'snip');
  console.log('[STICKER] Snip window renderer loaded');
  
  snipWindow.on('closed', () => {
    console.log('[STICKER] Snip window closed');
    snipWindow = null;
  });
}

async function captureSelection(rectPayload) {
  console.log('[STICKER] captureSelection called:', rectPayload);
  
  try {
    const rect = normalizeRect(rectPayload);
    console.log('[STICKER] Normalized rect:', rect);
    
    const display = screen.getPrimaryDisplay();
    const scaleFactor = display.scaleFactor || 1;
    console.log('[STICKER] Scale factor:', scaleFactor);

    if (snipWindow && !snipWindow.isDestroyed()) {
      console.log('[STICKER] Hiding snip window');
      snipWindow.hide();
    }

    await new Promise(resolve => setTimeout(resolve, 140));

    const captureSize = {
      width: Math.round(display.bounds.width * scaleFactor),
      height: Math.round(display.bounds.height * scaleFactor)
    };
    console.log('[STICKER] Capture size:', captureSize);
    
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: captureSize
    });
    console.log('[STICKER] Got', sources.length, 'sources');

    const source = sources.find(item => item.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      console.error('[STICKER] No valid source found');
      closeSnipWindow();
      throw new Error('Unable to capture screen');
    }
    console.log('[STICKER] Using source:', source.name);

    const cropped = source.thumbnail.crop({
      x: Math.max(0, Math.round(rect.x * scaleFactor)),
      y: Math.max(0, Math.round(rect.y * scaleFactor)),
      width: Math.max(1, Math.round(rect.width * scaleFactor)),
      height: Math.max(1, Math.round(rect.height * scaleFactor))
    });
    console.log('[STICKER] Image cropped');

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const imagePath = path.join(getImageRoot(), `${id}.png`);
    console.log('[STICKER] Saving to:', imagePath);
    
    fs.writeFileSync(imagePath, cropped.toPNG());
    console.log('[STICKER] Image saved, size:', fs.statSync(imagePath).size);

    const stickerBounds = getInitialStickerBounds(rect, display);
    console.log('[STICKER] Sticker bounds:', stickerBounds);
    
    const sticker = {
      id,
      imagePath,
      bounds: stickerBounds,
      alwaysOnTop: true,
      createdAt: new Date().toISOString()
    };

    updateStickerRecord(sticker);
    console.log('[STICKER] Sticker record updated');
    
    createStickerWindow(sticker);
    console.log('[STICKER] Sticker window created');
    
    closeSnipWindow();
    console.log('[STICKER] Snip window closed');

    return { success: true, stickerId: id };
  } catch (error) {
    console.error('[STICKER] captureSelection error:', error);
    closeSnipWindow();
    throw error;
  }
}
```

### 方案 3: 检查权限（macOS）

如果在 macOS 上运行，需要添加屏幕录制权限：

在 `package.json` 的 `build` 配置中添加：

```json
{
  "build": {
    "mac": {
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    }
  }
}
```

创建 `build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.device.camera</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
  <key>com.apple.security.device.screen-recording</key>
  <true/>
</dict>
</plist>
```

---

## 🧪 测试步骤

### 基础功能测试

1. **启动应用**
   ```bash
   npm run dev
   ```

2. **测试快捷键**
   - 按 `Ctrl+Alt+S`
   - 应该看到全屏半透明遮罩
   - 顶部应该显示 "拖选截图区域，Esc 取消"

3. **测试截图选择**
   - 鼠标按下并拖动
   - 应该看到蓝色选择框
   - 显示选择区域的尺寸（如 "800 x 600"）

4. **测试截图生成**
   - 松开鼠标
   - 应该看到 "正在生成贴图..." 提示
   - 1-2 秒后应该出现贴纸窗口

5. **测试贴纸操作**
   - 鼠标悬停在贴纸上
   - 应该看到右上角的工具栏
   - 测试置顶、复制、另存为、关闭功能

### 性能测试

1. **多次截图**
   - 连续截图 10 次
   - 检查内存使用是否正常
   - 检查是否有内存泄漏

2. **大尺寸截图**
   - 截取全屏
   - 检查生成时间
   - 检查图片质量

3. **小尺寸截图**
   - 截取 100x100 像素
   - 检查是否正常显示
   - 检查最小尺寸限制（8x8）

---

## 📊 已知限制

1. **最小尺寸**: 截图区域必须 >= 8x8 像素
2. **性能**: 大尺寸截图（> 4K）可能需要 2-3 秒
3. **权限**: macOS 需要屏幕录制权限
4. **多显示器**: 目前只支持主显示器

---

## 🐛 常见错误信息

### "Unable to capture screen"

**原因**: `desktopCapturer.getSources()` 返回空或无效数据

**解决**:
1. 检查屏幕录制权限（macOS）
2. 重启应用
3. 检查 Electron 版本是否支持 `desktopCapturer`

### "Invalid snip rectangle"

**原因**: 选择区域的坐标或尺寸无效

**解决**:
1. 检查鼠标事件是否正确传递
2. 检查坐标计算逻辑
3. 确保选择区域 >= 8x8 像素

### "Snip rectangle is too small"

**原因**: 选择区域 < 8x8 像素

**解决**:
1. 选择更大的区域
2. 这是正常的限制，不是错误

---

## 📝 调试清单

- [ ] 检查控制台是否有错误日志
- [ ] 检查快捷键是否有效
- [ ] 检查 UI 按钮是否有效
- [ ] 检查截图窗口是否创建
- [ ] 检查鼠标事件是否触发
- [ ] 检查 desktopCapturer 是否有权限
- [ ] 检查图片是否保存成功
- [ ] 检查贴纸窗口是否创建
- [ ] 检查贴纸图片是否加载
- [ ] 检查存储目录是否存在

---

## 🔗 相关文件

- `electron/services/stickers.cjs` - 截图服务主逻辑
- `electron/preload.cjs` - API 暴露
- `electron/main.cjs` - 快捷键注册和事件监听
- `src/modules/stickers/SnipOverlayApp.tsx` - 截图选择界面
- `src/modules/stickers/StickerApp.tsx` - 贴纸窗口界面
- `src/modules/rail/RailApp.tsx` - Rail 按钮

---

**创建时间**: 2026-05-24  
**最后更新**: 2026-05-24  
**维护者**: TidyDesk Team
