import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, FolderDown, LogOut, RefreshCw, Trash2, UserCheck } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { AccountSessionSnapshot, SyncStatusSnapshot } from '../../types/todo';

/**
 * Settings card managing optional multi-account workspace isolation and pluggable sync readiness
 * without impacting default zero-login local usage.
 */
export const AccountSyncCard: React.FC = () => {
  const [session, setSession] = useState<AccountSessionSnapshot | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot | null>(null);
  const [userIdInput, setUserIdInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [endpointInput, setEndpointInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [editingEndpoint, setEditingEndpoint] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadAccountAndSync = useCallback(async () => {
    if (!nativeClient.isAvailable()) return;
    try {
      const [nextSession, nextSync] = await Promise.all([
        nativeClient.accounts.getSession(),
        nativeClient.sync.getStatus()
      ]);
      setSession(nextSession);
      setSyncStatus(nextSync);
      setError('');
    } catch (err) {
      setError(`读取账号与同步状态失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    void loadAccountAndSync();
    if (!nativeClient.isAvailable()) return undefined;
    const unsubs = [
      nativeClient.accounts.onSessionChanged(() => {
        void loadAccountAndSync();
      }),
      nativeClient.todos.onUpdated(() => {
        void loadAccountAndSync();
      }),
      nativeClient.sync.onRealtimeApplied?.(() => {
        void loadAccountAndSync();
      })
    ].filter((fn): fn is () => void => typeof fn === 'function');
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [loadAccountAndSync]);

  const handleSwitchAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nativeClient.isAvailable()) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const nextSession = await nativeClient.accounts.switchSession({
        userId: userIdInput,
        displayName: displayNameInput || undefined,
        serverEndpoint: endpointInput || undefined,
        token: tokenInput || undefined
      });
      setSession(nextSession);
      setSyncStatus(await nativeClient.sync.getStatus());
      setNotice(`已切换至账号工作区：${nextSession.activeUserId}`);
      setTokenInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleLogoutToLocal = async () => {
    if (!nativeClient.isAvailable()) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const nextSession = await nativeClient.accounts.logoutToLocal();
      setSession(nextSession);
      setSyncStatus(await nativeClient.sync.getStatus());
      setNotice('已切回纯本地默认工作区');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleImportLocalTodos = async () => {
    if (!nativeClient.isAvailable()) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const result = await nativeClient.accounts.importLocalTodos();
      setSyncStatus(await nativeClient.sync.getStatus());
      setNotice(`已从本地默认工作区导入 ${result.importedCards} 张待办卡片`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleUpdateEndpointConfig = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nativeClient.isAvailable() || !session?.activeUserId) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const nextSession = await nativeClient.accounts.switchSession({
        userId: session.activeUserId,
        serverEndpoint: endpointInput,
        token: tokenInput || undefined
      });
      setSession(nextSession);
      setSyncStatus(await nativeClient.sync.getStatus());
      setEditingEndpoint(false);
      setTokenInput('');
      setNotice('已保存当前账号云端同步配置');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleSyncNow = async () => {
    if (!nativeClient.isAvailable()) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const [status, nextSession] = await Promise.all([
        nativeClient.sync.runOnce(),
        nativeClient.accounts.getSession()
      ]);
      setSession(nextSession);
      setSyncStatus(status);
      setNotice(status.statusMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleClearOutbox = async () => {
    if (!nativeClient.isAvailable()) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const status = await nativeClient.sync.clearOutbox();
      setSyncStatus(status);
      setNotice(status.statusMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleToggleRealtime = async () => {
    if (!nativeClient.isAvailable() || !nativeClient.sync.setRealtimeEnabled) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const nextEnabled = !syncStatus?.realtimeActive;
      const status = await nativeClient.sync.setRealtimeEnabled(nextEnabled);
      setSyncStatus(status);
      setNotice(status.statusMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const isAccountMode = session?.authMode === 'account';

  return (
    <div className="mb-6">
      <h3 className="mb-3 text-[13px] font-semibold text-slate-200">多账号与云协同底座</h3>
      <div className="space-y-3 rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-100">
              <Cloud size={14} className={isAccountMode ? 'text-sky-300' : 'text-slate-400'} />
              <span>
                {isAccountMode
                  ? `账号工作区：${session?.displayName || session?.activeUserId}`
                  : '当前：纯本地离线模式（无需登录）'}
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-4 text-slate-500">
              {syncStatus?.statusMessage || '支持单机直接离线使用；切换账号时待办与附件按账号目录物理隔离。'}
            </div>
          </div>
          {isAccountMode && (
            <button
              type="button"
              disabled={busyAction}
              onClick={() => void handleLogoutToLocal()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.1] hover:text-white disabled:opacity-50"
            >
              <LogOut size={12} />
              切回本地
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
            {notice}
          </div>
        )}

        {isAccountMode ? (
          <div className="space-y-2.5 rounded-lg border border-white/[0.08] bg-slate-950/35 p-3 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
              <span>账号 ID：<span className="font-mono text-slate-200">{session?.activeUserId}</span></span>
              <span>待同步队列：<span className="font-semibold text-sky-300">{syncStatus?.pendingCount ?? 0}</span> 条</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
              <span className="truncate">
                同步服务端：<span className="text-slate-200">{session?.serverEndpoint || '未配置（仅本地发件箱）'}</span>
              </span>
              {session?.lastSyncCursor && (
                <span className="font-mono text-[10px] text-slate-400">
                  游标 #{session.lastSyncCursor}
                </span>
              )}
            </div>
            {editingEndpoint && (
              <form
                onSubmit={event => void handleUpdateEndpointConfig(event)}
                className="space-y-2 rounded-md border border-white/[0.08] bg-black/25 p-2.5"
              >
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={endpointInput}
                    onChange={event => setEndpointInput(event.target.value)}
                    placeholder="服务端 URL（如 http://127.0.0.1:8787）"
                    className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
                  />
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={event => setTokenInput(event.target.value)}
                    placeholder={session?.hasToken ? '新 Token（留空沿用已存凭据）' : '访问 Token'}
                    className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => setEditingEndpoint(false)}
                    className="rounded px-2 py-1 text-[10px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={busyAction}
                    className="rounded bg-sky-500/25 px-2.5 py-1 text-[10px] font-semibold text-sky-100 hover:bg-sky-500/35 disabled:opacity-50"
                  >
                    保存配置
                  </button>
                </div>
              </form>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleSyncNow()}
                className="inline-flex items-center gap-1 rounded-md bg-sky-500/20 px-2.5 py-1.5 font-semibold text-sky-100 hover:bg-sky-500/30 disabled:opacity-50"
              >
                <RefreshCw size={12} className={busyAction ? 'animate-spin' : ''} />
                {session?.serverEndpoint ? '立即云端同步' : '同步检查'}
              </button>
              {session?.serverEndpoint && nativeClient.sync.setRealtimeEnabled && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleToggleRealtime()}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-semibold disabled:opacity-50 ${
                    syncStatus?.realtimeActive
                      ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                      : 'border-white/[0.08] bg-white/[0.05] text-slate-200 hover:bg-white/[0.1]'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      syncStatus?.realtimeActive ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'
                    }`}
                  />
                  {syncStatus?.realtimeActive ? '实时推送已开启' : '开启实时推送'}
                </button>
              )}
              <button
                type="button"
                disabled={busyAction}
                onClick={() => {
                  setEndpointInput(session?.serverEndpoint || '');
                  setTokenInput('');
                  setEditingEndpoint(prev => !prev);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
              >
                配置服务端
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleImportLocalTodos()}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
              >
                <FolderDown size={12} />
                导入单机待办
              </button>
              {(syncStatus?.pendingCount ?? 0) > 0 && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleClearOutbox()}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-400/20 bg-rose-500/10 px-2.5 py-1.5 font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
                >
                  <Trash2 size={12} />
                  清空队列
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={event => void handleSwitchAccount(event)} className="space-y-2 rounded-lg border border-white/[0.08] bg-slate-950/35 p-3">
            <div className="text-[11px] font-semibold text-slate-300">
              切换/测试多账号隔离工作区（可选）
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={userIdInput}
                onChange={event => setUserIdInput(event.target.value)}
                placeholder="账号 ID（如 user_01）"
                className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
              />
              <input
                value={displayNameInput}
                onChange={event => setDisplayNameInput(event.target.value)}
                placeholder="显示名称（可选）"
                className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={endpointInput}
                onChange={event => setEndpointInput(event.target.value)}
                placeholder="预留服务端 URL（可选）"
                className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
              />
              <input
                type="password"
                value={tokenInput}
                onChange={event => setTokenInput(event.target.value)}
                placeholder="Token（填服务端时必填）"
                className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
              />
            </div>
            <button
              type="submit"
              disabled={busyAction || !userIdInput.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/20 px-3 py-1.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/30 disabled:opacity-50"
            >
              <UserCheck size={12} />
              切换至独立账号目录
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
