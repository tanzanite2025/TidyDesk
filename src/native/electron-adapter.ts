import { getTidyDeskApi } from './tidydesk-client';
import type { NativeClient } from './types';
import type { TidyDeskAPI } from '../types/tidydesk-api';

function requireApi(api: TidyDeskAPI | null): TidyDeskAPI {
  if (!api) {
    throw new Error('TidyDesk native API is not available');
  }
  return api;
}

export function createElectronNativeClient(): NativeClient {
  const getApi = () => getTidyDeskApi();

  return {
    isAvailable: () => Boolean(getApi()),
    files: {
      readDesktopFiles: () => requireApi(getApi()).readDesktopFiles(),
      importExternalFiles: payload => requireApi(getApi()).importExternalFiles(payload),
      open: filePath => requireApi(getApi()).openFile(filePath),
      restoreToDesktop: payload => requireApi(getApi()).restoreToDesktop(payload)
    },
    drawers: {
      create: name => requireApi(getApi()).createDrawer(name),
      renameItem: payload => requireApi(getApi()).renameItem(payload),
      deleteItem: payload => requireApi(getApi()).deleteItem(payload)
    },
    shortcuts: {
      validateAll: () => requireApi(getApi()).validateAllShortcuts(),
      repair: payload => requireApi(getApi()).repairShortcut(payload),
      onTargetFileDeleted: callback => getApi()?.onTargetFileDeleted(callback),
      onTargetFileRestored: callback => getApi()?.onTargetFileRestored(callback),
      onValidated: callback => getApi()?.onShortcutsValidated(callback)
    },
    todos: {
      readState: () => requireApi(getApi()).readTodoState(),
      getCounts: () => requireApi(getApi()).getTodoCounts(),
      createCard: payload => requireApi(getApi()).createTodoCard(payload),
      updateCard: payload => requireApi(getApi()).updateTodoCard(payload),
      deleteCard: cardId => requireApi(getApi()).deleteTodoCard(cardId),
      moveCard: payload => requireApi(getApi()).moveTodoCard(payload),
      onCountsUpdated: callback => getApi()?.onTodoCountsUpdated(callback)
    },
    apps: {
      scanInstalled: () => requireApi(getApi()).scanInstalledApps(),
      refresh: () => requireApi(getApi()).refreshApps(),
      getCacheInfo: () => requireApi(getApi()).getCacheInfo(),
      openPicker: payload => requireApi(getApi()).openAppPicker(payload),
      closePicker: () => requireApi(getApi()).closeAppPicker(),
      getPickerTarget: () => requireApi(getApi()).getAppPickerTarget(),
      onSetTargetFolder: callback => getApi()?.onSetTargetFolder(callback),
      addToDrawer: payload => requireApi(getApi()).addAppToDrawer(payload)
    },
    windows: {
      control: action => requireApi(getApi()).windowControl(action),
      getPathForFile: file => requireApi(getApi()).getPathForFile(file),
      onDrawerState: callback => getApi()?.onDrawerState(callback),
      onModuleState: callback => getApi()?.onModuleState(callback)
    },
    clipboard: {
      readText: () => requireApi(getApi()).getClipboardText()
    },
    capture: {
      onOpened: callback => getApi()?.onCaptureOpened(callback),
      completeSnipSelection: rect => requireApi(getApi()).completeSnipSelection(rect),
      cancelSnip: () => requireApi(getApi()).cancelSnip()
    },
    stickers: {
      get: stickerId => requireApi(getApi()).getSticker(stickerId),
      togglePin: stickerId => requireApi(getApi()).toggleStickerPin(stickerId),
      copy: stickerId => requireApi(getApi()).copySticker(stickerId),
      saveAs: stickerId => requireApi(getApi()).saveStickerAs(stickerId),
      close: stickerId => requireApi(getApi()).closeSticker(stickerId),
      onUpdated: callback => getApi()?.onStickerUpdated(callback)
    },
    updates: {
      getAppVersion: () => requireApi(getApi()).getAppVersion(),
      checkForUpdates: () => requireApi(getApi()).checkForUpdates(),
      downloadUpdate: () => requireApi(getApi()).downloadUpdate(),
      installUpdate: () => requireApi(getApi()).installUpdate(),
      onStatus: callback => getApi()?.onUpdateStatus(callback)
    },
    events: {
      send: channel => requireApi(getApi()).send(channel)
    }
  };
}
