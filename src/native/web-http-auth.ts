import type {
  AccountSessionSnapshot,
  RemoteAuthSessionInfo,
  RemoteWorkspaceInfo,
  WorkspaceMemberInfo
} from '../types/todo';
import type { NativeAccountsClient } from './types';
import type { WebHttpContext } from './web-http-context';
import type { WebSseController } from './web-http-sse';

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
    onClearData();

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
    ctx.setSession(nextSession);
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
      const endpoint = (payload.serverEndpoint || window.location.origin).trim().replace(/\/+$/, '');
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
      const endpoint = (payload.serverEndpoint || window.location.origin).trim().replace(/\/+$/, '');
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
          deviceLabel: payload.deviceLabel || 'Mobile Web'
        })
      });
      if (!loginRes.ok) {
        const msg = await loginRes.text().catch(() => '');
        throw new Error(`账号密码验证失败 (${loginRes.status}): ${msg}`);
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
      const active = ctx.requireSession();
      const wsId = (workspaceId || '').trim() || ctx.resolveWorkspaceId(active);
      const res = await fetch(
        `${active.serverEndpoint}/api/v1/workspaces/members?workspaceId=${encodeURIComponent(wsId)}`,
        { headers: ctx.authHeaders(active) }
      );
      if (!res.ok) {
        throw new Error(`获取工作区成员失败 (${res.status})`);
      }
      const data = (await res.json()) as { members?: WorkspaceMemberInfo[] };
      return data.members || [];
    },
    logoutToLocal: async () => {
      const prev = ctx.getSession();
      sse.stop();
      if (prev) {
        await fetch(`${prev.serverEndpoint}/api/v1/auth/logout`, {
          method: 'POST',
          headers: ctx.authHeaders(prev)
        }).catch(err => {
          console.warn('[TIDYDESK][MOBILE] Failed to revoke server session on logout:', err);
        });
      }
      onClearData();
      ctx.setSession(null);
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
