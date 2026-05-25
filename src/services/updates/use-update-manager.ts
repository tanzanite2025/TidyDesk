import { useCallback, useEffect, useMemo, useState } from 'react';
import { nativeClient } from '../../native/native-client';
import type { UpdateMetadata, UpdateSnapshot } from '../../types/update';
import {
  createCheckingUpdateSnapshot,
  createDownloadingUpdateSnapshot,
  createErrorUpdateSnapshot,
  createInstallingUpdateSnapshot
} from '../../types/update';

const nativeApi = nativeClient;

interface UpdateManagerState {
  metadata: UpdateMetadata | null;
  snapshot: UpdateSnapshot | null;
}

export function useUpdateManager() {
  const [{ metadata, snapshot }, setState] = useState<UpdateManagerState>({
    metadata: null,
    snapshot: null
  });

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      try {
        const nextMetadata = await nativeApi.updates.getMetadata();
        const nextSnapshot = await nativeApi.updates.getState().catch(err => (
          createErrorUpdateSnapshot(nextMetadata, err instanceof Error ? err.message : String(err))
        ));

        if (disposed) return;
        setState({
          metadata: nextMetadata,
          snapshot: nextSnapshot
        });
      } catch (err) {
        if (disposed) return;
        const fallbackMetadata: UpdateMetadata = {
          name: 'TidyDesk',
          version: 'unknown',
          isPackaged: false,
          runtime: 'tauri',
          channel: 'stable',
          updaterAvailable: false
        };
        setState({
          metadata: fallbackMetadata,
          snapshot: createErrorUpdateSnapshot(
            fallbackMetadata,
            err instanceof Error ? err.message : String(err)
          )
        });
      }
    };

    const unsubscribe = nativeApi.updates.onChange(payload => {
      if (disposed) return;
      setState(current => ({
        metadata: current.metadata,
        snapshot: payload
      }));
    });

    void load();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const runWithPendingState = useCallback(
    async (
      pendingFactory: (current: UpdateSnapshot) => UpdateSnapshot,
      executor: () => Promise<UpdateSnapshot>
    ) => {
      if (!metadata || !snapshot) return;

      setState(current => ({
        metadata: current.metadata,
        snapshot: current.snapshot ? pendingFactory(current.snapshot) : current.snapshot
      }));

      try {
        const nextSnapshot = await executor();
        setState(current => ({
          metadata: current.metadata,
          snapshot: nextSnapshot
        }));
      } catch (err) {
        setState(current => ({
          metadata: current.metadata,
          snapshot: createErrorUpdateSnapshot(
            metadata,
            err instanceof Error ? err.message : String(err)
          )
        }));
      }
    },
    [metadata, snapshot]
  );

  const checkForUpdates = useCallback(async () => {
    await runWithPendingState(
      current => createCheckingUpdateSnapshot(current),
      () => nativeApi.updates.check()
    );
  }, [runWithPendingState]);

  const downloadUpdate = useCallback(async () => {
    await runWithPendingState(
      current => createDownloadingUpdateSnapshot(current),
      () => nativeApi.updates.download()
    );
  }, [runWithPendingState]);

  const installUpdate = useCallback(async () => {
    await runWithPendingState(
      current => createInstallingUpdateSnapshot(current),
      () => nativeApi.updates.install()
    );
  }, [runWithPendingState]);

  return useMemo(
    () => ({
      metadata,
      snapshot,
      isReady: Boolean(metadata && snapshot),
      isChecking: snapshot?.state === 'checking',
      isDownloading: snapshot?.state === 'downloading',
      checkForUpdates,
      downloadUpdate,
      installUpdate
    }),
    [checkForUpdates, downloadUpdate, installUpdate, metadata, snapshot]
  );
}
