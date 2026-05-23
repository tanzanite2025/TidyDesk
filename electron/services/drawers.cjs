const createDrawerStorage = require('./drawers/storage.cjs');
const createShortcutService = require('./drawers/shortcuts.cjs');
const createDrawerWatcher = require('./drawers/watcher.cjs');

function createDrawerService({ app, shell, config, notifyDrawer = () => {} }) {
  const storage = createDrawerStorage({ app, shell, config });
  const shortcuts = createShortcutService({ shell, config, storage });
  const watcher = createDrawerWatcher({
    config,
    notifyDrawer,
    validateAllShortcuts: shortcuts.validateAllShortcuts
  });

  storage.setRuntimeServices({ shortcuts, watcher });

  function cleanup() {
    watcher.cleanup();
  }

  return {
    getFileStorageRoot: storage.getFileStorageRoot,
    getDesktopPath: storage.getDesktopPath,
    getDrawerRoot: storage.getDrawerRoot,
    isPathInside: storage.isPathInside,
    resolveDrawerPath: storage.resolveDrawerPath,
    prepareStorage: storage.prepareStorage,

    initializeFileWatcher: watcher.initializeFileWatcher,
    startPeriodicValidation: watcher.startPeriodicValidation,
    stopPeriodicValidation: watcher.stopPeriodicValidation,
    cleanup,

    readDesktopFiles: storage.readDesktopFiles,
    createDesktopFolder: storage.createDesktopFolder,
    renameDesktopItem: storage.renameDesktopItem,
    deleteDesktopItem: storage.deleteDesktopItem,
    importExternalFiles: storage.importExternalFiles,
    openDesktopFile: storage.openDesktopFile,
    restoreToDesktop: storage.restoreToDesktop,
    addAppToDrawer: storage.addAppToDrawer,

    validateAllShortcuts: shortcuts.validateAllShortcuts,
    repairShortcut: shortcuts.repairShortcut,
    createDrawerShortcut: shortcuts.createDrawerShortcut,
    removeFileFromWatch: watcher.removeFileFromWatch
  };
}

module.exports = createDrawerService;
