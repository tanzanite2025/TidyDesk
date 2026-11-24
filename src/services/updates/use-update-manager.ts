import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nativeClient } from '../../native/native-client';
import type { UpdateMetadata, UpdateSnapshot } from '../../types/update';
import {
  createCheckingUpdateSnapshot,
  createDownloadingUpdateSnapshot,
  createErrorUpdateSnapshot,
  createInstallingUpdateSnapshot,
  isActionableUpdateSnapshot
} from '../../types/update';

interface UpdateManagerState {
  metadata: UpdateMetadata | null;
  snapshot: UpdateSnapshot | null;
}

/**
 * Manages desktop auto-update lifecycle, optimistic pending transitions,
 * real-time backend snapshot events, and download cancellation.
 */
export function useUpdateManager() {
  const [{ metadata, snapshot }, setState] = useState<UpdateManagerState>({
    metadata: null,
    snapshot: null
  });
  const metadataRef = useRef<UpdateMetadata | null>(null);
  const snapshotRef = useRef<UpdateSnapshot | null>(null);
  const eventReceivedRef = useRef(false);

  const commitState = useCallback(
    (updater: (current: UpdateManagerState) => UpdateManagerState) => {
      setState(current => {
        const next = updater(current);
        metadataRef.current = next.metadata;
        snapshotRef.current = next.snapshot;
        return next;
      });
    },
    []
  );

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      try {
        const nextMetadata = await nativeClient.updates.getMetadata();
        const nextSnapshot = await nativeClient.updates.getState().catch(err => (
          createErrorUpdateSnapshot(nextMetadata, err instanceof Error ? err.message : String(err))
        ));

        if (disposed) return;
        commitState(current => ({
          metadata: nextMetadata,
          snapshot: eventReceivedRef.current && current.snapshot ? current.snapshot : nextSnapshot
        }));
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
        commitState(() => ({
          metadata: fallbackMetadata,
          snapshot: createErrorUpdateSnapshot(
            fallbackMetadata,
            err instanceof Error ? err.message : String(err)
          )
        }));
      }
    };

    const unsubscribe = nativeClient.updates.onChange(payload => {
      if (disposed) return;
      eventReceivedRef.current = true;
      commitState(current => ({
        metadata: current.metadata,
        snapshot: payload
      }));
    });

    void load();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [commitState]);

  const runWithPendingState = useCallback(
    async (
      pendingFactory: ((current: UpdateSnapshot) => UpdateSnapshot) | null,
      executor: () => Promise<UpdateSnapshot>
    ) => {
      const currentMetadata = metadataRef.current;
      const currentSnapshot = snapshotRef.current;
      if (!currentMetadata || !currentSnapshot) return;

      if (pendingFactory) {
        commitState(current => ({
          metadata: current.metadata,
          snapshot: current.snapshot ? pendingFactory(current.snapshot) : current.snapshot
        }));
      }

      try {
        const nextSnapshot = await executor();
        commitState(current => ({
          metadata: current.metadata,
          snapshot: nextSnapshot
        }));
      } catch (err) {
        commitState(current => ({
          metadata: current.metadata,
          snapshot: createErrorUpdateSnapshot(
            current.metadata ?? currentMetadata,
            err instanceof Error ? err.message : String(err),
            current.snapshot ?? currentSnapshot
          )
        }));
      }
    },
    [commitState]
  );

  const checkForUpdates = useCallback(async () => {
    await runWithPendingState(
      current => createCheckingUpdateSnapshot(current),
      () => nativeClient.updates.check()
    );
  }, [runWithPendingState]);

  const downloadUpdate = useCallback(async () => {
    await runWithPendingState(
      current => createDownloadingUpdateSnapshot(current),
      () => nativeClient.updates.download()
    );
  }, [runWithPendingState]);

  const cancelDownload = useCallback(async () => {
    const cancelFn = nativeClient.updates.cancelDownload;
    if (!cancelFn) return;
    await runWithPendingState(null, () => cancelFn());
  }, [runWithPendingState]);

  const installUpdate = useCallback(async () => {
    await runWithPendingState(
      current => createInstallingUpdateSnapshot(current),
      () => nativeClient.updates.install()
    );
  }, [runWithPendingState]);

  return useMemo(
    () => ({
      metadata,
      snapshot,
      isReady: Boolean(metadata && snapshot),
      isChecking: snapshot?.state === 'checking',
      isDownloading: snapshot?.state === 'downloading',
      isInstalling: snapshot?.state === 'installing',
      hasActionableUpdate: isActionableUpdateSnapshot(snapshot),
      checkForUpdates,
      downloadUpdate,
      cancelDownload,
      installUpdate
    }),
    [cancelDownload, checkForUpdates, downloadUpdate, installUpdate, metadata, snapshot]
  );
}
