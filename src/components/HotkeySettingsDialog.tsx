import React from 'react';
import { AlertCircle, Check, Keyboard, RotateCcw, X } from 'lucide-react';
import { nativeClient } from '../native/native-client';
import type {
  HotkeyAction,
  HotkeyBinding,
  HotkeySettings,
  HotkeyUpdateResult,
  HotkeyValidationResult
} from '../types/tidydesk-api';
import { HotkeyRecorderInput } from './HotkeyRecorderInput';

interface HotkeySettingsDialogProps {
  onClose: () => void;
  onSaved?: (settings: HotkeySettings) => void;
}

const ACTION_DESCRIPTIONS: Record<HotkeyAction, string> = {
  paste_pending_sticker: '将最近一次截图直接贴到桌面',
  toggle_quick_capture: '快速打开或收起「快捷记录」独立窗口',
  toggle_files_drawer: '快速展开或收起「桌面收纳抽屉」',
  new_sticky_note: '直接在桌面新建并弹出一张可编辑便签'
};

interface DraftBinding {
  accelerator: string | null;
  displayAccelerator: string | null;
}

function statusClass(binding: HotkeyBinding | undefined) {
  if (!binding || binding.status === 'unset') return 'text-slate-500';
  if (binding.status === 'registered') return 'text-emerald-300';
  if (binding.status === 'conflict') return 'text-amber-300';
  return 'text-slate-500';
}

function toDraftMap(settings: HotkeySettings): Partial<Record<HotkeyAction, DraftBinding>> {
  const next: Partial<Record<HotkeyAction, DraftBinding>> = {};
  for (const item of settings.bindings) {
    next[item.action] = {
      accelerator: item.accelerator ?? null,
      displayAccelerator: item.displayAccelerator ?? item.accelerator ?? null
    };
  }
  return next;
}

export const HotkeySettingsDialog: React.FC<HotkeySettingsDialogProps> = ({ onClose, onSaved }) => {
  const [settings, setSettings] = React.useState<HotkeySettings | null>(null);
  const [drafts, setDrafts] = React.useState<Partial<Record<HotkeyAction, DraftBinding>>>({});
  const [validations, setValidations] = React.useState<
    Partial<Record<HotkeyAction, HotkeyValidationResult>>
  >({});
  const [message, setMessage] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    let disposed = false;
    nativeClient.hotkeys
      .getSettings()
      .then(nextSettings => {
        if (disposed) return;
        setSettings(nextSettings);
        setDrafts(toDraftMap(nextSettings));
        setMessage('');
      })
      .catch(err => {
        if (!disposed) {
          setMessage(`快捷键设置加载失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const changedActions = React.useMemo(() => {
    if (!settings) return [] as HotkeyBinding[];
    return settings.bindings.filter(binding => {
      const draft = drafts[binding.action];
      const nextAcc = draft?.accelerator ?? null;
      const prevAcc = binding.accelerator ?? null;
      return prevAcc !== nextAcc || Boolean(binding.enabled) !== Boolean(nextAcc);
    });
  }, [drafts, settings]);

  React.useEffect(() => {
    if (!settings) return undefined;
    let disposed = false;

    const validateAll = async () => {
      const entries = await Promise.all(
        settings.bindings.map(async binding => {
          const draft = drafts[binding.action];
          const acc = draft?.accelerator ?? null;
          if (!acc) {
            return [
              binding.action,
              {
                valid: true,
                reason: null,
                message: '未绑定快捷键',
                normalizedAccelerator: null,
                displayAccelerator: null
              } satisfies HotkeyValidationResult
            ] as const;
          }

          // 先检查弹窗内同批次未保存草稿之间的快捷键冲突
          const duplicate = settings.bindings.find(other => {
            if (other.action === binding.action) return false;
            const otherAcc = drafts[other.action]?.accelerator ?? null;
            return Boolean(otherAcc && otherAcc.toLowerCase() === acc.toLowerCase());
          });
          if (duplicate) {
            return [
              binding.action,
              {
                valid: false,
                reason: 'internalConflict',
                message: `与「${duplicate.label}」冲突`,
                normalizedAccelerator: acc,
                displayAccelerator: draft?.displayAccelerator ?? acc
              } satisfies HotkeyValidationResult
            ] as const;
          }

          try {
            const res = await nativeClient.hotkeys.validateBinding({
              action: binding.action,
              accelerator: acc,
              enabled: true
            });
            return [binding.action, res] as const;
          } catch (err) {
            return [
              binding.action,
              {
                valid: false,
                reason: 'validationError',
                message: err instanceof Error ? err.message : String(err),
                normalizedAccelerator: null,
                displayAccelerator: null
              } satisfies HotkeyValidationResult
            ] as const;
          }
        })
      );

      if (disposed) return;
      const map: Partial<Record<HotkeyAction, HotkeyValidationResult>> = {};
      for (const [action, result] of entries) {
        map[action] = result;
      }
      setValidations(map);
    };

    void validateAll();
    return () => {
      disposed = true;
    };
  }, [drafts, settings]);

  const allValid = Boolean(
    settings &&
      settings.bindings.every(binding => {
        const result = validations[binding.action];
        return result ? result.valid : true;
      })
  );
  const canSave = !isLoading && !isSaving && changedActions.length > 0 && allValid;

  const applyResult = (result: HotkeyUpdateResult) => {
    setSettings(result.settings);
    setDrafts(toDraftMap(result.settings));
    setMessage(result.message || (result.success ? '快捷键已生效，无需重启' : '快捷键保存失败'));
    if (result.success) onSaved?.(result.settings);
  };

  const handleSave = async () => {
    if (!canSave || !settings) return;
    setIsSaving(true);
    setMessage('');
    try {
      // 先保存清空/关闭项，再写入新绑定，避免交叉换键时的瞬时冲突
      const ordered = [...changedActions].sort((a, b) => {
        const aHas = Boolean(drafts[a.action]?.accelerator);
        const bHas = Boolean(drafts[b.action]?.accelerator);
        return Number(aHas) - Number(bHas);
      });

      let latestResult: HotkeyUpdateResult | null = null;
      for (const item of ordered) {
        const nextAcc = drafts[item.action]?.accelerator ?? null;
        latestResult = await nativeClient.hotkeys.updateBinding({
          action: item.action,
          accelerator: nextAcc,
          enabled: Boolean(nextAcc)
        });
        if (!latestResult.success) {
          applyResult(latestResult);
          return;
        }
      }
      if (latestResult) {
        applyResult(latestResult);
      }
    } catch (err) {
      setMessage(`快捷键保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    setMessage('');
    try {
      applyResult(await nativeClient.hotkeys.resetDefaults());
    } catch (err) {
      setMessage(`恢复默认失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-[560px] max-w-[94vw] flex-col rounded-xl border border-white/[0.12] bg-[#11131c] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-sky-500/10 p-2 text-sky-200">
              <Keyboard size={16} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-100">全局快捷键设置</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">支持自定义各项快捷操作的系统热键</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {isLoading ? (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-6 text-center text-[12px] text-slate-400">
              正在读取快捷键配置...
            </div>
          ) : (
            (settings?.bindings || []).map(binding => {
              const draft = drafts[binding.action] ?? {
                accelerator: binding.accelerator,
                displayAccelerator: binding.displayAccelerator
              };
              const validation = validations[binding.action];
              const isEdited =
                (binding.accelerator ?? null) !== draft.accelerator ||
                Boolean(binding.enabled) !== Boolean(draft.accelerator);

              return (
                <div
                  key={binding.action}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-slate-100">
                          {binding.label}
                        </span>
                        {isEdited && (
                          <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-200">
                            待保存
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {ACTION_DESCRIPTIONS[binding.action]}
                      </div>
                    </div>

                    <HotkeyRecorderInput
                      value={draft.accelerator}
                      displayValue={validation?.displayAccelerator || draft.displayAccelerator}
                      disabled={isSaving}
                      onChange={nextValue => {
                        setDrafts(prev => ({
                          ...prev,
                          [binding.action]: {
                            accelerator: nextValue,
                            displayAccelerator: nextValue
                          }
                        }));
                        setMessage('');
                      }}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-3 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      {validation && !validation.valid ? (
                        <>
                          <AlertCircle className="text-amber-300" size={12} />
                          <span className="text-amber-200">{validation.message}</span>
                        </>
                      ) : (
                        <>
                          <Check
                            className={
                              draft.accelerator ? 'text-emerald-300' : 'text-slate-500'
                            }
                            size={12}
                          />
                          <span className={draft.accelerator ? 'text-emerald-200' : 'text-slate-500'}>
                            {validation?.message || '未设置'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className={`font-semibold ${statusClass(binding)}`}>
                      {binding.statusMessage || '未绑定'}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {message && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] text-slate-300">
              {message}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.08] px-5 py-4">
          <button
            type="button"
            disabled={isSaving || isLoading}
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] text-slate-400 hover:bg-white/[0.08] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw size={13} />
            恢复默认
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-[12px] text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={handleSave}
              className="rounded-md bg-sky-500 px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
