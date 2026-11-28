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
    await switchToWindowBySelector('[data-testid="rail-todos"]', 5000);
    return;
  } catch {}

  await switchToWindowWithTestBridge();
  await waitForSnapshot(
    snapshot => snapshot.windows.handle.exists,
    'Timed out waiting for the handle window to become available',
  );
  await switchToWindowBySelector('[data-testid="rail-todos"]');
}

async function resetWindowState() {
  await ensureHandleWindow();
  await runTestBridge('resetWindowState');
  await waitForSnapshot(
    snapshot =>
      snapshot.shell.expanded === false &&
      snapshot.shell.activeModule == null &&
      snapshot.windows.handle.visible === true &&
      snapshot.windows.handle.alwaysOnTop === true &&
      snapshot.windows.snip.exists === false &&
      snapshot.windows.todos.visible === false &&
      snapshot.windows.capture.visible === false &&
      snapshot.windows.settings.visible === false,
    'Timed out waiting for the baseline always-on-top handle window state',
  );
  await switchToWindowBySelector('[data-testid="rail-todos"]');
}

describe('TidyDesk multi-window smoke', () => {
  beforeEach(async () => {
    await resetWindowState();
  });

  it('opens and closes the todo window while keeping the handle always on top', async () => {
    await switchToWindowBySelector('[data-testid="rail-todos"]');
    await $('[data-testid="rail-todos"]').click();

    await waitForSnapshot(
      snapshot =>
        snapshot.shell.activeModule === 'todos' &&
        snapshot.windows.todos.visible === true &&
        snapshot.windows.handle.alwaysOnTop === true &&
        String(snapshot.windows.todos.url || '').includes('mode=todos'),
      'Timed out waiting for the todo window to open',
    );

    await switchToWindowByUrlFragment('mode=todos');
    await expect($('[data-testid="todo-close"]')).toBeDisplayed();
    await $('[data-testid="todo-close"]').click();

    await waitForSnapshot(
      snapshot =>
        snapshot.shell.activeModule == null &&
        snapshot.windows.handle.visible === true &&
        snapshot.windows.handle.alwaysOnTop === true &&
        snapshot.windows.todos.visible === false,
      'Timed out waiting for the todo window to close',
    );
  });

  it('opens and closes the standalone settings window cleanly', async () => {
    await switchToWindowBySelector('[data-testid="rail-settings"]');
    await $('[data-testid="rail-settings"]').click();

    await waitForSnapshot(
      snapshot =>
        snapshot.shell.activeModule === 'settings' &&
        snapshot.windows.settings.visible === true &&
        snapshot.windows.handle.alwaysOnTop === true &&
        String(snapshot.windows.settings.url || '').includes('mode=settings'),
      'Timed out waiting for the settings window to open',
    );

    await switchToWindowByUrlFragment('mode=settings');
    await expect($('[data-testid="settings-close"]')).toBeDisplayed();
    await $('[data-testid="settings-close"]').click();

    await waitForSnapshot(
      snapshot =>
        snapshot.shell.activeModule == null &&
        snapshot.windows.handle.visible === true &&
        snapshot.windows.handle.alwaysOnTop === true &&
        snapshot.windows.settings.visible === false,
      'Timed out waiting for the settings window to close',
    );
  });

  it('cancels the snip overlay and keeps the handle responsive and on top', async () => {
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
        snapshot.windows.handle.visible === true &&
        snapshot.windows.handle.alwaysOnTop === true,
      'Timed out waiting for the snip overlay to close cleanly',
    );
  });
});
