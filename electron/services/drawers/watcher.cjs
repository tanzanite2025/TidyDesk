const fs = require('fs');
const chokidar = require('chokidar');

function createDrawerWatcher({ config, notifyDrawer = () => {}, validateAllShortcuts }) {
  let fileWatcher = null;
  let watcherCleanupInterval = null;
  let validationInterval = null;
  const watchedTargets = new Map();

  function initializeFileWatcher() {
    if (fileWatcher) {
      fileWatcher.close();
    }
    if (watcherCleanupInterval) {
      clearInterval(watcherCleanupInterval);
    }

    fileWatcher = chokidar.watch([], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    fileWatcher
      .on('unlink', (filePath) => {
        console.warn(`[TIDYDESK] Target file deleted: ${filePath}`);
        handleTargetFileDeleted(filePath);
      })
      .on('add', (filePath) => {
        console.log(`[TIDYDESK] Target file appeared: ${filePath}`);
        handleTargetFileRestored(filePath);
      })
      .on('error', (error) => {
        console.error('[TIDYDESK] File watcher error:', error);
      });

    console.log('[TIDYDESK] File watcher initialized');

    watcherCleanupInterval = setInterval(() => {
      cleanupFileWatcher();
    }, 60 * 60 * 1000);

    console.log('[TIDYDESK] File watcher cleanup scheduled (every 1 hour)');
  }

  function cleanupFileWatcher() {
    if (!fileWatcher) return;

    console.log('[TIDYDESK] Running file watcher cleanup...');

    let cleaned = 0;
    const toDelete = [];

    for (const [targetPath, shortcuts] of watchedTargets.entries()) {
      if (shortcuts.size === 0 || !fs.existsSync(targetPath)) {
        toDelete.push(targetPath);
        cleaned++;
      }
    }

    for (const targetPath of toDelete) {
      watchedTargets.delete(targetPath);
      try {
        fileWatcher.unwatch(targetPath);
      } catch (err) {
        console.warn(`[TIDYDESK] Failed to unwatch ${targetPath}:`, err.message);
      }
    }

    console.log(`[TIDYDESK] Cleanup complete: removed ${cleaned} invalid watch targets`);
    console.log(`[TIDYDESK] Currently watching ${watchedTargets.size} files`);
  }

  function addFileToWatch(targetPath, shortcutPath) {
    if (!fileWatcher || !targetPath || !fs.existsSync(targetPath)) return;

    if (!watchedTargets.has(targetPath)) {
      watchedTargets.set(targetPath, new Set());
      fileWatcher.add(targetPath);
      console.log(`[TIDYDESK] Now watching: ${targetPath}`);
    }

    watchedTargets.get(targetPath).add(shortcutPath);
  }

  function removeFileFromWatch(targetPath, shortcutPath) {
    if (!fileWatcher || !watchedTargets.has(targetPath)) return;

    const shortcuts = watchedTargets.get(targetPath);
    shortcuts.delete(shortcutPath);

    if (shortcuts.size === 0) {
      watchedTargets.delete(targetPath);
      fileWatcher.unwatch(targetPath);
      console.log(`[TIDYDESK] Stopped watching: ${targetPath}`);
    }
  }

  function handleTargetFileDeleted(targetPath) {
    const shortcuts = watchedTargets.get(targetPath);
    if (!shortcuts) return;

    notifyDrawer('target-file-deleted', {
      targetPath,
      shortcutCount: shortcuts.size
    });
  }

  function handleTargetFileRestored(targetPath) {
    const shortcuts = watchedTargets.get(targetPath);
    if (!shortcuts) return;

    notifyDrawer('target-file-restored', {
      targetPath,
      shortcutCount: shortcuts.size
    });
  }

  function startPeriodicValidation() {
    if (validationInterval) {
      clearInterval(validationInterval);
    }

    validationInterval = setInterval(async () => {
      console.log('[TIDYDESK] Running periodic validation...');
      const stats = await validateAllShortcuts();

      console.log(`[TIDYDESK] Validation complete: ${stats.valid}/${stats.total} valid, ${stats.repaired} repaired, ${stats.invalid} invalid`);

      if (stats.repaired > 0 || stats.invalid > 0) {
        notifyDrawer('shortcuts-validated', stats);
      }
    }, config.VALIDATION.INTERVAL);

    console.log(`[TIDYDESK] Periodic validation started (every ${config.VALIDATION.INTERVAL / 60000} minutes)`);
  }

  function stopPeriodicValidation() {
    if (validationInterval) {
      clearInterval(validationInterval);
      validationInterval = null;
      console.log('[TIDYDESK] Periodic validation stopped');
    }
  }

  function cleanup() {
    if (fileWatcher) {
      fileWatcher.close();
      fileWatcher = null;
    }

    if (watcherCleanupInterval) {
      clearInterval(watcherCleanupInterval);
      watcherCleanupInterval = null;
    }

    stopPeriodicValidation();
  }

  return {
    initializeFileWatcher,
    cleanupFileWatcher,
    addFileToWatch,
    removeFileFromWatch,
    startPeriodicValidation,
    stopPeriodicValidation,
    cleanup
  };
}

module.exports = createDrawerWatcher;
