const path = require('path');
const { BrowserWindow, screen, clipboard } = require('electron');

function createWindowService({ app, config, electronDir, isWindows11, onTodoPanelOpened }) {
  let handleWindow;
  let drawerWindow;
  let todoWindow;
  let captureWindow;
  let appPickerWindow;
  let isDrawerExpanded = false;
  let activeModule = null;
  let appPickerTargetFolder = null;

  function getContentWidth() {
    const display = screen.getPrimaryDisplay();
    const { workArea } = display;
    const scaleFactor = display.scaleFactor || 1;
    const logicalWidth = workArea.width / scaleFactor;
    const targetWidth = Math.max(
      config.WINDOW.DRAWER_MIN_WIDTH,
      Math.min(Math.round(logicalWidth * config.WINDOW.DRAWER_WIDTH_RATIO), config.WINDOW.DRAWER_MAX_WIDTH)
    );

    return Math.round(targetWidth * scaleFactor);
  }

  function getHandleBoundsForContentWidth(contentWidth) {
    const { workArea } = screen.getPrimaryDisplay();
    const width = config.WINDOW.HANDLE_WIDTH;
    const height = config.WINDOW.HANDLE_HEIGHT;

    return {
      x: workArea.x + workArea.width - contentWidth - width,
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height
    };
  }

  function getHandleBounds(expanded) {
    return getHandleBoundsForContentWidth(expanded ? getContentWidth() : 0);
  }

  function getDrawerWindowBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const width = getContentWidth();
    return {
      x: workArea.x + workArea.width - width,
      y: workArea.y,
      width,
      height: workArea.height
    };
  }

  function getTodoWindowBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const width = Math.min(config.WINDOW.TODO_WIDTH, workArea.width - 96);
    const height = Math.min(config.WINDOW.TODO_HEIGHT, workArea.height - 96);
    return {
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height
    };
  }

  function getCaptureWindowBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const width = config.WINDOW.CAPTURE_WIDTH;
    const height = config.WINDOW.CAPTURE_HEIGHT;
    return {
      x: workArea.x + workArea.width - width - config.WINDOW.HANDLE_WIDTH - 12,
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height
    };
  }

  function getAppPickerWindowBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const width = config.WINDOW.APP_PICKER_WIDTH;
    const height = config.WINDOW.APP_PICKER_HEIGHT;

    return {
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height
    };
  }

  function getWindow(name) {
    const windows = {
      handle: handleWindow,
      drawer: drawerWindow,
      todo: todoWindow,
      capture: captureWindow,
      appPicker: appPickerWindow
    };

    return windows[name] || null;
  }

  function sendTo(name, channel, payload) {
    const win = getWindow(name);
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }

  function sendToMany(names, channel, payload) {
    for (const name of names) {
      sendTo(name, channel, payload);
    }
  }

  function sendModuleState() {
    const payload = {
      expanded: isDrawerExpanded,
      activeModule
    };

    for (const win of [handleWindow, drawerWindow, todoWindow, captureWindow]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('drawer-state', payload);
        win.webContents.send('module-state', payload);
      }
    }
  }

  function loadRenderer(win, mode) {
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    if (isDev) {
      win.loadURL(`http://localhost:3000?mode=${mode}`);
      if (process.env.TIDYDESK_DEVTOOLS === '1') {
        win.webContents.openDevTools({ mode: 'detach' });
      }
    } else {
      win.loadFile(path.join(electronDir, '../dist/index.html'), { query: { mode } });
    }
  }

  function animateWindowBounds(win, targetBounds, duration = 250, easing = 'easeOutCubic', onComplete = null) {
    if (!win || win.isDestroyed()) {
      if (onComplete) onComplete();
      return;
    }

    const startBounds = win.getBounds();
    const startTime = Date.now();
    const easingFunctions = {
      linear: t => t,
      easeInCubic: t => t * t * t,
      easeOutCubic: t => 1 - Math.pow(1 - t, 3),
      easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    };
    const easingFunc = easingFunctions[easing] || easingFunctions.easeOutCubic;

    function animate() {
      if (!win || win.isDestroyed()) {
        if (onComplete) onComplete();
        return;
      }

      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easingFunc(progress);
      const currentBounds = {
        x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * easedProgress),
        y: Math.round(startBounds.y + (targetBounds.y - startBounds.y) * easedProgress),
        width: Math.round(startBounds.width + (targetBounds.width - startBounds.width) * easedProgress),
        height: Math.round(startBounds.height + (targetBounds.height - startBounds.height) * easedProgress)
      };

      try {
        win.setBounds(currentBounds);
      } catch (err) {
        console.error('[TIDYDESK] Animation error:', err);
        if (onComplete) onComplete();
        return;
      }

      if (progress < 1) {
        setTimeout(animate, 16);
      } else if (onComplete) {
        onComplete();
      }
    }

    animate();
  }

  function baseWindowOptions() {
    return {
      minWidth: config.WINDOW.MIN_WIDTH,
      minHeight: config.WINDOW.MIN_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: false,
      alwaysOnTop: true,
      resizable: false,
      webPreferences: {
        preload: path.join(electronDir, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true
      }
    };
  }

  function applyHandleShape() {
    if (!handleWindow || handleWindow.isDestroyed()) return;

    if (!isWindows11()) {
      console.log('[TIDYDESK] Windows 10 detected, skipping complex window shape');
      return;
    }

    try {
      const { width, height } = handleWindow.getBounds();
      const radius = config.WINDOW.CORNER_RADIUS;
      const rects = [];

      for (let y = 0; y < radius; y++) {
        const x = Math.round(radius - Math.sqrt(radius * radius - (radius - y) * (radius - y)));
        rects.push({ x, y, width: width - x, height: 1 });
      }

      rects.push({ x: 0, y: radius, width, height: height - 2 * radius });

      for (let y = 0; y < radius; y++) {
        const x = Math.round(radius - Math.sqrt(radius * radius - y * y));
        rects.push({ x, y: height - radius + y, width: width - x, height: 1 });
      }

      handleWindow.setShape(rects);
      console.log('[TIDYDESK] Applied rounded corners for Windows 11');
    } catch (err) {
      console.warn('[TIDYDESK] Failed to apply window shape', err);
    }
  }

  function createHandleWindow() {
    handleWindow = new BrowserWindow({
      ...baseWindowOptions(),
      ...getHandleBounds(false),
      alwaysOnTop: true,
      skipTaskbar: true
    });

    loadRenderer(handleWindow, 'rail');
    handleWindow.webContents.on('did-finish-load', applyHandleShape);
    handleWindow.on('closed', () => {
      handleWindow = null;
    });
  }

  function createDrawerWindow() {
    drawerWindow = new BrowserWindow({
      ...baseWindowOptions(),
      ...getDrawerWindowBounds(),
      alwaysOnTop: false,
      skipTaskbar: true
    });

    loadRenderer(drawerWindow, 'drawer');
    drawerWindow.hide();

    drawerWindow.on('blur', () => {
      if (drawerWindow && !drawerWindow.isDestroyed()) {
        drawerWindow.setAlwaysOnTop(false);
      }
    });

    drawerWindow.on('focus', () => {
      if (drawerWindow && !drawerWindow.isDestroyed()) {
        drawerWindow.moveTop();
      }
    });

    drawerWindow.on('closed', () => {
      drawerWindow = null;
    });
  }

  function createTodoWindow() {
    if (todoWindow && !todoWindow.isDestroyed()) {
      return;
    }

    todoWindow = new BrowserWindow({
      ...baseWindowOptions(),
      ...getTodoWindowBounds(),
      minWidth: config.WINDOW.TODO_MIN_WIDTH,
      minHeight: config.WINDOW.TODO_MIN_HEIGHT,
      alwaysOnTop: false,
      skipTaskbar: false,
      hasShadow: true,
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: true,
      title: 'TidyDesk 待办'
    });

    loadRenderer(todoWindow, 'todos');
    todoWindow.hide();

    todoWindow.on('blur', () => {
      if (todoWindow && !todoWindow.isDestroyed()) {
        todoWindow.setAlwaysOnTop(false);
      }
    });

    todoWindow.on('focus', () => {
      if (todoWindow && !todoWindow.isDestroyed()) {
        todoWindow.moveTop();
      }
    });

    todoWindow.on('closed', () => {
      todoWindow = null;
      if (activeModule === 'todos') {
        activeModule = null;
        sendModuleState();
      }
    });
  }

  function createCaptureWindow() {
    captureWindow = new BrowserWindow({
      ...baseWindowOptions(),
      ...getCaptureWindowBounds(),
      alwaysOnTop: true,
      skipTaskbar: true
    });

    loadRenderer(captureWindow, 'capture');
    captureWindow.hide();

    captureWindow.on('blur', () => {
      if (activeModule === 'capture') {
        closeActiveModule();
      }
    });

    captureWindow.on('closed', () => {
      captureWindow = null;
    });
  }

  function createAppPickerWindow() {
    if (appPickerWindow && !appPickerWindow.isDestroyed()) {
      appPickerWindow.focus();
      return;
    }

    appPickerWindow = new BrowserWindow({
      ...baseWindowOptions(),
      ...getAppPickerWindowBounds(),
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      closable: true
    });

    loadRenderer(appPickerWindow, 'app-picker');
    appPickerWindow.on('closed', () => {
      appPickerWindow = null;
      appPickerTargetFolder = null;
    });
  }

  function createWindows() {
    createDrawerWindow();
    createTodoWindow();
    createCaptureWindow();
    createHandleWindow();
    applyDrawerBounds(false, false);
  }

  function hideAuxiliaryWindows() {
    if (todoWindow && !todoWindow.isDestroyed()) {
      todoWindow.hide();
    }
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.hide();
    }
  }

  function hideDrawerWindowNow() {
    isDrawerExpanded = false;
    if (drawerWindow && !drawerWindow.isDestroyed()) {
      drawerWindow.hide();
    }
  }

  function applyDrawerBounds(expanded, animate = true) {
    isDrawerExpanded = expanded;
    if (expanded) {
      activeModule = 'files';
      hideAuxiliaryWindows();
    } else if (activeModule === 'files') {
      activeModule = null;
    }

    if (handleWindow) {
      const handleBounds = getHandleBounds(expanded);
      if (animate) {
        animateWindowBounds(handleWindow, handleBounds, config.VALIDATION.ANIMATION_DURATION);
      } else {
        handleWindow.setBounds(handleBounds);
      }
      handleWindow.setAlwaysOnTop(!expanded);
    }

    if (!drawerWindow) return;

    if (expanded) {
      const targetBounds = getDrawerWindowBounds();
      const { workArea } = screen.getPrimaryDisplay();
      const startBounds = {
        x: workArea.x + workArea.width,
        y: targetBounds.y,
        width: targetBounds.width,
        height: targetBounds.height
      };

      drawerWindow.setBounds(startBounds);
      drawerWindow.show();

      if (animate) {
        animateWindowBounds(drawerWindow, targetBounds, config.VALIDATION.ANIMATION_DURATION, 'easeOutCubic');
      } else {
        drawerWindow.setBounds(targetBounds);
      }

      setTimeout(() => drawerWindow.focus(), 100);
    } else if (animate) {
      const { workArea } = screen.getPrimaryDisplay();
      const currentBounds = drawerWindow.getBounds();
      const targetBounds = {
        x: workArea.x + workArea.width,
        y: currentBounds.y,
        width: currentBounds.width,
        height: currentBounds.height
      };

      animateWindowBounds(drawerWindow, targetBounds, config.VALIDATION.ANIMATION_DURATION, 'easeInCubic', () => {
        drawerWindow.hide();
      });
    } else {
      drawerWindow.hide();
    }

    sendModuleState();
  }

  function openTodoPanel() {
    if (activeModule === 'todos') {
      closeActiveModule();
      return;
    }

    hideDrawerWindowNow();
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.hide();
    }

    activeModule = 'todos';
    if (!todoWindow || todoWindow.isDestroyed()) {
      createTodoWindow();
    }

    if (handleWindow && !handleWindow.isDestroyed()) {
      animateWindowBounds(handleWindow, getHandleBounds(false), config.VALIDATION.ANIMATION_DURATION);
      handleWindow.setAlwaysOnTop(true);
    }

    if (todoWindow && !todoWindow.isDestroyed()) {
      if (!todoWindow.isVisible()) {
        const bounds = todoWindow.getBounds();
        const { workArea } = screen.getPrimaryDisplay();
        const isOffscreen =
          bounds.x + bounds.width < workArea.x + 80 ||
          bounds.y + bounds.height < workArea.y + 80 ||
          bounds.x > workArea.x + workArea.width - 80 ||
          bounds.y > workArea.y + workArea.height - 80;

        if (isOffscreen) {
          todoWindow.setBounds(getTodoWindowBounds());
        }
      }
      todoWindow.show();
      todoWindow.moveTop();
      setTimeout(() => todoWindow.focus(), 100);
    }

    sendModuleState();
    if (onTodoPanelOpened) {
      onTodoPanelOpened();
    }
  }

  function openCapturePanel() {
    if (activeModule === 'capture') {
      closeActiveModule();
      return;
    }

    hideDrawerWindowNow();
    if (todoWindow && !todoWindow.isDestroyed()) {
      todoWindow.hide();
    }

    activeModule = 'capture';
    if (handleWindow && !handleWindow.isDestroyed()) {
      animateWindowBounds(handleWindow, getHandleBounds(false), config.VALIDATION.ANIMATION_DURATION);
      handleWindow.setAlwaysOnTop(true);
    }

    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.setBounds(getCaptureWindowBounds());
      captureWindow.show();
      captureWindow.focus();
      captureWindow.webContents.send('capture-opened', {
        clipboardText: clipboard.readText()
      });
    }

    sendModuleState();
  }

  function closeActiveModule() {
    const closingModule = activeModule;

    if (closingModule === 'files') {
      applyDrawerBounds(false);
      return;
    }

    activeModule = null;
    isDrawerExpanded = false;

    if (closingModule === 'todos' && todoWindow && !todoWindow.isDestroyed()) {
      todoWindow.hide();
    }

    if (closingModule === 'capture' && captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.hide();
    }

    if (handleWindow && !handleWindow.isDestroyed()) {
      animateWindowBounds(handleWindow, getHandleBounds(false), config.VALIDATION.ANIMATION_DURATION);
      handleWindow.setAlwaysOnTop(true);
    }

    sendModuleState();
  }

  function openAppPicker(targetFolder) {
    appPickerTargetFolder = targetFolder;

    if (!appPickerWindow || appPickerWindow.isDestroyed()) {
      createAppPickerWindow();
    } else {
      appPickerWindow.show();
      appPickerWindow.focus();
    }

    if (appPickerWindow && !appPickerWindow.isDestroyed()) {
      const sendTargetFolder = () => {
        if (appPickerWindow && !appPickerWindow.isDestroyed()) {
          appPickerWindow.webContents.send('set-target-folder', targetFolder);
        }
      };

      if (appPickerWindow.webContents.isLoading()) {
        appPickerWindow.webContents.once('did-finish-load', sendTargetFolder);
      } else {
        sendTargetFolder();
      }
    }
  }

  function closeAppPicker() {
    if (appPickerWindow && !appPickerWindow.isDestroyed()) {
      appPickerWindow.close();
    }
    appPickerTargetFolder = null;
  }

  function closeAll() {
    captureWindow?.close();
    todoWindow?.close();
    drawerWindow?.close();
    handleWindow?.close();
  }

  function minimizeAll() {
    captureWindow?.minimize();
    todoWindow?.minimize();
    drawerWindow?.minimize();
    handleWindow?.minimize();
  }

  function toggleFiles() {
    applyDrawerBounds(activeModule === 'files' ? false : true);
  }

  function toggleDrawer() {
    applyDrawerBounds(!isDrawerExpanded);
  }

  function hasWindows() {
    return BrowserWindow.getAllWindows().length > 0;
  }

  function getAuxiliaryWindows() {
    return [todoWindow, captureWindow];
  }

  return {
    createWindows,
    hasWindows,
    getWindow,
    getAuxiliaryWindows,
    sendTo,
    sendToMany,
    expandDrawer: () => applyDrawerBounds(true),
    collapseDrawer: () => applyDrawerBounds(false),
    toggleDrawer,
    toggleFiles,
    openTodoPanel,
    openCapturePanel,
    closeActiveModule,
    openAppPicker,
    closeAppPicker,
    closeAll,
    minimizeAll,
    getAppPickerTarget: () => appPickerTargetFolder,
    getHandleWindow: () => handleWindow,
    getDrawerWindow: () => drawerWindow,
    getState: () => ({
      expanded: isDrawerExpanded,
      activeModule
    })
  };
}

module.exports = createWindowService;
