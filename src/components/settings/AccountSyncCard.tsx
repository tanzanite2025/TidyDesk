import React, { useCallback, useEffect, useState } from 'react';
import {
  Cloud,
  FolderDown,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Trash2,
  UserCheck
} from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type {
  AccountSessionSnapshot,
  RemoteAuthSessionInfo,
  SyncStatusSnapshot
} from '../../types/todo';

/**
 * Settings card managing optional multi-account workspace isolation and pluggable sync readiness
 * without impacting default zero-login local usage.
 */
export const AccountSyncCard: React.FC = () => {
  const [session, setSession] = useState<AccountSessionSnapshot | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot | null>(null);
  const [authMethod, setAuthMethod] = useState<'password' | 'token'>('password');
  const [userIdInput, setUserIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [endpointInput, setEndpointInput] = useState('');
  const [workspaceInput, setWorkspaceInput] = useState('default');
  const [tokenInput, setTokenInput] = useState('');
  const [editingEndpoint, setEditingEndpoint] = useState(false);
  const [showSessionsPanel, setShowSessionsPanel] = useState(false);
  const [remoteSessions, setRemoteSessions] = useState<RemoteAuthSessionInfo[]>([]);
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [oldPasswordInput, setOldPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [revokeAllOnPwd, setRevokeAllOnPwd] = useState(false);
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
      const targetWs = workspaceInput.trim() || 'default';
      let nextSession: AccountSessionSnapshot;
      if (authMethod === 'password') {
        if (!nativeClient.accounts.loginWithPassword) {
          throw new Error('当前运行环境不支持密码登录');
        }
        nextSession = await nativeClient.accounts.loginWithPassword({
          userId: userIdInput,
          password: passwordInput,
          serverEndpoint: endpointInput,
          workspaceId: targetWs,
          deviceLabel: 'TidyDesk Windows'
        });
        setPasswordInput('');
      } else {
        nextSession = await nativeClient.accounts.switchSession({
          userId: userIdInput,
          displayName: displayNameInput || undefined,
          serverEndpoint: endpointInput || undefined,
          workspaceId: targetWs,
          token: tokenInput || undefined
        });
        setTokenInput('');
      }
      setSession(nextSession);
      setSyncStatus(await nativeClient.sync.getStatus());
      setNotice(`已切换至账号工作区：${nextSession.activeUserId}（${nextSession.workspaceId}）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleLoadRemoteSessions = async () => {
    if (!nativeClient.isAvailable() || !nativeClient.accounts.listRemoteSessions) return;
    if (showSessionsPanel) {
      setShowSessionsPanel(false);
      return;
    }
    setBusyAction(true);
    setError('');
    try {
      const list = await nativeClient.accounts.listRemoteSessions();
      setRemoteSessions(list);
      setShowSessionsPanel(true);
      setShowPasswordPanel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleRevokeSession = async (tokenId: string, isCurrent = false) => {
    if (!nativeClient.isAvailable() || !nativeClient.accounts.revokeRemoteSession) return;
    setBusyAction(true);
    setError('');
    try {
      await nativeClient.accounts.revokeRemoteSession(tokenId);
      if (isCurrent) {
        setShowSessionsPanel(false);
        setNotice('已吊销当前本机会话凭据，同步与设备管理将在重新登录后恢复');
      } else {
        if (nativeClient.accounts.listRemoteSessions) {
          setRemoteSessions(await nativeClient.accounts.listRemoteSessions());
        }
        setNotice(`已吊销设备会话 ${tokenId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nativeClient.isAvailable() || !nativeClient.accounts.changePassword) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      await nativeClient.accounts.changePassword({
        oldPassword: oldPasswordInput,
        newPassword: newPasswordInput,
        revokeAll: revokeAllOnPwd
      });
      setOldPasswordInput('');
      setNewPasswordInput('');
      setShowPasswordPanel(false);
      setNotice(
        revokeAllOnPwd
          ? '密码已修改并吊销旧会话，如本机被吊销请使用新密码重新登录'
          : '账号密码已更新'
      );
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
      setShowSessionsPanel(false);
      setShowPasswordPanel(false);
      setEditingEndpoint(false);
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
        workspaceId: workspaceInput.trim() || 'default',
        token: tokenInput || undefined
      });
      setSession(nextSession);
      setSyncStatus(await nativeClient.sync.getStatus());
      setEditingEndpoint(false);
      setTokenInput('');
      setNotice(`已保存云端配置，当前工作区：${nextSession.workspaceId}`);
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
              <span>
                账号 ID：<span className="font-mono text-slate-200">{session?.activeUserId}</span>
                <span className="ml-2 rounded border border-white/[0.08] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-sky-200">
                  {session?.workspaceId || 'default'}
                </span>
              </span>
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    value={workspaceInput}
                    onChange={event => setWorkspaceInput(event.target.value)}
                    placeholder="工作区 ID（default 或 private:账号）"
                    className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
                  />
                  <button
                    type="button"
                    onClick={() => setWorkspaceInput('default')}
                    className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.1]"
                  >
                    共享(default)
                  </button>
                  {session?.activeUserId && (
                    <button
                      type="button"
                      onClick={() => setWorkspaceInput(`private:${session.activeUserId}`)}
                      className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.1]"
                    >
                      私人空间
                    </button>
                  )}
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
            {showSessionsPanel && (
              <div className="space-y-1.5 rounded-md border border-white/[0.08] bg-black/25 p-2.5">
                <div className="text-[10px] font-semibold text-slate-300">已授权登录设备列表</div>
                {remoteSessions.length === 0 ? (
                  <div className="text-[10px] text-slate-500">
                    暂无记录（静态白名单 Token 不生成动态会话条目）
                  </div>
                ) : (
                  remoteSessions.map(item => (
                    <div
                      key={item.tokenId}
                      className="flex items-center justify-between gap-2 rounded bg-white/[0.03] px-2 py-1 text-[10px]"
                    >
                      <div className="min-w-0 truncate">
                        <span className="font-semibold text-slate-200">{item.label}</span>
                        <span className="ml-1.5 font-mono text-slate-500">{item.tokenId}</span>
                        {item.isCurrent && (
                          <span className="ml-1.5 rounded bg-emerald-500/20 px-1 text-emerald-200">
                            本机
                          </span>
                        )}
                        {item.revokedAt && (
                          <span className="ml-1.5 text-rose-300">已吊销</span>
                        )}
                      </div>
                      {!item.revokedAt && (
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => void handleRevokeSession(item.tokenId, item.isCurrent)}
                          className="shrink-0 rounded border border-rose-400/25 bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-500/25"
                        >
                          吊销
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
            {showPasswordPanel && (
              <form
                onSubmit={event => void handleChangePassword(event)}
                className="space-y-2 rounded-md border border-white/[0.08] bg-black/25 p-2.5"
              >
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="password"
                    value={oldPasswordInput}
                    onChange={event => setOldPasswordInput(event.target.value)}
                    placeholder="当前密码"
                    className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500"
                  />
                  <input
                    type="password"
                    value={newPasswordInput}
                    onChange={event => setNewPasswordInput(event.target.value)}
                    placeholder="新密码（至少 4 位）"
                    className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={revokeAllOnPwd}
                      onChange={event => setRevokeAllOnPwd(event.target.checked)}
                    />
                    修改后同时吊销所有已登录会话
                  </label>
                  <button
                    type="submit"
                    disabled={busyAction || !oldPasswordInput || newPasswordInput.length < 4}
                    className="rounded bg-sky-500/25 px-2.5 py-1 text-[10px] font-semibold text-sky-100 hover:bg-sky-500/35 disabled:opacity-50"
                  >
                    确认修改
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
                  setWorkspaceInput(session?.workspaceId || 'default');
                  setTokenInput('');
                  setEditingEndpoint(prev => !prev);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
              >
                配置服务端
              </button>
              {session?.serverEndpoint && nativeClient.accounts.listRemoteSessions && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleLoadRemoteSessions()}
                  className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
                >
                  <MonitorSmartphone size={12} />
                  设备管理
                </button>
              )}
              {session?.serverEndpoint && nativeClient.accounts.changePassword && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => {
                    setShowPasswordPanel(prev => !prev);
                    setShowSessionsPanel(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
                >
                  <KeyRound size={12} />
                  改密
                </button>
              )}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-300">
                登录云端账号或切换隔离工作区（可选）
              </span>
              <div className="flex rounded-md bg-black/30 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setAuthMethod('password')}
                  className={`rounded px-2 py-0.5 ${
                    authMethod === 'password' ? 'bg-sky-500/25 text-sky-100' : 'text-slate-400'
                  }`}
                >
                  账号密码登录
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMethod('token')}
                  className={`rounded px-2 py-0.5 ${
                    authMethod === 'token' ? 'bg-sky-500/25 text-sky-100' : 'text-slate-400'
                  }`}
                >
                  Token / 本地隔离
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={userIdInput}
                onChange={event => setUserIdInput(event.target.value)}
                placeholder="账号 ID（如 alice）"
                className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
              />
              {authMethod === 'password' ? (
                <input
                  type="password"
                  value={passwordInput}
                  onChange={event => setPasswordInput(event.target.value)}
                  placeholder="登录密码"
                  className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
                />
              ) : (
                <input
                  value={displayNameInput}
                  onChange={event => setDisplayNameInput(event.target.value)}
                  placeholder="显示名称（可选）"
                  className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={endpointInput}
                onChange={event => setEndpointInput(event.target.value)}
                placeholder={
                  authMethod === 'password'
                    ? '服务端 URL（如 http://127.0.0.1:8787）'
                    : '预留服务端 URL（可选）'
                }
                className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
              />
              {authMethod === 'token' ? (
                <input
                  type="password"
                  value={tokenInput}
                  onChange={event => setTokenInput(event.target.value)}
                  placeholder="Token（填服务端时必填）"
                  className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
                />
              ) : (
                <input
                  value={workspaceInput}
                  onChange={event => setWorkspaceInput(event.target.value)}
                  placeholder="工作区 ID（默认 default）"
                  className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
                />
              )}
            </div>
            {authMethod === 'token' && (
              <input
                value={workspaceInput}
                onChange={event => setWorkspaceInput(event.target.value)}
                placeholder="工作区 ID（默认 default，或 private:账号）"
                className="w-full rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span>快捷工作区：</span>
                <button
                  type="button"
                  onClick={() => setWorkspaceInput('default')}
                  className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-slate-300 hover:bg-white/[0.1]"
                >
                  共享看板
                </button>
                <button
                  type="button"
                  disabled={!userIdInput.trim()}
                  onClick={() => setWorkspaceInput(`private:${userIdInput.trim()}`)}
                  className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-slate-300 hover:bg-white/[0.1] disabled:opacity-40"
                >
                  私人空间
                </button>
              </div>
              <button
                type="submit"
                disabled={
                  busyAction ||
                  !userIdInput.trim() ||
                  (authMethod === 'password' && (!passwordInput || !endpointInput.trim()))
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/20 px-3 py-1.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/30 disabled:opacity-50"
              >
                <UserCheck size={12} />
                {authMethod === 'password' ? '登录并挂载工作区' : '切换至独立账号目录'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
