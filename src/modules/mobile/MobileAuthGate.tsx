import React, { useEffect, useRef, useState } from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { AccountSessionSnapshot } from '../../types/todo';

interface MobileAuthGateProps {
  initialEndpoint: string;
  initialWorkspaceId: string;
  initialUserId?: string;
  detachedScope?: {
    userId: string;
    workspaceId: string;
    pendingCount: number;
  } | null;
  onAuthenticated: (snapshot: AccountSessionSnapshot) => void;
  onCancelOffline?: () => void;
  onWipeDetachedLocal?: () => Promise<void>;
}

type MobileAuthMode = 'password' | 'register' | 'token';

export const MobileAuthGate: React.FC<MobileAuthGateProps> = ({
  initialEndpoint,
  initialWorkspaceId,
  initialUserId = '',
  detachedScope = null,
  onAuthenticated,
  onCancelOffline,
  onWipeDetachedLocal
}) => {
  const [authMethod, setAuthMethod] = useState<MobileAuthMode>('password');
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [userId, setUserId] = useState(initialUserId || detachedScope?.userId || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [token, setToken] = useState('');
  const [workspaceId, setWorkspaceId] = useState(
    detachedScope?.workspaceId || initialWorkspaceId
  );
  const [authError, setAuthError] = useState('');
  const [submittingAuth, setSubmittingAuth] = useState(false);
  const [wipingLocal, setWipingLocal] = useState(false);
  const endpointEditedRef = useRef(false);
  const workspaceEditedRef = useRef(false);
  const userEditedRef = useRef(false);

  useEffect(() => {
    if (initialEndpoint && !endpointEditedRef.current) {
      setEndpoint(initialEndpoint);
    }
  }, [initialEndpoint]);

  useEffect(() => {
    const nextWs = detachedScope?.workspaceId || initialWorkspaceId;
    if (nextWs && !workspaceEditedRef.current) {
      setWorkspaceId(nextWs);
    }
  }, [detachedScope?.workspaceId, initialWorkspaceId]);

  useEffect(() => {
    const nextUser = initialUserId || detachedScope?.userId || '';
    if (nextUser && !userEditedRef.current) {
      setUserId(nextUser);
    }
  }, [detachedScope?.userId, initialUserId]);

  const handleSubmit = async (event: React.FormEvent) => {
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
          deviceLabel: 'TidyDesk Android'
        });
        setPassword('');
      } else if (authMethod === 'register') {
        if (!nativeClient.accounts.registerWithPassword) {
          throw new Error('当前环境不支持自助注册');
        }
        if (password.length < 4) {
          throw new Error('密码长度至少需要 4 位字符');
        }
        if (password !== confirmPassword) {
          throw new Error('两次输入的密码不一致');
        }
        next = await nativeClient.accounts.registerWithPassword({
          userId: userId.trim(),
          password,
          displayName: displayName.trim() || undefined,
          serverEndpoint: endpoint.trim(),
          deviceLabel: 'TidyDesk Android'
        });
        setPassword('');
        setConfirmPassword('');
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

  const canSubmit =
    Boolean(userId.trim()) &&
    Boolean(endpoint.trim()) &&
    (authMethod === 'token'
      ? Boolean(token.trim())
      : Boolean(password) && (authMethod !== 'register' || Boolean(confirmPassword)));

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0f131d] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-slate-100">
      <form
        onSubmit={event => void handleSubmit(event)}
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

        <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/25 p-1 text-[12px] font-semibold">
          <button
            type="button"
            onClick={() => {
              setAuthMethod('password');
              setAuthError('');
            }}
            className={`rounded-lg py-1.5 transition-colors ${
              authMethod === 'password' ? 'bg-sky-500/25 text-sky-100' : 'text-slate-400'
            }`}
          >
            账号登录
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMethod('register');
              setAuthError('');
            }}
            className={`rounded-lg py-1.5 transition-colors ${
              authMethod === 'register' ? 'bg-sky-500/25 text-sky-100' : 'text-slate-400'
            }`}
          >
            注册账号
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMethod('token');
              setAuthError('');
            }}
            className={`rounded-lg py-1.5 transition-colors ${
              authMethod === 'token' ? 'bg-sky-500/25 text-sky-100' : 'text-slate-400'
            }`}
          >
            Token
          </button>
        </div>

        {detachedScope && (
          <div className="space-y-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-100">
            <div>
              当前已保留 <span className="font-mono font-semibold">{detachedScope.userId}</span>（
              <span className="font-mono">{detachedScope.workspaceId}</span>）的离线数据
              {detachedScope.pendingCount > 0
                ? `（含 ${detachedScope.pendingCount} 条待同步改动）`
                : ''}
              。重登原账号与原工作区即可自动上传合并。
            </div>
            <div className="flex flex-wrap gap-2">
              {onCancelOffline && (
                <button
                  type="button"
                  onClick={onCancelOffline}
                  className="rounded-lg border border-amber-300/35 bg-black/25 px-2.5 py-1 text-[11px] font-semibold text-amber-100"
                >
                  返回继续离线编辑
                </button>
              )}
              {onWipeDetachedLocal && (
                <button
                  type="button"
                  disabled={wipingLocal}
                  onClick={() => {
                    setWipingLocal(true);
                    void onWipeDetachedLocal()
                      .catch(err => setAuthError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setWipingLocal(false));
                  }}
                  className="rounded-lg border border-rose-400/30 bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-100 disabled:opacity-45"
                >
                  {wipingLocal ? '清空中...' : '彻底清空本地离线数据'}
                </button>
              )}
            </div>
          </div>
        )}

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
              onChange={event => {
                endpointEditedRef.current = true;
                setEndpoint(event.target.value);
              }}
              placeholder="http://192.168.1.10:8787"
              autoCapitalize="none"
              autoCorrect="off"
              className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-slate-400">账号 ID</span>
            <input
              value={userId}
              onChange={event => {
                userEditedRef.current = true;
                setUserId(event.target.value);
              }}
              placeholder="字母/数字/下划线，如 alice"
              autoCapitalize="none"
              autoCorrect="off"
              className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
            />
          </label>

          {authMethod !== 'password' && (
            <label className="block space-y-1">
              <span className="text-slate-400">显示名称（可选）</span>
              <input
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                placeholder="如 小王 / 手机端"
                className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
              />
            </label>
          )}

          {authMethod === 'password' || authMethod === 'register' ? (
            <>
              <label className="block space-y-1">
                <span className="text-slate-400">
                  {authMethod === 'register' ? '设置密码（至少 4 位）' : '登录密码'}
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="输入账号密码"
                  className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
                />
              </label>
              {authMethod === 'register' && (
                <label className="block space-y-1">
                  <span className="text-slate-400">确认密码</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)}
                    placeholder="再次输入密码"
                    className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
                  />
                </label>
              )}
            </>
          ) : (
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
          )}

          {authMethod !== 'register' ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span>目标工作区</span>
                <div className="flex gap-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      workspaceEditedRef.current = true;
                      setWorkspaceId('default');
                    }}
                    className="rounded border border-white/[0.1] px-1.5 py-0.5 text-slate-300"
                  >
                    共享(default)
                  </button>
                  <button
                    type="button"
                    disabled={!userId.trim()}
                    onClick={() => {
                      workspaceEditedRef.current = true;
                      setWorkspaceId(`private:${userId.trim()}`);
                    }}
                    className="rounded border border-white/[0.1] px-1.5 py-0.5 text-slate-300 disabled:opacity-40"
                  >
                    私人空间
                  </button>
                </div>
              </div>
              <input
                value={workspaceId}
                onChange={event => {
                  workspaceEditedRef.current = true;
                  setWorkspaceId(event.target.value);
                }}
                placeholder="default 或 private:账号"
                autoCapitalize="none"
                autoCorrect="off"
                className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 font-mono text-slate-100 outline-none focus:border-sky-400/50"
              />
            </div>
          ) : (
            <p className="rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-[11px] leading-4 text-sky-100">
              注册后会自动为您开通私人工作区（<span className="font-mono">private:{userId.trim() || '账号'}</span>），进入后可直接新建共享空间或凭邀请码加入团队。
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submittingAuth || !canSubmit}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-[13px] font-bold text-white hover:bg-sky-400 disabled:opacity-45"
        >
          {submittingAuth && <Loader2 size={15} className="animate-spin" />}
          {authMethod === 'register' ? '注册并进入看板' : '验证凭据并进入看板'}
        </button>
      </form>
    </div>
  );
};
