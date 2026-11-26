import React from 'react';
import { UserCheck, UserPlus } from 'lucide-react';

export type AccountAuthMode = 'password' | 'register' | 'token';

interface AccountLoginFormProps {
  authMethod: AccountAuthMode;
  onAuthMethodChange: (method: AccountAuthMode) => void;
  userIdInput: string;
  onUserIdChange: (value: string) => void;
  passwordInput: string;
  onPasswordChange: (value: string) => void;
  confirmPasswordInput: string;
  onConfirmPasswordChange: (value: string) => void;
  displayNameInput: string;
  onDisplayNameChange: (value: string) => void;
  endpointInput: string;
  onEndpointChange: (value: string) => void;
  workspaceInput: string;
  onWorkspaceChange: (value: string) => void;
  tokenInput: string;
  onTokenChange: (value: string) => void;
  busyAction: boolean;
  onSubmit: (event: React.FormEvent) => void;
}

/**
 * Unauthenticated account login, self-service registration, and workspace isolation form
 * rendered inside AccountSyncCard without blocking local-first offline usage.
 */
export const AccountLoginForm: React.FC<AccountLoginFormProps> = ({
  authMethod,
  onAuthMethodChange,
  userIdInput,
  onUserIdChange,
  passwordInput,
  onPasswordChange,
  confirmPasswordInput,
  onConfirmPasswordChange,
  displayNameInput,
  onDisplayNameChange,
  endpointInput,
  onEndpointChange,
  workspaceInput,
  onWorkspaceChange,
  tokenInput,
  onTokenChange,
  busyAction,
  onSubmit
}) => {
  const passwordMismatch =
    authMethod === 'register' &&
    Boolean(confirmPasswordInput) &&
    passwordInput !== confirmPasswordInput;

  const canSubmit =
    !busyAction &&
    Boolean(userIdInput.trim()) &&
    (authMethod === 'token' ||
      (authMethod === 'password' && Boolean(passwordInput && endpointInput.trim())) ||
      (authMethod === 'register' &&
        passwordInput.length >= 4 &&
        passwordInput === confirmPasswordInput &&
        Boolean(endpointInput.trim())));

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-2.5 rounded-lg border border-white/[0.08] bg-slate-950/35 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-300">
          {authMethod === 'register'
            ? '注册个人账号（自动承接本机待办与便签，平时可不注册）'
            : '登录云端账号或切换工作区（可选）'}
        </span>
        <div className="flex rounded-md bg-black/30 p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => onAuthMethodChange('password')}
            className={`rounded px-2 py-0.5 ${
              authMethod === 'password' ? 'bg-sky-500/25 text-sky-100' : 'text-slate-400'
            }`}
          >
            账号登录
          </button>
          <button
            type="button"
            onClick={() => onAuthMethodChange('register')}
            className={`rounded px-2 py-0.5 ${
              authMethod === 'register' ? 'bg-emerald-500/25 text-emerald-100' : 'text-slate-400'
            }`}
          >
            注册账号
          </button>
          <button
            type="button"
            onClick={() => onAuthMethodChange('token')}
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
          onChange={event => onUserIdChange(event.target.value)}
          placeholder="账号 ID（如 alice，字母/数字）"
          className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
        />
        {authMethod === 'token' || authMethod === 'register' ? (
          <input
            value={displayNameInput}
            onChange={event => onDisplayNameChange(event.target.value)}
            placeholder="显示昵称（可选）"
            className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
          />
        ) : (
          <input
            type="password"
            value={passwordInput}
            onChange={event => onPasswordChange(event.target.value)}
            placeholder="登录密码"
            className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
          />
        )}
      </div>

      {authMethod === 'register' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="password"
            value={passwordInput}
            onChange={event => onPasswordChange(event.target.value)}
            placeholder="设置密码（至少 4 位）"
            className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
          />
          <input
            type="password"
            value={confirmPasswordInput}
            onChange={event => onConfirmPasswordChange(event.target.value)}
            placeholder="确认密码"
            className={`rounded-md border bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 ${
              passwordMismatch
                ? 'border-rose-400/60 focus:border-rose-400'
                : 'border-white/[0.08] focus:border-sky-400/40'
            }`}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <input
          value={endpointInput}
          onChange={event => onEndpointChange(event.target.value)}
          placeholder={
            authMethod === 'token'
              ? '预留服务端 URL（可选）'
              : '服务端 URL（如 http://127.0.0.1:8787）'
          }
          className={`rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40 ${
            authMethod === 'register' ? 'col-span-2' : ''
          }`}
        />
        {authMethod === 'token' && (
          <input
            type="password"
            value={tokenInput}
            onChange={event => onTokenChange(event.target.value)}
            placeholder="Token（填服务端时必填）"
            className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
          />
        )}
        {authMethod === 'password' && (
          <input
            value={workspaceInput}
            onChange={event => onWorkspaceChange(event.target.value)}
            placeholder="工作区 ID（默认 default）"
            className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
          />
        )}
      </div>

      {authMethod === 'token' && (
        <input
          value={workspaceInput}
          onChange={event => onWorkspaceChange(event.target.value)}
          placeholder="工作区 ID（默认 default，或 private:账号）"
          className="w-full rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
        />
      )}

      {passwordMismatch && (
        <div className="text-[10px] text-rose-300">两次输入的密码不一致，请核对后再提交</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {authMethod === 'register' ? (
          <span className="text-[10px] text-slate-400">
            注册后进入私人空间 <span className="font-mono text-emerald-300">private:{userIdInput.trim() || '账号'}</span>，本机既有数据保留可见
          </span>
        ) : (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <span>快捷工作区：</span>
            <button
              type="button"
              onClick={() => onWorkspaceChange('default')}
              className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-slate-300 hover:bg-white/[0.1]"
            >
              共享看板
            </button>
            <button
              type="button"
              disabled={!userIdInput.trim()}
              onClick={() => onWorkspaceChange(`private:${userIdInput.trim()}`)}
              className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-slate-300 hover:bg-white/[0.1] disabled:opacity-40"
            >
              私人空间
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${
            authMethod === 'register'
              ? 'bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/35'
              : 'bg-sky-500/20 text-sky-100 hover:bg-sky-500/30'
          }`}
        >
          {authMethod === 'register' ? <UserPlus size={12} /> : <UserCheck size={12} />}
          {authMethod === 'register'
            ? '注册并保留本地数据'
            : authMethod === 'password'
            ? '登录并挂载工作区'
            : '切换至独立账号目录'}
        </button>
      </div>
    </form>
  );
};
