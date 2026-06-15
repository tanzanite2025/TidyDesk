import React from 'react';
import { AlertCircle, Check, Keyboard, RotateCcw, X } from 'lucide-react';
import { nativeClient } from '../native/native-client';
import type {
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

const PASTE_PENDING_STICKER = 'paste_pending_sticker';

function pasteBinding(settings: HotkeySettings | null): HotkeyBinding | null {
  return settings?.bindings.find(binding => binding.action === PASTE_PENDING_STICKER) ?? null;
}

function statusClass(binding: HotkeyBinding | null) {
  if (!binding || binding.status === 'unset') return 'text-slate-400';
  if (binding.status === 'registered') return 'text-emerald-300';
  if (binding.status === 'conflict') return 'text-amber-300';
  return 'text-slate-500';
}

function resultMessage(result: HotkeyUpdateResult) {
  return result.message || (result.success ? '快捷键已生效，无需重启' : '快捷键保存失败');
}

export const HotkeySettingsDialog: React.FC<HotkeySettingsDialogProps> = ({ onClose, onSaved }) => {
  const [settings, setSettings] = React.useState<HotkeySettings | null>(null);
  const [accelerator, setAccelerator] = React.useState<string | null>(null);
  const [displayAccelerator, setDisplayAccelerator] = React.useState<string | null>(null);
  const [validation, setValidation] = React.useState<HotkeyValidationResult | null>(null);
  const [message, setMessage] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    let disposed = false;
    nativeClient.hotkeys
      .getSettings()
      .then(nextSettings => {
        if (disposed) return;
        const binding = pasteBinding(nextSettings);
        setSettings(nextSettings);
        setAccelerator(binding?.accelerator ?? null);
        setDisplayAccelerator(binding?.displayAccelerator ?? null);
        setMessage('');
      })
      .catch(err => {
        if (!disposed) setMessage(`快捷键设置加载失败: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  React.useEffect(() => {
    if (!settings) return undefined;
    let disposed = false;
    nativeClient.hotkeys
      .validateBinding({
        action: PASTE_PENDING_STICKER,
        accelerator,
        enabled: Boolean(accelerator)
      })
      .then(result => {
        if (disposed) return;
        setValidation(result);
        if (result.displayAccelerator) setDisplayAccelerator(result.displayAccelerator);
      })
      .catch(err => {
        if (!disposed) {
          setValidation({
            valid: false,
            reason: 'validationError',
            message: err instanceof Error ? err.message : String(err),
            normalizedAccelerator: null,
            displayAccelerator: null
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [accelerator, settings]);

  const binding = pasteBinding(settings);
  const hasChanged = (binding?.accelerator ?? null) !== accelerator || Boolean(binding?.enabled) !== Boolean(accelerator);
  const canSave = !isLoading && !isSaving && Boolean(validation?.valid) && hasChanged;

  const applyResult = (result: HotkeyUpdateResult) => {
    setSettings(result.settings);
    const nextBinding = pasteBinding(result.settings);
    setAccelerator(nextBinding?.accelerator ?? null);
    setDisplayAccelerator(nextBinding?.displayAccelerator ?? null);
    setMessage(resultMessage(result));
    if (result.success) onSaved?.(result.settings);
  };

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    setMessage('');
    try {
      applyResult(
        await nativeClient.hotkeys.updateBinding({
          action: PASTE_PENDING_STICKER,
          accelerator,
          enabled: Boolean(accelerator)
        })
      );
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
      <div className="w-[520px] rounded-xl border border-white/[0.12] bg-[#11131c] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-sky-500/10 p-2 text-sky-200">
              <Keyboard size={16} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-100">快捷键设置</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">配置 TidyDesk 的全局快捷键</p>
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

        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-slate-100">截图贴纸</div>
                <div className="mt-0.5 text-[11px] text-slate-500">贴出最近一次待贴截图</div>
              </div>
              <div className={`text-[11px] font-semibold ${statusClass(binding)}`}>
                {binding?.statusMessage || (isLoading ? '加载中...' : '未设置')}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="text-[12px] text-slate-300">贴出最近截图</div>
              <HotkeyRecorderInput
                value={accelerator}
                displayValue={displayAccelerator}
                disabled={isLoading || isSaving}
                onChange={nextValue => {
                  setAccelerator(nextValue);
                  setDisplayAccelerator(nextValue);
                  setMessage('');
                }}
              />
            </div>

            <div className="mt-3 flex items-start gap-2 text-[11px]">
              {validation?.valid ? (
                <Check className="mt-0.5 text-emerald-300" size={13} />
              ) : (
                <AlertCircle className="mt-0.5 text-amber-300" size={13} />
              )}
              <span className={validation?.valid ? 'text-emerald-200' : 'text-amber-200'}>
                {validation?.message || '请按 Ctrl 或 Alt + 一个主键'}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-white/[0.08] bg-slate-950/35 p-4">
            <div className="mb-2 text-[12px] font-semibold text-slate-300">常用操作（后续扩展）</div>
            <div className="space-y-1 text-[11px] text-slate-500">
              <div className="flex justify-between"><span>开始截图</span><span>未设置</span></div>
              <div className="flex justify-between"><span>快速记录</span><span>未设置</span></div>
              <div className="flex justify-between"><span>显示/隐藏把手</span><span>未设置</span></div>
            </div>
          </div>

          {message && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] text-slate-300">
              {message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.08] px-5 py-4">
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
              className="rounded-md bg-sky-500 px-3 py-2 text-[12px] font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
