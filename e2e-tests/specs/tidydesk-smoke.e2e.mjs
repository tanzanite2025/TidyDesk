import {
  switchToWindowBySelector,
  switchToWindowByUrlFragment,
} from './helpers/windows.mjs';

async function runTestBridge(command, ...args) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        method => typeof window.__TIDYDESK_TEST__?.[method] === 'function',
        command,
      ),
    {
      timeout: 20000,
      interval: 300,
      timeoutMsg: `Timed out waiting for test bridge method "${command}"`,
    },
  );

  const response = await browser.executeAsync(
    ({ method, values }, done) => {
      Promise.resolve(window.__TIDYDESK_TEST__[method](...values))
        .then(result => done({ ok: true, result }))
        .catch(error =>
          done({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    { method: command, values: args },
  );

  if (!response?.ok) {
    throw new Error(`Test bridge command "${command}" failed: ${response?.error || 'unknown error'}`);
  }

  return response.result;
}

async function getWindowSnapshot() {
  return runTestBridge('getWindowSnapshot');
}

async function waitForSnapshot(match, timeoutMsg) {
  let latestSnapshot;

  await browser.waitUntil(async () => {
    latestSnapshot = await getWindowSnapshot();
    return match(latestSnapshot);
  }, {
    timeout: 20000,
    interval: 300,
    timeoutMsg,
  });

  return latestSnapshot;
}

async function switchToWindowWithTestBridge() {
  await browser.waitUntil(async () => {
    const handles = await browser.getWindowHandles();
    for (const handle of handles) {
      await browser.switchToWindow(handle);
      const hasBridge = await browser.execute(
        () => typeof window.__TIDYDESK_TEST__?.resetWindowState === 'function',
      );
      if (hasBridge) {
        return true;
      }
    }
    return false;
  }, {
    timeout: 20000,
    interval: 300,
    timeoutMsg: 'Timed out waiting for a TidyDesk window with the test bridge',
  });

  const handles = await browser.getWindowHandles();
  for (const handle of handles) {
    await browser.switchToWindow(handle);
    const hasBridge = await browser.execute(
      () => typeof window.__TIDYDESK_TEST__?.resetWindowState === 'function',
    );
    if (hasBridge) {
      return;
    }
  }
}

async function ensureHandleWindow() {
  try {
    await switchToWindowBySelector('[data-testid="rail-files"]', 5000);
    return;
  } catch {}

  await switchToWindowWithTestBridge();
  await waitForSnapshot(
    snapshot => snapshot.windows.handle.exists,
    'Timed out waiting for the handle window to become available',
  );
  await switchToWindowBySelector('[data-testid="rail-files"]');
}

async function resetWindowState() {
  await ensureHandleWindow();
  await runTestBridge('resetWindowState');
  await waitForSnapshot(
    snapshot =>
      snapshot.shell.expanded === false &&
      snapshot.shell.activeModule == null &&
      snapshot.windows.handle.visible === true &&
      snapshot.windows.main.visible === false &&
      snapshot.windows.snip.exists === false &&
      snapshot.windows.appPicker.exists === false &&
      snapshot.windows.todos.visible === false,
    'Timed out waiting for the baseline handle-only window state',
  );
  await switchToWindowBySelector('[data-testid="rail-files"]');
}

async function openDrawerFromHandle() {
  await switchToWindowBySelector('[data-testid="rail-files"]');
  await $('[data-testid="rail-files"]').click();

  await waitForSnapshot(
    snapshot =>
      snapshot.shell.expanded === true &&
      snapshot.shell.activeModule === 'files' &&
      snapshot.windows.main.visible === true &&
      String(snapshot.windows.main.url || '').includes('mode=drawer'),
    'Timed out waiting for the drawer window to open',
  );

  await switchToWindowByUrlFragment('mode=drawer');
  await expect($('[data-testid="drawer-collapse"]')).toBeDisplayed();
}

async function collapseDrawer() {
  await switchToWindowByUrlFragment('mode=drawer');
  await $('[data-testid="drawer-collapse"]').click();
  await waitForSnapshot(
    snapshot =>
      snapshot.shell.expanded === false &&
      snapshot.windows.handle.visible === true &&
      snapshot.windows.main.visible === false,
    'Timed out waiting for the drawer window to collapse',
  );
  await switchToWindowBySelector('[data-testid="rail-files"]');
}

describe('TidyDesk multi-window smoke', () => {
  beforeEach(async () => {
    await resetWindowState();
  });

  it('opens and closes the drawer from the handle rail', async () => {
    await openDrawerFromHandle();
    await collapseDrawer();
    await expect($('[data-testid="rail-files"]')).toBeDisplayed();
  });

  it('opens and closes the todo window cleanly', async () => {
    await switchToWindowBySelector('[data-testid="rail-todos"]');
    await $('[data-testid="rail-todos"]').click();

    await waitForSnapshot(
      snapshot =>
        snapshot.shell.expanded === false &&
        snapshot.shell.activeModule === 'todos' &&
        snapshot.windows.todos.visible === true &&
        String(snapshot.windows.todos.url || '').includes('mode=tauri-todos'),
      'Timed out waiting for the todo window to open',
    );

    await switchToWindowByUrlFragment('mode=tauri-todos');
    await expect($('[data-testid="todo-close"]')).toBeDisplayed();
    await $('[data-testid="todo-close"]').click();

    await waitForSnapshot(
      snapshot =>
        snapshot.shell.expanded === false &&
        snapshot.shell.activeModule == null &&
        snapshot.windows.handle.visible === true &&
        snapshot.windows.todos.visible === false,
      'Timed out waiting for the todo window to close',
    );

    await switchToWindowBySelector('[data-testid="rail-files"]');
    await expect($('[data-testid="rail-files"]')).toBeDisplayed();
  });

  it('recovers back to the drawer after app picker closes', async () => {
    await openDrawerFromHandle();
    await runTestBridge('openAppPicker', { targetFolder: 'Smoke Drawer' });

    await waitForSnapshot(
      snapshot =>
        snapshot.windows.appPicker.visible === true &&
        String(snapshot.windows.appPicker.url || '').includes('mode=app-picker'),
      'Timed out waiting for the app picker window to open',
    );

    await switchToWindowBySelector('[data-testid="app-picker-close"]');
    await expect($('[data-testid="app-picker-close"]')).toBeDisplayed();
    await $('[data-testid="app-picker-close"]').click();

    await waitForSnapshot(
      snapshot =>
        snapshot.windows.appPicker.exists === false &&
        snapshot.shell.expanded === true &&
        snapshot.windows.main.visible === true,
      'Timed out waiting for the app picker to close and the drawer to recover',
    );

    await collapseDrawer();
  });

  it('cancels the snip overlay and keeps the handle responsive', async () => {
    await switchToWindowBySelector('[data-testid="rail-screenshot"]');
    await $('[data-testid="rail-screenshot"]').click();

    await waitForSnapshot(
      snapshot =>
        snapshot.windows.snip.visible === true &&
        String(snapshot.windows.snip.url || '').includes('mode=snip'),
      'Timed out waiting for the snip overlay to open',
    );

    await switchToWindowByUrlFragment('mode=snip');
    await expect($('[data-testid="snip-overlay-root"]')).toBeDisplayed();
    await browser.keys('Escape');

    await waitForSnapshot(
      snapshot =>
        snapshot.windows.snip.exists === false &&
        snapshot.shell.expanded === false &&
        snapshot.windows.handle.visible === true,
      'Timed out waiting for the snip overlay to close cleanly',
    );

    await openDrawerFromHandle();
    await collapseDrawer();
  });
});
