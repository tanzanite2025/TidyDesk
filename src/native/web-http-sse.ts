import type { TodoState } from '../types/todo';
import type { WebHttpContext } from './web-http-context';
import { parseSseSyncCursor } from './web-http-helpers';

export interface WebSseController {
  start: () => void;
  stop: () => void;
}

export function createWebSseController(
  ctx: WebHttpContext,
  pullLatest: () => Promise<TodoState>
): WebSseController {
  let realtimeAbort: AbortController | null = null;
  let realtimeGeneration = 0;
  let visibilityCleanup: (() => void) | null = null;
  let wakeupReconnect: (() => void) | null = null;

  const stop = () => {
    realtimeGeneration += 1;
    if (visibilityCleanup) {
      visibilityCleanup();
      visibilityCleanup = null;
    }
    if (realtimeAbort) {
      realtimeAbort.abort();
      realtimeAbort = null;
    }
    if (wakeupReconnect) {
      wakeupReconnect();
      wakeupReconnect = null;
    }
  };

  const start = () => {
    stop();
    const initialSession = ctx.getSession();
    if (!initialSession || !ctx.isRealtimeEnabled()) return;
    const myGen = realtimeGeneration;

    if (typeof document !== 'undefined') {
      const handleVisibility = () => {
        if (
          document.visibilityState === 'visible' &&
          ctx.getSession() &&
          ctx.isRealtimeEnabled() &&
          realtimeGeneration === myGen
        ) {
          void pullLatest().catch(err =>
            console.warn('[TIDYDESK][MOBILE] Foreground catch-up pull error:', err)
          );
          wakeupReconnect?.();
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);
      visibilityCleanup = () => document.removeEventListener('visibilitychange', handleVisibility);
    }

    const backoffMsList = [2000, 4000, 8000, 15000, 30000];
    void (async () => {
      let attempt = 0;
      while (ctx.getSession() && ctx.isRealtimeEnabled() && realtimeGeneration === myGen) {
        const active = ctx.getSession();
        if (!active) break;
        const controller = new AbortController();
        realtimeAbort = controller;
        try {
          const wsId = ctx.resolveWorkspaceId(active);
          const res = await fetch(
            `${active.serverEndpoint}/api/v1/sync/events?workspaceId=${encodeURIComponent(wsId)}`,
            { headers: ctx.authHeaders(active), signal: controller.signal }
          );
          if (res.ok && res.body) {
            attempt = 0;
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (!controller.signal.aborted && realtimeGeneration === myGen) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const frames = buffer.split(/\r?\n\r?\n/);
              buffer = frames.pop() || '';
              for (const frame of frames) {
                if (!frame.includes('event: sync-changed')) continue;
                const remoteCursor = parseSseSyncCursor(frame);
                if (remoteCursor && ctx.getSession()?.lastSyncCursor === remoteCursor) {
                  continue;
                }
                await pullLatest()
                  .then(nextState => {
                    for (const cb of ctx.realtimeListeners) {
                      cb({
                        pulledCards: nextState.cards.length,
                        pulledNotes: ctx.quickNotesById.size,
                        cursor: ctx.getSession()?.lastSyncCursor || ''
                      });
                    }
                  })
                  .catch(err =>
                    console.warn('[TIDYDESK][MOBILE] Realtime pull error:', err)
                  );
              }
            }
          } else if (!controller.signal.aborted) {
            console.warn(`[TIDYDESK][MOBILE] SSE endpoint returned status ${res.status}`);
            if (res.status === 401 || res.status === 403) {
              ctx.setRealtimeEnabledFlag(false);
              stop();
              break;
            }
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            console.warn('[TIDYDESK][MOBILE] SSE disconnected:', err);
          }
        }

        if (!ctx.getSession() || !ctx.isRealtimeEnabled() || realtimeGeneration !== myGen) {
          break;
        }
        const delayMs = backoffMsList[Math.min(attempt, backoffMsList.length - 1)];
        attempt += 1;
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => {
            wakeupReconnect = null;
            resolve();
          }, delayMs);
          wakeupReconnect = () => {
            clearTimeout(timer);
            wakeupReconnect = null;
            resolve();
          };
        });
      }
    })();
  };

  return { start, stop };
}
