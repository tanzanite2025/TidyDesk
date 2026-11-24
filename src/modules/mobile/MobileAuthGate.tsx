import React, { useState } from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { AccountSessionSnapshot } from '../../types/todo';

interface MobileAuthGateProps {
  initialEndpoint: string;
  initialWorkspaceId: string;
  onAuthenticated: (snapshot: AccountSessionSnapshot) => void;
}

export const MobileAuthGate: React.FC<MobileAuthGateProps> = ({
  initialEndpoint,
  initialWorkspaceId,
  onAuthenticated
}) => {
  const [authMethod, setAuthMethod] = useState<'password' | 'token'>('password');
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [token, setToken] = useState('');
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [authError, setAuthError] = useState('');
  const [submittingAuth, setSubmittingAuth] = useState(false);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmittingAuth(true);
    setAuthError('');
    try {
      const targetWs = workspaceId.trim() || 'default';
      let next: AccountSessionSnapshot;
      if (authMethod === 'password') {
        if (!nativeClient.accounts.loginWithPassword) {
          throw new Error('当前环境不支持账号密码登录');
        }
        next = await nativeClient.accounts.loginWithPassword({
          userId: userId.trim(),
          password,
          serverEndpoint: endpoint.trim(),
          workspaceId: targetWs,
          deviceLabel: 'Mobile Browser'
        });
        setPassword('');
      } else {
        next = await nativeClient.accounts.switchSession({
          userId: userId.trim(),
          displayName: displayName.trim() || undefined,
          serverEndpoint: endpoint.trim(),
          workspaceId: targetWs,
          token: token.trim()
        });
      }
      onAuthenticated(next);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingAuth(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0f131d] p-4 text-slate-100">
      <form
        onSubmit={event => void handleLogin(event)}
        className="w-full max-w-[400px] space-y-4 rounded-2xl border border-white/[0.1] bg-[#151a29] p-6 shadow-2xl"
      >
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-sky-500/20 text-sky-300">
            <Cloud size={18} />
          </div>
          <div>
            <h1 className="text-[16px] font-black">TidyDesk 移动端协同</h1>
            <p className="text-[11px] text-slate-400">待办与快捷记录，与桌面端实时同步</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/25 p-1 text-[12px] font-semibold">
          <button
            type="button"
            onClick={() => setAuthMethod('password')}
            className={`rounded-lg py-1.5 transition-colors ${
              authMethod === 'password' ? 'bg-sky-500/25 text-sky-100' : 'text-slate-400'
            }`}
          >
            账号密码登录
          </button>
          <button
            type="button"
            onClick={() => setAuthMethod('token')}
            className={`rounded-lg py-1.5 transition-colors ${
              authMethod === 'token' ? 'bg-sky-500/25 text-sky-100' : 'text-slate-400'
            }`}
          >
            白名单 Token
          </button>
        </div>

        {authError && (
          <div className="rounded-xl border border-rose-400/25 bg-rose-500/15 px-3 py-2 text-[12px] text-rose-100">
            {authError}
          </div>
        )}

        <div className="space-y-3 text-[12px]">
          <label className="block space-y-1">
            <span className="text-slate-400">协同服务端地址</span>
            <input
              value={endpoint}
              onChange={event => setEndpoint(event.target.value)}
              placeholder="http://192.168.x.x:8787"
              className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-slate-400">账号 ID</span>
            <input
              value={userId}
              onChange={event => setUserId(event.target.value)}
              placeholder="如 alice 或 bob"
              className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
            />
          </label>
          {authMethod === 'password' ? (
            <label className="block space-y-1">
              <span className="text-slate-400">登录密码</span>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="输入账号密码"
                className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
              />
            </label>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="text-slate-400">显示名称（可选）</span>
                <input
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  placeholder="如 手机外勤端"
                  className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-400">访问 Token</span>
                <input
                  type="password"
                  value={token}
                  onChange={event => setToken(event.target.value)}
                  placeholder="输入协同访问 Token"
                  className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
                />
              </label>
            </>
          )}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span>目标工作区</span>
              <div className="flex gap-1.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setWorkspaceId('default')}
                  className="rounded border border-white/[0.1] px-1.5 py-0.5 text-slate-300"
                >
                  共享(default)
                </button>
                <button
                  type="button"
                  disabled={!userId.trim()}
                  onClick={() => setWorkspaceId(`private:${userId.trim()}`)}
                  className="rounded border border-white/[0.1] px-1.5 py-0.5 text-slate-300 disabled:opacity-40"
                >
                  私人空间
                </button>
              </div>
            </div>
            <input
              value={workspaceId}
              onChange={event => setWorkspaceId(event.target.value)}
              placeholder="default 或 private:账号"
              className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 font-mono text-slate-100 outline-none focus:border-sky-400/50"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={
            submittingAuth ||
            !userId.trim() ||
            !endpoint.trim() ||
            (authMethod === 'password' ? !password : !token.trim())
          }
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-[13px] font-bold text-white hover:bg-sky-400 disabled:opacity-45"
        >
          {submittingAuth && <Loader2 size={15} className="animate-spin" />}
          验证凭据并进入看板
        </button>
      </form>
    </div>
  );
};
