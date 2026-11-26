import React from 'react';
import {
  ArrowUpRight,
  Check,
  Circle,
  Copy,
  Download,
  Grid3X3,
  Highlighter,
  ListOrdered,
  MousePointer,
  Pencil,
  Pin,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X
} from 'lucide-react';
import type { SnipOutputAction, SnipTargetKind } from '../../../types/tidydesk-api';
import {
  ANNOTATION_COLORS,
  FONT_SIZE_PRESETS,
  MOSAIC_BLOCK_PRESETS,
  STROKE_WIDTH_PRESETS,
  type AnnotationStyle,
  type AnnotationTool
} from '../annotations/types';

interface SnipToolbarProps {
  x: number;
  y: number;
  activeTool: AnnotationTool;
  style: AnnotationStyle;
  canUndo: boolean;
  canRedo: boolean;
  hasAnnotations: boolean;
  targetKind: SnipTargetKind;
  disabled: boolean;
  onSelectTool: (tool: AnnotationTool) => void;
  onUpdateStyle: (patch: Partial<AnnotationStyle>) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearAnnotations: () => void;
  onAction: (action: SnipOutputAction) => void;
  onCancel: () => void;
}

const TOOL_ITEMS: readonly {
  id: AnnotationTool;
  label: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'select', label: '选区/移动图形', Icon: MousePointer },
  { id: 'rect', label: '矩形框选', Icon: Square },
  { id: 'ellipse', label: '椭圆标注', Icon: Circle },
  { id: 'arrow', label: '实心箭头 (按住Shift对齐)', Icon: ArrowUpRight },
  { id: 'brush', label: '自由画笔', Icon: Pencil },
  { id: 'highlighter', label: '荧光笔', Icon: Highlighter },
  { id: 'mosaic', label: '马赛克打码', Icon: Grid3X3 },
  { id: 'text', label: '文字标注', Icon: Type },
  { id: 'step', label: '序号气泡 ①②③', Icon: ListOrdered }
];

/** Floating two-row screenshot annotation toolbar anchored cleanly to the active selection. */
export const SnipToolbar: React.FC<SnipToolbarProps> = ({
  x,
  y,
  activeTool,
  style,
  canUndo,
  canRedo,
  hasAnnotations,
  targetKind,
  disabled,
  onSelectTool,
  onUpdateStyle,
  onUndo,
  onRedo,
  onClearAnnotations,
  onAction,
  onCancel
}) => {
  const showStyleBar = activeTool !== 'select';
  const showColorBar = activeTool !== 'mosaic' && activeTool !== 'select';

  return (
    <div
      data-testid="snip-floating-toolbar"
      className="fixed z-30 flex flex-col gap-1.5 select-none"
      style={{ left: x, top: y }}
      onMouseDown={e => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={e => e.stopPropagation()}
    >
      {/* 主操作条：标注工具 + 撤销重做 + 输出动作 */}
      <div className="flex items-center gap-1 rounded-xl border border-white/15 bg-slate-950/92 px-2 py-1.5 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-0.5">
          {TOOL_ITEMS.map(({ id, label, Icon }) => {
            const active = activeTool === id;
            return (
              <button
                key={id}
                type="button"
                title={label}
                disabled={disabled}
                onClick={() => onSelectTool(id)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                  active
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>

        <div className="mx-1 h-4 w-px bg-white/15" />

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="撤销 (Ctrl+Z)"
            disabled={disabled || !canUndo}
            onClick={onUndo}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="重做 (Ctrl+Shift+Z)"
            disabled={disabled || !canRedo}
            onClick={onRedo}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          {hasAnnotations && (
            <button
              type="button"
              title="清空全部标注"
              disabled={disabled}
              onClick={onClearAnnotations}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-rose-300 transition-colors hover:bg-rose-500/20 hover:text-rose-200"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mx-1 h-4 w-px bg-white/15" />

        {/* 多输出出口控制组 */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="另存为 PNG 文件"
            disabled={disabled}
            onClick={() => onAction('save_as')}
            className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" />
            <span>另存</span>
          </button>

          {targetKind !== 'todo_card' && (
            <button
              type="button"
              title="直接贴图固定到桌面"
              disabled={disabled}
              onClick={() => onAction('pin_sticker')}
              className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 hover:text-amber-100"
            >
              <Pin className="h-3.5 w-3.5" />
              <span>贴图</span>
            </button>
          )}

          {targetKind === 'todo_card' && (
            <button
              type="button"
              title="复制到剪贴板"
              disabled={disabled}
              onClick={() => onAction('copy')}
              className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>复制</span>
            </button>
          )}

          <button
            type="button"
            title="取消截图 (Esc)"
            disabled={disabled}
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          {targetKind === 'todo_card' ? (
            <button
              type="button"
              title="添加到当前待办卡片 (Enter)"
              disabled={disabled}
              onClick={() => onAction('attach_todo')}
              className="flex h-7 items-center gap-1 rounded-lg bg-emerald-500 px-2.5 text-[11px] font-bold text-white shadow hover:bg-emerald-400"
            >
              <Check className="h-3.5 w-3.5" />
              <span>添加到卡片</span>
            </button>
          ) : (
            <button
              type="button"
              title="复制到剪贴板并完成 (Enter)"
              disabled={disabled}
              onClick={() => onAction('copy')}
              className="flex h-7 items-center gap-1 rounded-lg bg-sky-500 px-2.5 text-[11px] font-bold text-white shadow hover:bg-sky-400"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>复制</span>
            </button>
          )}
        </div>
      </div>

      {/* 子属性栏：颜色与粗细/字号/马赛克粒度 */}
      {showStyleBar && (
        <div className="flex w-fit items-center gap-2 rounded-xl border border-white/12 bg-slate-950/90 px-2.5 py-1 shadow-xl backdrop-blur-md">
          {showColorBar && (
            <div className="flex items-center gap-1.5">
              {ANNOTATION_COLORS.map(color => {
                const selected = style.color.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={color}
                    type="button"
                    title={`颜色 ${color}`}
                    onClick={() => onUpdateStyle({ color })}
                    className={`h-4 w-4 rounded-full border transition-transform ${
                      selected
                        ? 'scale-110 border-white ring-2 ring-sky-400/70'
                        : 'border-white/30 hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          )}

          {showColorBar && <div className="h-3.5 w-px bg-white/15" />}

          {activeTool === 'text' ? (
            <div className="flex items-center gap-1">
              {FONT_SIZE_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => onUpdateStyle({ fontSize: preset.value })}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    style.fontSize === preset.value
                      ? 'bg-sky-500 text-white'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ) : activeTool === 'mosaic' ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400">像素块</span>
              {MOSAIC_BLOCK_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => onUpdateStyle({ mosaicBlockSize: preset.value })}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    style.mosaicBlockSize === preset.value
                      ? 'bg-sky-500 text-white'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {STROKE_WIDTH_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  type="button"
                  title={`线宽：${preset.label}`}
                  onClick={() => onUpdateStyle({ strokeWidth: preset.value })}
                  className={`flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-bold ${
                    style.strokeWidth === preset.value
                      ? 'bg-sky-500 text-white'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <span
                    className="inline-block rounded-full bg-current"
                    style={{
                      width: Math.max(4, preset.value + 2),
                      height: Math.max(4, preset.value + 2)
                    }}
                  />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
