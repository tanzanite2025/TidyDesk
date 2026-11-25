import React from 'react';
import { AlertCircle, CheckCircle2, HardDriveDownload, RotateCcw, ShieldCheck } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { DataSnapshotSummary } from '../../types/tidydesk-api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatSnapshotTime(msText: string): string {
  const parsed = Number(msText);
  if (!Number.isFinite(parsed) || parsed <= 0) return msText;
  return new Date(parsed).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Local snapshot backup, SHA-256 integrity verification, and safe pre-backed restore card.
 */
export const DataBackupCard: React.FC = () => {
  const [snapshots, setSnapshots] = React.useState<DataSnapshotSummary[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [error, setError] = React.useState('');

  const loadSnapshots = React.useCallback(async () => {
    if (!nativeClient.isAvailable()) return;
    try {
      const items = await nativeClient.backup.listSnapshots();
      setSnapshots(items.slice(0, 5));
    } catch (err) {
      setError(`读取快照列表失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  React.useEffect(() => {
    void loadSnapshots();
    return nativeClient.accounts.onSessionChanged(() => {
      void loadSnapshots();
    });
  }, [loadSnapshots]);

  const handleCreate = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await nativeClient.backup.createSnapshot();
      await loadSnapshots();
      setNotice(
        `快照备份成功：共 ${created.fileCount} 个文件 (${formatBytes(created.totalBytes)})，作用域 ${created.scopeId}`
      );
    } catch (err) {
      setError(`创建快照失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (snapshot: DataSnapshotSummary) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const report = await nativeClient.backup.verifySnapshot(snapshot.snapshotDir);
      setNotice(
        `SHA-256 校验通过：${report.verifiedFiles} 个文件完整无篡改 (${formatBytes(report.totalBytes)})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (snapshot: DataSnapshotSummary) => {
    if (
      !confirm(
        `确认恢复到快照「${formatSnapshotTime(snapshot.createdAtMs)}」（作用域：${snapshot.scopeId}）？\n系统会在恢复前先自动备份当前全部数据，避免误覆盖丢失。`
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const summary = await nativeClient.backup.restoreSnapshot(snapshot.snapshotDir);
      await loadSnapshots();
      setNotice(`已安全恢复 ${summary.restoredFiles} 个文件，并自动保留恢复前保护快照。`);
    } catch (err) {
      setError(`快照恢复失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-slate-200">数据安全与快照备份</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleCreate()}
          className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-500/15 px-3 py-1 text-[11px] font-semibold text-sky-100 transition-colors hover:bg-sky-500/25 disabled:opacity-50"
        >
          <HardDriveDownload size={13} />
          立即备份快照
        </button>
      </div>

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
        <div className="text-[11px] leading-4 text-slate-400">
          备份范围：当前工作区的待办看板、卡片正文与附件、速记、桌面便签及离线同步队列（带 SHA-256 校验清单）。
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {notice && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span className="break-all">{notice}</span>
          </div>
        )}

        {snapshots.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-white/[0.08] px-3 py-3 text-center text-[11px] text-slate-500">
            暂无本地数据快照，点击右上角「立即备份快照」创建第一份可校验副本。
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {snapshots.map(item => (
              <div
                key={item.snapshotDir}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  item.corruptError
                    ? 'border-rose-400/25 bg-rose-500/10'
                    : 'border-white/[0.06] bg-black/20'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-200">
                    <span>{formatSnapshotTime(item.createdAtMs)}</span>
                    <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-normal text-slate-300">
                      {item.scopeId}
                    </span>
                  </div>
                  {item.corruptError ? (
                    <div className="mt-0.5 break-all text-[10px] text-rose-200">
                      清单异常：{item.corruptError}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {item.fileCount} 文件 · {formatBytes(item.totalBytes)} · v{item.appVersion}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy || Boolean(item.corruptError)}
                    onClick={() => void handleVerify(item)}
                    className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] bg-white/[0.06] px-2 py-1 text-[10px] font-medium text-slate-200 hover:bg-white/[0.12] disabled:opacity-40"
                  >
                    <ShieldCheck size={12} />
                    校验
                  </button>
                  <button
                    type="button"
                    disabled={busy || Boolean(item.corruptError)}
                    onClick={() => void handleRestore(item)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-40"
                  >
                    <RotateCcw size={12} />
                    恢复
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
