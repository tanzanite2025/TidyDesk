/**
 * 截屏功能诊断工具
 * 用于测试 Electron 透明窗口是否正常工作
 */

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

console.log('[DIAGNOSE] Starting screenshot diagnostics...');
console.log('[DIAGNOSE] Electron version:', process.versions.electron);
console.log('[DIAGNOSE] Chrome version:', process.versions.chrome);
console.log('[DIAGNOSE] Node version:', process.versions.node);
console.log('[DIAGNOSE] Platform:', process.platform);

app.whenReady().then(() => {
  console.log('[DIAGNOSE] App ready');

  // 获取显示器信息
  const display = screen.getPrimaryDisplay();
  console.log('[DIAGNOSE] Display info:', {
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: display.internal
  });

  // 检查系统是否支持透明窗口
  if (process.platform === 'win32') {
    try {
      const { systemPreferences } = require('electron');
      if (systemPreferences.isAeroGlassEnabled) {
        const isAeroEnabled = systemPreferences.isAeroGlassEnabled();
        console.log('[DIAGNOSE] Windows Aero Glass enabled:', isAeroEnabled);
      }
    } catch (err) {
      console.log('[DIAGNOSE] Cannot check Aero Glass:', err.message);
    }
  }

  // 创建测试窗口 1: 完全透明背景 + HTML 半透明覆盖层（模拟实际截屏窗口）
  console.log('\n[DIAGNOSE] Creating test window 1: Transparent window with semi-transparent overlay...');
  const testWindow1 = new BrowserWindow({
    x: display.bounds.x + 100,
    y: display.bounds.y + 100,
    width: 800,
    height: 600,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  testWindow1.setBackgroundColor('#00000000');
  testWindow1.setOpacity(1.0);

  console.log('[DIAGNOSE] Test window 1 properties:', {
    opacity: testWindow1.getOpacity(),
    backgroundColor: testWindow1.getBackgroundColor(),
    bounds: testWindow1.getBounds()
  });

  // 加载测试 HTML（模拟 SnipOverlayApp）
  const testHtml1 = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          width: 100vw;
          height: 100vh;
          background-color: rgba(0, 0, 0, 0.18);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: system-ui, -apple-system, sans-serif;
          color: white;
          cursor: crosshair;
          overflow: hidden;
        }
        .info {
          background: rgba(0, 0, 0, 0.8);
          padding: 20px 30px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          text-align: center;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }
        h1 {
          font-size: 24px;
          margin-bottom: 10px;
          font-weight: 600;
        }
        p {
          font-size: 14px;
          opacity: 0.9;
          margin: 5px 0;
        }
        .success {
          color: #4ade80;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="info">
        <h1>🎯 截屏窗口测试 1</h1>
        <p>如果你能看到桌面内容（半透明黑色覆盖层）</p>
        <p class="success">✅ 透明窗口工作正常</p>
        <p style="margin-top: 15px; font-size: 12px; opacity: 0.7;">
          背景色: rgba(0, 0, 0, 0.18)<br>
          窗口透明: true<br>
          按 Esc 关闭
        </p>
      </div>
      <script>
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            window.close();
          }
        });
        console.log('[TEST1] Window loaded');
        console.log('[TEST1] Body background:', window.getComputedStyle(document.body).backgroundColor);
      </script>
    </body>
    </html>
  `;

  testWindow1.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testHtml1)}`);

  testWindow1.webContents.on('did-finish-load', () => {
    console.log('[DIAGNOSE] Test window 1 loaded successfully');
  });

  testWindow1.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[DIAGNOSE] Test window 1 failed to load:', errorCode, errorDescription);
  });

  // 创建测试窗口 2: 使用 ARGB 背景色（备选方案）
  setTimeout(() => {
    console.log('\n[DIAGNOSE] Creating test window 2: ARGB background color...');
    const testWindow2 = new BrowserWindow({
      x: display.bounds.x + 150,
      y: display.bounds.y + 150,
      width: 800,
      height: 600,
      frame: false,
      transparent: true,
      backgroundColor: '#2E000000',  // ARGB: 2E = 18% opacity
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true
    });

    console.log('[DIAGNOSE] Test window 2 properties:', {
      opacity: testWindow2.getOpacity(),
      backgroundColor: testWindow2.getBackgroundColor(),
      bounds: testWindow2.getBounds()
    });

    const testHtml2 = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; }
          body {
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: system-ui;
            color: white;
          }
          .info {
            background: rgba(0, 0, 0, 0.8);
            padding: 20px 30px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="info">
          <h1>🎯 截屏窗口测试 2</h1>
          <p>使用 ARGB 背景色</p>
          <p style="margin-top: 10px; font-size: 12px; opacity: 0.7;">
            backgroundColor: #2E000000<br>
            按 Esc 关闭
          </p>
        </div>
        <script>
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') window.close();
          });
        </script>
      </body>
      </html>
    `;

    testWindow2.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testHtml2)}`);
  }, 2000);

  // 创建测试窗口 3: 使用 Canvas 渲染（备选方案）
  setTimeout(() => {
    console.log('\n[DIAGNOSE] Creating test window 3: Canvas rendering...');
    const testWindow3 = new BrowserWindow({
      x: display.bounds.x + 200,
      y: display.bounds.y + 200,
      width: 800,
      height: 600,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true
    });

    const testHtml3 = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; }
          body {
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            background: transparent;
          }
          canvas {
            display: block;
            cursor: crosshair;
          }
          .info {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            padding: 20px 30px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            text-align: center;
            font-family: system-ui;
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <canvas id="canvas"></canvas>
        <div class="info">
          <h1>🎯 截屏窗口测试 3</h1>
          <p>使用 Canvas 渲染</p>
          <p style="margin-top: 10px; font-size: 12px; opacity: 0.7;">
            Canvas fillStyle: rgba(0, 0, 0, 0.18)<br>
            按 Esc 关闭
          </p>
        </div>
        <script>
          const canvas = document.getElementById('canvas');
          const ctx = canvas.getContext('2d');
          
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
          
          // 绘制半透明黑色覆盖层
          ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          console.log('[TEST3] Canvas rendered');
          
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') window.close();
          });
        </script>
      </body>
      </html>
    `;

    testWindow3.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testHtml3)}`);
  }, 4000);

  console.log('\n[DIAGNOSE] All test windows created');
  console.log('[DIAGNOSE] Instructions:');
  console.log('  1. 检查是否能看到桌面内容（半透明覆盖层）');
  console.log('  2. 如果看到全黑屏幕，说明透明窗口有问题');
  console.log('  3. 按 Esc 关闭测试窗口');
  console.log('  4. 按 Ctrl+C 退出诊断工具');
  console.log('\n[DIAGNOSE] Waiting for user interaction...');
});

app.on('window-all-closed', () => {
  console.log('[DIAGNOSE] All windows closed');
  console.log('[DIAGNOSE] Diagnostics complete. Press Ctrl+C to exit.');
});
