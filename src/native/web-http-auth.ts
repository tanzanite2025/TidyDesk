import type {
  AccountSessionSnapshot,
  RemoteAuthSessionInfo,
  RemoteWorkspaceInfo,
  WorkspaceInviteInfo,
  WorkspaceMemberInfo
} from '../types/todo';
import type { NativeAccountsClient } from './types';
import type { WebHttpContext } from './web-http-context';
import { normalizeMobileServerEndpoint } from './web-http-helpers';
import type { WebSseController } from './web-http-sse';
import { assertCanSwitchTargetScope, isSameWorkspaceScope } from './web-offline-store';

async function extractHttpErrorMessage(res: Response, fallbackPrefix: string): Promise<string> {
  const raw = await res.text().catch(() => '');
  if (!raw) return `${fallbackPrefix} (${res.status})`;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return `${parsed.error.trim()} (${res.status})`;
    }
  } catch {
    // Not JSON; fall through to raw text
  }
  return `${fallbackPrefix} (${res.status}): ${raw}`;
}

export function createWebAccountsClient(
  ctx: WebHttpContext,
  sse: WebSseController,
  onClearData: () => void
): NativeAccountsClient {
  const verifyAndActivateSession = async (params: {
    userId: string;
    displayName?: string;
    endpoint: string;
    workspaceId: string;
    token: string;
  }): Promise<AccountSessionSnapshot> => {
    const prevScope = ctx.getCurrentScope();
    assertCanSwitchTargetScope({
      currentScope: prevScope,
      targetScope: { userId: params.userId, workspaceId: params.workspaceId },
      pendingOutboxCount: ctx.getOutboxEntries().length
    });

    const verifyRes = await fetch(`${params.endpoint}/api/v1/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.token}`,
        'X-TidyDesk-User': params.userId
      },
      body: JSON.stringify({ userId: params.userId, workspaceId: params.workspaceId })
    });
    if (!verifyRes.ok) {
      const msg = await verifyRes.text().catch(() => '');
      const err = new Error(`工作区鉴权验证失败 (${verifyRes.status}): ${msg}`) as Error & {
        status?: number;
      };
      err.status = verifyRes.status;
      throw err;
    }
    const verified = (await verifyRes.json().catch(() => ({}))) as { displayName?: string };
    const existingSession = ctx.getSession();
    const sameActiveUser = Boolean(existingSession && existingSession.userId === params.userId);
    const sameScopeContinuity = isSameWorkspaceScope(prevScope, {
      userId: params.userId,
      workspaceId: params.workspaceId
    });

    if (!sameScopeContinuity) {
      onClearData();
    }

    const nextSession = {
      userId: params.userId,
      displayName:
        params.displayName?.trim() ||
        (sameActiveUser ? existingSession?.displayName : undefined) ||
        verified.displayName ||
        params.userId,
      serverEndpoint: params.endpoint,
      workspaceId: params.workspaceId,
      token: params.token
    };
    ctx.setDetachedScope(null);
    ctx.setSession(nextSession);
    if (!sameScopeContinuity) {
      ctx.hydrateScopeFromOfflineStore({
        userId: nextSession.userId,
        workspaceId: nextSession.workspaceId,
        displayName: nextSession.displayName,
        serverEndpoint: nextSession.serverEndpoint
      });
    }
    const snap = ctx.toSessionSnapshot(nextSession);
    for (const cb of ctx.sessionListeners) cb(snap);
    sse.start();
    return snap;
  };

  return {
    getSession: async () => ctx.toSessionSnapshot(ctx.getSession()),
    switchSession: async payload => {
      const existingSession = ctx.getSession();
      const userId = payload.userId.trim();
      const endpoint = normalizeMobileServerEndpoint(payload.serverEndpoint);
      const sameActiveUser = Boolean(existingSession && existingSession.userId === userId);
      const token = (payload.token || (sameActiveUser ? existingSession?.token : '') || '').trim();
      const workspaceId = (payload.workspaceId || '').trim() || 'default';
      if (!userId || !token) {
        throw new Error('请输入账号 ID 与访问 Token');
      }
      return verifyAndActivateSession({
        userId,
        displayName: payload.displayName,
        endpoint,
        workspaceId,
        token
      });
    },
    loginWithPassword: async payload => {
      const userId = payload.userId.trim();
      const endpoint = normalizeMobileServerEndpoint(payload.serverEndpoint);
      const workspaceId = (payload.workspaceId || '').trim() || 'default';
      if (!userId || !payload.password) {
        throw new Error('请输入账号 ID 与密码');
      }
      const loginRes = await fetch(`${endpoint}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          password: payload.password,
          deviceLabel: payload.deviceLabel || 'Mobile App'
        })
      });
      if (!loginRes.ok) {
        throw new Error(await extractHttpErrorMessage(loginRes, '账号密码验证失败'));
      }
      const issued = (await loginRes.json()) as {
        userId: string;
        displayName?: string;
        token: string;
      };

      try {
        return await verifyAndActivateSession({
          userId: issued.userId,
          displayName: issued.displayName,
          endpoint,
          workspaceId,
          token: issued.token
        });
      } catch (err) {
        await fetch(`${endpoint}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${issued.token}`,
            'X-TidyDesk-User': issued.userId
          }
        }).catch(cleanupErr =>
          console.warn('[TIDYDESK][MOBILE] Failed to cleanup denied login token:', cleanupErr)
        );
        throw err;
      }
    },
    registerWithPassword: async payload => {
      const userId = payload.userId.trim();
      const endpoint = normalizeMobileServerEndpoint(payload.serverEndpoint);
      if (!userId || !payload.password) {
        throw new Error('请输入注册账号 ID 与密码');
      }
      const regRes = await fetch(`${endpoint}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          password: payload.password,
          displayName: payload.displayName?.trim() || '',
          deviceLabel: payload.deviceLabel || 'Mobile App'
        })
      });
      if (!regRes.ok) {
        throw new Error(await extractHttpErrorMessage(regRes, '账号注册失败'));
      }
      const issued = (await regRes.json()) as {
        userId: string;
        displayName?: string;
        token: string;
        defaultWorkspaceId?: string;
      };
      const targetWs = issued.defaultWorkspaceId || `private:${issued.userId}`;
      try {
        return await verifyAndActivateSession({
          userId: issued.userId,
          displayName: issued.displayName,
          endpoint,
          workspaceId: targetWs,
          token: issued.token
        });
      } catch (err) {
        await fetch(`${endpoint}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${issued.token}`,
            'X-TidyDesk-User': issued.userId
          }
        }).catch(cleanupErr =>
          console.warn('[TIDYDESK][MOBILE] Failed to cleanup denied register token:', cleanupErr)
        );
        throw err;
      }
    },
    changePassword: async payload => {
      const active = ctx.requireSession();
      const res = await fetch(`${active.serverEndpoint}/api/v1/auth/password`, {
        method: 'POST',
        headers: ctx.authHeaders(active, 'application/json'),
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`修改密码失败 (${res.status}): ${msg}`);
      }
    },
    listRemoteSessions: async (): Promise<RemoteAuthSessionInfo[]> => {
      const active = ctx.requireSession();
      const res = await fetch(`${active.serverEndpoint}/api/v1/auth/sessions`, {
        headers: ctx.authHeaders(active)
      });
      if (!res.ok) {
        throw new Error(`读取设备会话失败 (${res.status})`);
      }
      const data = (await res.json()) as { sessions?: RemoteAuthSessionInfo[] };
      return data.sessions || [];
    },
    revokeRemoteSession: async tokenId => {
      const active = ctx.requireSession();
      const res = await fetch(`${active.serverEndpoint}/api/v1/auth/sessions/revoke`, {
        method: 'POST',
        headers: ctx.authHeaders(active, 'application/json'),
        body: JSON.stringify({ tokenId })
      });
      if (!res.ok) {
        throw new Error(`吊销设备会话失败 (${res.status})`);
      }
    },
    listWorkspaces: async (): Promise<RemoteWorkspaceInfo[]> => {
      const active = ctx.requireSession();
      const res = await fetch(`${active.serverEndpoint}/api/v1/workspaces`, {
        headers: ctx.authHeaders(active)
      });
      if (!res.ok) {
        throw new Error(`获取工作区列表失败 (${res.status})`);
      }
      const data = (await res.json()) as { workspaces?: RemoteWorkspaceInfo[] };
      return data.workspaces || [];
    },
    listWorkspaceMembers: async (workspaceId?: string): Promise<WorkspaceMemberInfo[]> => {
      const active = ctx.getSession();
      if (!active) return [];
      const wsId = (workspaceId || '').trim() || ctx.resolveWorkspaceId(active);
      const res = await fetch(
        `${active.serverEndpoint}/api/v1/workspaces/members?workspaceId=${encodeURIComponent(wsId)}`,
        { headers: ctx.authHeaders(active) }
      );
      if (!res.ok) {
        throw new Error(await extractHttpErrorMessage(res, '获取工作区成员失败'));
      }
      const data = (await res.json()) as { members?: WorkspaceMemberInfo[] };
      return data.members || [];
    },
    createWorkspace: async (title: string): Promise<RemoteWorkspaceInfo> => {
      const active = ctx.requireSession();
      const cleanTitle = title.trim();
      if (!cleanTitle) throw new Error('请输入工作区名称');
      const res = await fetch(`${active.serverEndpoint}/api/v1/workspaces`, {
        method: 'POST',
        headers: ctx.authHeaders(active, 'application/json'),
        body: JSON.stringify({ title: cleanTitle })
      });
      if (!res.ok) {
        throw new Error(await extractHttpErrorMessage(res, '创建工作区失败'));
      }
      const data = (await res.json()) as { workspace?: RemoteWorkspaceInfo };
      if (!data.workspace) throw new Error('[CRITICAL] 服务端未返回新建工作区信息');
      return data.workspace;
    },
    joinWorkspaceByInvite: async (inviteCode: string): Promise<RemoteWorkspaceInfo> => {
      const active = ctx.requireSession();
      const code = inviteCode.trim();
      if (!code) throw new Error('请输入工作区邀请码');
      const res = await fetch(`${active.serverEndpoint}/api/v1/workspaces/join`, {
        method: 'POST',
        headers: ctx.authHeaders(active, 'application/json'),
        body: JSON.stringify({ inviteCode: code })
      });
      if (!res.ok) {
        throw new Error(await extractHttpErrorMessage(res, '加入工作区失败'));
      }
      const data = (await res.json()) as { workspace?: RemoteWorkspaceInfo };
      if (!data.workspace) throw new Error('[CRITICAL] 服务端未返回已加入工作区信息');
      return data.workspace;
    },
    createWorkspaceInvite: async payload => {
      const active = ctx.requireSession();
      const res = await fetch(`${active.serverEndpoint}/api/v1/workspaces/invites`, {
        method: 'POST',
        headers: ctx.authHeaders(active, 'application/json'),
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(await extractHttpErrorMessage(res, '生成邀请码失败'));
      }
      const data = (await res.json()) as { invite?: WorkspaceInviteInfo };
      if (!data.invite) throw new Error('[CRITICAL] 服务端未返回生成的邀请码');
      return data.invite;
    },
    listWorkspaceInvites: async (workspaceId: string): Promise<WorkspaceInviteInfo[]> => {
      const active = ctx.requireSession();
      const res = await fetch(
        `${active.serverEndpoint}/api/v1/workspaces/invites?workspaceId=${encodeURIComponent(workspaceId)}`,
        { headers: ctx.authHeaders(active) }
      );
      if (!res.ok) {
        throw new Error(await extractHttpErrorMessage(res, '获取邀请码列表失败'));
      }
      const data = (await res.json()) as { invites?: WorkspaceInviteInfo[] };
      return data.invites || [];
    },
    revokeWorkspaceInvite: async (
      workspaceId: string,
      inviteCode: string
    ): Promise<WorkspaceInviteInfo> => {
      const active = ctx.requireSession();
      const res = await fetch(`${active.serverEndpoint}/api/v1/workspaces/invites/revoke`, {
        method: 'POST',
        headers: ctx.authHeaders(active, 'application/json'),
        body: JSON.stringify({ workspaceId, inviteCode })
      });
      if (!res.ok) {
        throw new Error(await extractHttpErrorMessage(res, '撤销邀请码失败'));
      }
      const data = (await res.json()) as { invite?: WorkspaceInviteInfo };
      if (!data.invite) throw new Error('[CRITICAL] 服务端未返回已撤销的邀请码信息');
      return data.invite;
    },
    logoutToLocal: async (keepLocalContinuity = true) => {
      const prev = ctx.getSession();
      const prevScope = ctx.getCurrentScope();
      sse.stop();
      if (prev) {
        await fetch(`${prev.serverEndpoint}/api/v1/auth/logout`, {
          method: 'POST',
          headers: ctx.authHeaders(prev)
        }).catch(err => {
          console.warn('[TIDYDESK][MOBILE] Failed to revoke server session on logout:', err);
        });
      }
      if (keepLocalContinuity && prevScope) {
        ctx.persistScopeSnapshot();
        ctx.setDetachedScope(prevScope);
        ctx.setSession(null);
      } else {
        if (prevScope) {
          ctx.wipeScopeOfflineData(prevScope);
        }
        ctx.setDetachedScope(null);
        onClearData();
        ctx.setSession(null);
      }
      const snap = ctx.toSessionSnapshot(null);
      for (const cb of ctx.sessionListeners) cb(snap);
      return snap;
    },
    importLocalTodos: async () => ({ importedCards: 0 }),
    onSessionChanged: cb => {
      ctx.sessionListeners.add(cb);
      return () => ctx.sessionListeners.delete(cb);
    }
  };
}
