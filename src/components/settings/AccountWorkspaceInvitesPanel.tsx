import React, { useState } from 'react';
import { Check, Copy, Plus, ShieldOff, Ticket, Users } from 'lucide-react';
import type { RemoteWorkspaceInfo, WorkspaceInviteInfo } from '../../types/todo';

interface AccountWorkspacePanelProps {
  activeWorkspaceId: string;
  workspaces: RemoteWorkspaceInfo[];
  invites: WorkspaceInviteInfo[];
  busyAction: boolean;
  onSwitchWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (title: string) => Promise<void>;
  onJoinByInvite: (inviteCode: string) => Promise<void>;
  onCreateInvite: (role: 'admin' | 'member' | 'viewer', maxUses: number) => Promise<void>;
  onRevokeInvite: (inviteCode: string) => Promise<void>;
  onRefreshWorkspaces: () => Promise<void>;
}

/**
 * Workspace switcher, shared workspace creator, and invite code generator/join panel.
 */
export const AccountWorkspacePanel: React.FC<AccountWorkspacePanelProps> = ({
  activeWorkspaceId,
  workspaces,
  invites,
  busyAction,
  onSwitchWorkspace,
  onCreateWorkspace,
  onJoinByInvite,
  onCreateInvite,
  onRevokeInvite,
  onRefreshWorkspaces
}) => {
  const [newWsTitle, setNewWsTitle] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteMaxUses, setInviteMaxUses] = useState(5);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const activeWs = workspaces.find(w => w.workspaceId === activeWorkspaceId);
  const canManageInvites =
    activeWs &&
    !activeWs.isPrivate &&
    (activeWs.role === 'owner' || activeWs.role === 'admin');

  const copyInviteCode = (code: string) => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode(prev => (prev === code ? null : prev)), 1800);
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-white/[0.08] bg-slate-900/55 p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
          <Users size={12} className="text-sky-300" />
          我的工作区与邀请协同
        </span>
        <button
          type="button"
          disabled={busyAction}
          onClick={() => void onRefreshWorkspaces()}
          className="text-[10px] text-sky-300 hover:text-sky-200 disabled:opacity-50"
        >
          刷新列表
        </button>
      </div>

      {/* 工作区切换列表 */}
      <div className="flex flex-wrap gap-1.5">
        {workspaces.map(ws => {
          const isCurrent = ws.workspaceId === activeWorkspaceId;
          return (
            <button
              key={ws.workspaceId}
              type="button"
              disabled={busyAction || isCurrent}
              onClick={() => onSwitchWorkspace(ws.workspaceId)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
                isCurrent
                  ? 'border-sky-400/50 bg-sky-500/20 text-sky-100'
                  : 'border-white/[0.08] bg-white/[0.04] text-slate-300 hover:bg-white/[0.1]'
              }`}
            >
              <span>{ws.title}</span>
              <span className="rounded bg-black/30 px-1 py-0.2 font-mono text-[9px] text-slate-400">
                {ws.isPrivate ? '私有' : ws.role}
              </span>
            </button>
          );
        })}
      </div>

      {/* 新建共享工作区 + 邀请码加入 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex gap-1">
          <input
            value={newWsTitle}
            onChange={e => setNewWsTitle(e.target.value)}
            placeholder="新建共享工作区名称"
            className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-[10px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
          />
          <button
            type="button"
            disabled={busyAction || !newWsTitle.trim()}
            onClick={() => {
              const title = newWsTitle.trim();
              if (!title) return;
              void onCreateWorkspace(title).then(() => setNewWsTitle(''));
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-500/20 px-2 py-1 text-[10px] font-semibold text-sky-100 hover:bg-sky-500/30 disabled:opacity-40"
          >
            <Plus size={11} />
            新建
          </button>
        </div>

        <div className="flex gap-1">
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            placeholder="输入邀请码 td_inv_..."
            className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 font-mono text-[10px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400/40"
          />
          <button
            type="button"
            disabled={busyAction || !joinCode.trim()}
            onClick={() => {
              const code = joinCode.trim();
              if (!code) return;
              void onJoinByInvite(code).then(() => setJoinCode(''));
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
          >
            <Ticket size={11} />
            加入
          </button>
        </div>
      </div>

      {/* 邀请码管理区（仅当前共享工作区 owner / admin 显示） */}
      {canManageInvites && (
        <div className="space-y-2 border-t border-white/[0.08] pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-slate-300">
              当前工作区邀请码（{activeWs?.title}）
            </span>
            <div className="flex items-center gap-1.5">
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
                className="rounded border border-white/[0.08] bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-200 outline-none"
              >
                <option value="member">成员（可读写）</option>
                <option value="viewer">访客（只读）</option>
                <option value="admin">管理员（可发邀请）</option>
              </select>
              <input
                type="number"
                min={1}
                max={100}
                value={inviteMaxUses}
                onChange={e => setInviteMaxUses(Math.max(1, Number(e.target.value) || 1))}
                title="可用次数"
                className="w-12 rounded border border-white/[0.08] bg-slate-950 px-1.5 py-0.5 text-center text-[10px] text-slate-200 outline-none"
              />
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void onCreateInvite(inviteRole, inviteMaxUses)}
                className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
              >
                生成邀请码
              </button>
            </div>
          </div>

          {invites.length > 0 && (
            <div className="space-y-1">
              {invites.map(inv => {
                const revoked = Boolean(inv.revokedAt);
                const exhausted = inv.maxUses > 0 && inv.usedCount >= inv.maxUses;
                const inactive = revoked || exhausted;
                return (
                  <div
                    key={inv.inviteCode}
                    className={`flex items-center justify-between gap-2 rounded border border-white/[0.06] px-2 py-1 text-[10px] ${
                      inactive ? 'bg-black/20 text-slate-500' : 'bg-white/[0.03] text-slate-200'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono">{inv.inviteCode}</span>
                      <span className="rounded bg-black/30 px-1 text-[9px]">
                        {inv.role} · {inv.usedCount}/{inv.maxUses || '∞'}
                      </span>
                      {revoked && <span className="text-rose-400">已撤回</span>}
                      {!revoked && exhausted && <span className="text-amber-400">已用完</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!inactive && (
                        <>
                          <button
                            type="button"
                            onClick={() => copyInviteCode(inv.inviteCode)}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-sky-300 hover:bg-white/10"
                          >
                            {copiedCode === inv.inviteCode ? <Check size={10} /> : <Copy size={10} />}
                            {copiedCode === inv.inviteCode ? '已复制' : '复制'}
                          </button>
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => void onRevokeInvite(inv.inviteCode)}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-rose-300 hover:bg-rose-500/15"
                          >
                            <ShieldOff size={10} />
                            撤回
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
