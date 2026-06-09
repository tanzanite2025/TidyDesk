async function withMatchingWindow(match) {
  const handles = await browser.getWindowHandles();
  for (const handle of handles) {
    await browser.switchToWindow(handle);
    const url = await browser.getUrl();
    if (await match({ handle, url })) {
      return handle;
    }
  }
  return null;
}

export async function switchToWindowByUrlFragment(fragment, timeout = 20000) {
  await browser.waitUntil(async () => {
    const handle = await withMatchingWindow(({ url }) => url.includes(fragment));
    return Boolean(handle);
  }, {
    timeout,
    interval: 300,
    timeoutMsg: `Timed out waiting for window URL containing "${fragment}"`,
  });

  const handle = await withMatchingWindow(({ url }) => url.includes(fragment));
  if (handle) {
    return handle;
  }
  throw new Error(`Window URL fragment not found: ${fragment}`);
}

export async function switchToWindowBySelector(selector, timeout = 20000) {
  await browser.waitUntil(async () => {
    const handle = await withMatchingWindow(async () => {
      const element = await $(selector);
      return element.isExisting();
    });
    return Boolean(handle);
  }, {
    timeout,
    interval: 300,
    timeoutMsg: `Timed out waiting for selector "${selector}" in any window`,
  });

  const handle = await withMatchingWindow(async () => {
    const element = await $(selector);
    return element.isExisting();
  });
  if (handle) {
    return handle;
  }

  throw new Error(`Selector not found in any window: ${selector}`);
}

export async function waitForWindowToCloseByUrlFragment(fragment) {
  await browser.waitUntil(async () => {
    const handle = await withMatchingWindow(({ url }) => url.includes(fragment));
    return !handle;
  }, {
    timeout: 20000,
    interval: 300,
    timeoutMsg: `Timed out waiting for window URL containing "${fragment}" to close`,
  });
}
