import React, { useCallback, useEffect, useState } from 'react';
import {
  Cloud,
  FolderDown,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Trash2,
  Users
} from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type {
  AccountSessionSnapshot,
  RemoteAuthSessionInfo,
  RemoteWorkspaceInfo,
  SyncStatusSnapshot,
  WorkspaceInviteInfo
} from '../../types/todo';
import {
  AccountEndpointEditor,
  AccountPasswordPanel,
  AccountRemoteSessionsPanel
} from './AccountDevicePanels';
import { AccountLoginForm, type AccountAuthMode } from './AccountLoginForm';
import { AccountWorkspacePanel } from './AccountWorkspaceInvitesPanel';

/**
 * Settings card managing multi-account workspace isolation, self-service registration,
 * detached offline continuity, cloud sync actions, and workspace invitations.
 */
export const AccountSyncCard: React.FC = () => {
  const [session, setSession] = useState<AccountSessionSnapshot | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot | null>(null);
  const [authMethod, setAuthMethod] = useState<AccountAuthMode>('password');
  const [userIdInput, setUserIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [endpointInput, setEndpointInput] = useState('');
  const [workspaceInput, setWorkspaceInput] = useState('default');
  const [tokenInput, setTokenInput] = useState('');
  const [editingEndpoint, setEditingEndpoint] = useState(false);
  const [showSessionsPanel, setShowSessionsPanel] = useState(false);
  const [remoteSessions, setRemoteSessions] = useState<RemoteAuthSessionInfo[]>([]);
  const [showWorkspacesPanel, setShowWorkspacesPanel] = useState(false);
  const [remoteWorkspaces, setRemoteWorkspaces] = useState<RemoteWorkspaceInfo[]>([]);
  const [workspaceInvites, setWorkspaceInvites] = useState<WorkspaceInviteInfo[]>([]);
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
      }),
      nativeClient.sync.onRealtimeStateChanged?.(payload => {
        void loadAccountAndSync();
        if (!payload.realtimeActive && payload.reason === 'auth_rejected') {
          setError('云端会话凭据已失效或被吊销，实时同步已自动暂停，请重新登录');
        }
      })
    ].filter((fn): fn is () => void => typeof fn === 'function');
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [loadAccountAndSync]);

  const resetSessionToLocal = useCallback(
    async (message: string, keepLocalContinuity = true) => {
      const nextSession = await nativeClient.accounts.logoutToLocal(keepLocalContinuity);
      setSession(nextSession);
      setSyncStatus(await nativeClient.sync.getStatus());
      setShowSessionsPanel(false);
      setShowWorkspacesPanel(false);
      setShowPasswordPanel(false);
      setEditingEndpoint(false);
      if (keepLocalContinuity && nextSession.detachedUserId) {
        setUserIdInput(nextSession.detachedUserId);
        if (nextSession.detachedWorkspaceId) {
          setWorkspaceInput(nextSession.detachedWorkspaceId);
        }
      }
      setNotice(message);
    },
    []
  );

  const handleSwitchAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nativeClient.isAvailable()) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const targetWs = workspaceInput.trim() || 'default';
      let nextSession: AccountSessionSnapshot;
      if (authMethod === 'register') {
        if (!nativeClient.accounts.registerWithPassword) {
          throw new Error('当前运行环境不支持账号注册');
        }
        if (passwordInput !== confirmPasswordInput) {
          throw new Error('两次输入的密码不一致');
        }
        nextSession = await nativeClient.accounts.registerWithPassword({
          userId: userIdInput,
          password: passwordInput,
          displayName: displayNameInput.trim() || undefined,
          serverEndpoint: endpointInput,
          deviceLabel: 'TidyDesk Windows'
        });
        setPasswordInput('');
        setConfirmPasswordInput('');
      } else if (authMethod === 'password') {
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
      setNotice(
        authMethod === 'register'
          ? `注册成功并已承接本机数据至个人空间：${nextSession.activeUserId}（${nextSession.workspaceId}）`
          : `已连接账号工作区：${nextSession.activeUserId}（${nextSession.workspaceId}）`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const refreshWorkspacesAndInvites = useCallback(async (targetWsId?: string) => {
    if (!nativeClient.isAvailable() || !nativeClient.accounts.listWorkspaces) return;
    const list = await nativeClient.accounts.listWorkspaces();
    setRemoteWorkspaces(list);
    const activeId = targetWsId || session?.workspaceId || 'default';
    const currentWs = list.find(w => w.workspaceId === activeId);
    if (
      currentWs &&
      !currentWs.isPrivate &&
      (currentWs.role === 'owner' || currentWs.role === 'admin') &&
      nativeClient.accounts.listWorkspaceInvites
    ) {
      setWorkspaceInvites(await nativeClient.accounts.listWorkspaceInvites(activeId));
    } else {
      setWorkspaceInvites([]);
    }
  }, [session?.workspaceId]);

  const handleToggleWorkspacesPanel = async () => {
    if (showWorkspacesPanel) {
      setShowWorkspacesPanel(false);
      return;
    }
    setBusyAction(true);
    setError('');
    try {
      await refreshWorkspacesAndInvites();
      setShowWorkspacesPanel(true);
      setShowSessionsPanel(false);
      setShowPasswordPanel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleSwitchWorkspace = async (nextWorkspaceId: string) => {
    if (!nativeClient.isAvailable() || !session?.activeUserId) return;
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const nextSession = await nativeClient.accounts.switchSession({
        userId: session.activeUserId,
        serverEndpoint: session.serverEndpoint || undefined,
        workspaceId: nextWorkspaceId
      });
      setSession(nextSession);
      setSyncStatus(await nativeClient.sync.getStatus());
      await refreshWorkspacesAndInvites(nextWorkspaceId);
      setNotice(`已切换工作区：${nextWorkspaceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateSharedWorkspace = async (title: string) => {
    if (!nativeClient.accounts.createWorkspace || !session?.activeUserId) return;
    setBusyAction(true);
    setError('');
    try {
      const created = await nativeClient.accounts.createWorkspace(title);
      await handleSwitchWorkspace(created.workspaceId);
      setNotice(`已创建共享工作区「${created.title}」，您可以生成邀请码拉人加入`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleJoinWorkspaceByInvite = async (inviteCode: string) => {
    if (!nativeClient.accounts.joinWorkspaceByInvite || !session?.activeUserId) return;
    setBusyAction(true);
    setError('');
    try {
      const joined = await nativeClient.accounts.joinWorkspaceByInvite(inviteCode);
      await handleSwitchWorkspace(joined.workspaceId);
      setNotice(`已加入共享工作区「${joined.title}」（权限：${joined.role}）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateInvite = async (role: 'admin' | 'member' | 'viewer', maxUses: number) => {
    if (!nativeClient.accounts.createWorkspaceInvite || !session?.workspaceId) return;
    setBusyAction(true);
    setError('');
    try {
      const created = await nativeClient.accounts.createWorkspaceInvite({
        workspaceId: session.workspaceId,
        role,
        maxUses,
        expiresInHours: 72
      });
      await refreshWorkspacesAndInvites(session.workspaceId);
      setNotice(`已生成邀请码 ${created.inviteCode}（角色 ${created.role}）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleRevokeInvite = async (inviteCode: string) => {
    if (!nativeClient.accounts.revokeWorkspaceInvite || !session?.workspaceId) return;
    if (!confirm(`确定撤回邀请码 ${inviteCode} 吗？撤回后他人将无法凭此码加入。`)) return;
    setBusyAction(true);
    setError('');
    try {
      await nativeClient.accounts.revokeWorkspaceInvite(session.workspaceId, inviteCode);
      await refreshWorkspacesAndInvites(session.workspaceId);
      setNotice(`已撤回邀请码 ${inviteCode}`);
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
    const msg = isCurrent
      ? '确定吊销当前本机设备会话吗？本机将立即退出登录，需要重新验证。'
      : `确定下线并吊销设备会话 ${tokenId} 吗？`;
    if (!confirm(msg)) return;
    setBusyAction(true);
    setError('');
    try {
      await nativeClient.accounts.revokeRemoteSession(tokenId);
      if (isCurrent) {
        await resetSessionToLocal('已吊销当前本机会话凭据并切回纯本地工作区，请使用新凭据重新登录');
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
      if (revokeAllOnPwd) {
        await resetSessionToLocal('密码已修改并吊销全部会话，本机已切回纯本地工作区，请使用新密码重登');
      } else {
        setNotice('账号密码已更新');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleLogoutToLocal = async (keepLocalContinuity = true) => {
    if (!nativeClient.isAvailable()) return;
    if (!keepLocalContinuity) {
      const pending = syncStatus?.pendingCount ?? 0;
      const warnMsg =
        pending > 0
          ? `当前仍有 ${pending} 条离线改动尚未同步到云端。\n\n切回独立的空白本地模式后界面将暂时看不到这些改动（重新登录原账号可找回并继续同步），确定切换吗？`
          : '确定切回独立的纯本地默认工作区吗？重新登录原账号可随时恢复原数据视图。';
      if (!confirm(warnMsg)) return;
    }
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      await resetSessionToLocal(
        keepLocalContinuity
          ? '已断开云端登录，当前最新数据仍保留在本地供继续编辑（同账号重登将自动接续同步）'
          : '已注销并切回独立的纯本地默认工作区',
        keepLocalContinuity
      );
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
    const pending = syncStatus?.pendingCount ?? 0;
    if (
      !confirm(
        `确定清空待同步队列中的 ${pending} 条本地未上传变更吗？\n\n清空后这些本地修改将不会再自动推送到云端。`
      )
    ) {
      return;
    }
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
              onClick={() => void handleLogoutToLocal(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.1] hover:text-white disabled:opacity-50"
            >
              <LogOut size={12} />
              退出账号（保留数据）
            </button>
          )}
        </div>

        {!isAccountMode && session?.detachedUserId && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            <span>
              当前正离线延续使用账号 <span className="font-mono font-semibold">{session.detachedUserId}</span>
              （{session.detachedWorkspaceId || 'default'}）的最新数据；本机编辑会暂存队列（待推 {syncStatus?.pendingCount ?? 0} 条），同账号重登即可同步上云。
            </span>
            <button
              type="button"
              disabled={busyAction}
              onClick={() => void handleLogoutToLocal(false)}
              className="rounded border border-amber-300/30 bg-black/25 px-2 py-0.5 text-[10px] font-semibold text-amber-100 hover:bg-black/40 disabled:opacity-50"
            >
              彻底切回独立空白本地
            </button>
          </div>
        )}

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
              <span>
                待同步队列：<span className="font-semibold text-sky-300">{syncStatus?.pendingCount ?? 0}</span> 条
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
              <span className="truncate">
                同步服务端：<span className="text-slate-200">{session?.serverEndpoint || '未配置（仅本地发件箱）'}</span>
              </span>
              {session?.lastSyncCursor && (
                <span className="font-mono text-[10px] text-slate-400">游标 #{session.lastSyncCursor}</span>
              )}
            </div>

            {editingEndpoint && (
              <AccountEndpointEditor
                activeUserId={session?.activeUserId ?? null}
                endpointInput={endpointInput}
                onEndpointChange={setEndpointInput}
                tokenInput={tokenInput}
                onTokenChange={setTokenInput}
                hasToken={Boolean(session?.hasToken)}
                workspaceInput={workspaceInput}
                onWorkspaceChange={setWorkspaceInput}
                busyAction={busyAction}
                onCancel={() => setEditingEndpoint(false)}
                onSubmit={event => void handleUpdateEndpointConfig(event)}
              />
            )}

            {showSessionsPanel && (
              <AccountRemoteSessionsPanel
                remoteSessions={remoteSessions}
                busyAction={busyAction}
                onRevoke={(tokenId, isCurrent) => void handleRevokeSession(tokenId, isCurrent)}
              />
            )}

            {showWorkspacesPanel && (
              <AccountWorkspacePanel
                activeWorkspaceId={session?.workspaceId || 'default'}
                workspaces={remoteWorkspaces}
                invites={workspaceInvites}
                busyAction={busyAction}
                onSwitchWorkspace={wsId => void handleSwitchWorkspace(wsId)}
                onCreateWorkspace={handleCreateSharedWorkspace}
                onJoinByInvite={handleJoinWorkspaceByInvite}
                onCreateInvite={handleCreateInvite}
                onRevokeInvite={handleRevokeInvite}
                onRefreshWorkspaces={() => refreshWorkspacesAndInvites()}
              />
            )}

            {showPasswordPanel && (
              <AccountPasswordPanel
                oldPasswordInput={oldPasswordInput}
                onOldPasswordChange={setOldPasswordInput}
                newPasswordInput={newPasswordInput}
                onNewPasswordChange={setNewPasswordInput}
                revokeAllOnPwd={revokeAllOnPwd}
                onRevokeAllChange={setRevokeAllOnPwd}
                busyAction={busyAction}
                onSubmit={event => void handleChangePassword(event)}
              />
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
              {session?.serverEndpoint && nativeClient.accounts.listWorkspaces && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleToggleWorkspacesPanel()}
                  className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
                >
                  <Users size={12} />
                  工作区与邀请
                </button>
              )}
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
                    setShowWorkspacesPanel(false);
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
          <AccountLoginForm
            authMethod={authMethod}
            onAuthMethodChange={setAuthMethod}
            userIdInput={userIdInput}
            onUserIdChange={setUserIdInput}
            passwordInput={passwordInput}
            onPasswordChange={setPasswordInput}
            confirmPasswordInput={confirmPasswordInput}
            onConfirmPasswordChange={setConfirmPasswordInput}
            displayNameInput={displayNameInput}
            onDisplayNameChange={setDisplayNameInput}
            endpointInput={endpointInput}
            onEndpointChange={setEndpointInput}
            workspaceInput={workspaceInput}
            onWorkspaceChange={setWorkspaceInput}
            tokenInput={tokenInput}
            onTokenChange={setTokenInput}
            busyAction={busyAction}
            onSubmit={event => void handleSwitchAccount(event)}
          />
        )}
      </div>
    </div>
  );
};
