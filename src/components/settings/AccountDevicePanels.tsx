import React from 'react';
import type { RemoteAuthSessionInfo } from '../../types/todo';

interface AccountEndpointEditorProps {
  activeUserId: string | null;
  endpointInput: string;
  onEndpointChange: (value: string) => void;
  tokenInput: string;
  onTokenChange: (value: string) => void;
  hasToken: boolean;
  workspaceInput: string;
  onWorkspaceChange: (value: string) => void;
  busyAction: boolean;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
}

/**
 * Inline endpoint, token, and active workspace configuration editor for signed-in accounts.
 */
export const AccountEndpointEditor: React.FC<AccountEndpointEditorProps> = ({
  activeUserId,
  endpointInput,
  onEndpointChange,
  tokenInput,
  onTokenChange,
  hasToken,
  workspaceInput,
  onWorkspaceChange,
  busyAction,
  onCancel,
  onSubmit
}) => (
  <form onSubmit={onSubmit} className="space-y-2 rounded-md border border-white/[0.08] bg-black/25 p-2.5">
    <div className="grid grid-cols-2 gap-2">
      <input
        value={endpointInput}
        onChange={event => onEndpointChange(event.target.value)}
        placeholder="服务端 URL（如 http://127.0.0.1:8787）"
        className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
      />
      <input
        type="password"
        value={tokenInput}
        onChange={event => onTokenChange(event.target.value)}
        placeholder={hasToken ? '新 Token（留空沿用已存凭据）' : '访问 Token'}
        className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
      />
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        value={workspaceInput}
        onChange={event => onWorkspaceChange(event.target.value)}
        placeholder="工作区 ID（default 或 private:账号）"
        className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
      />
      <button
        type="button"
        onClick={() => onWorkspaceChange('default')}
        className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.1]"
      >
        共享(default)
      </button>
      {activeUserId && (
        <button
          type="button"
          onClick={() => onWorkspaceChange(`private:${activeUserId}`)}
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
        onClick={onCancel}
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
);

interface AccountRemoteSessionsPanelProps {
  remoteSessions: RemoteAuthSessionInfo[];
  busyAction: boolean;
  onRevoke: (tokenId: string, isCurrent: boolean) => void;
}

/**
 * Authorized remote device sessions list with explicit token revocation.
 */
export const AccountRemoteSessionsPanel: React.FC<AccountRemoteSessionsPanelProps> = ({
  remoteSessions,
  busyAction,
  onRevoke
}) => (
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
              <span className="ml-1.5 rounded bg-emerald-500/20 px-1 text-emerald-200">本机</span>
            )}
            {item.revokedAt && <span className="ml-1.5 text-rose-300">已吊销</span>}
          </div>
          {!item.revokedAt && (
            <button
              type="button"
              disabled={busyAction}
              onClick={() => onRevoke(item.tokenId, item.isCurrent)}
              className="shrink-0 rounded border border-rose-400/25 bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-500/25"
            >
              吊销
            </button>
          )}
        </div>
      ))
    )}
  </div>
);

interface AccountPasswordPanelProps {
  oldPasswordInput: string;
  onOldPasswordChange: (value: string) => void;
  newPasswordInput: string;
  onNewPasswordChange: (value: string) => void;
  revokeAllOnPwd: boolean;
  onRevokeAllChange: (value: boolean) => void;
  busyAction: boolean;
  onSubmit: (event: React.FormEvent) => void;
}

/**
 * Password update form with optional full-session revocation toggle.
 */
export const AccountPasswordPanel: React.FC<AccountPasswordPanelProps> = ({
  oldPasswordInput,
  onOldPasswordChange,
  newPasswordInput,
  onNewPasswordChange,
  revokeAllOnPwd,
  onRevokeAllChange,
  busyAction,
  onSubmit
}) => (
  <form onSubmit={onSubmit} className="space-y-2 rounded-md border border-white/[0.08] bg-black/25 p-2.5">
    <div className="grid grid-cols-2 gap-2">
      <input
        type="password"
        value={oldPasswordInput}
        onChange={event => onOldPasswordChange(event.target.value)}
        placeholder="当前密码"
        className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500"
      />
      <input
        type="password"
        value={newPasswordInput}
        onChange={event => onNewPasswordChange(event.target.value)}
        placeholder="新密码（至少 4 位）"
        className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500"
      />
    </div>
    <div className="flex items-center justify-between gap-2">
      <label className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
        <input
          type="checkbox"
          checked={revokeAllOnPwd}
          onChange={event => onRevokeAllChange(event.target.checked)}
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
);
