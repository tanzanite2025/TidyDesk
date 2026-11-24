import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Crop,
  Film,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Maximize2,
  Scissors,
  Smartphone,
  Star,
  Trash2,
  UploadCloud
} from 'lucide-react';
import { getNativeCapabilities } from '../../native/native-client';
import type {
  TodoAttachment,
  TodoAttachmentFocalPoint,
  TodoAttachmentPreviewMode
} from '../../types/todo';
import {
  attachmentImageStyle,
  formatOrientationLabel,
  isAttachmentContainMode
} from './mediaUtils';
import { TodoLightboxModal } from './TodoLightboxModal';

type MediaTab = 'image' | 'video';

interface TodoAttachmentsSectionProps {
  attachments: TodoAttachment[];
  coverAttachmentId: string | null;
  isUploading: boolean;
  compact?: boolean;
  title?: string;
  onActivateTarget?: () => void;
  onOpenCamera: () => void;
  onStartSnip: () => void;
  onPickImage: () => void;
  onUploadFiles: (files: FileList | File[]) => void | Promise<void>;
  onSetCover: (attachmentId: string | null) => void;
  onUpdateMeta: (
    attachmentId: string,
    patch: { focalPoint?: TodoAttachmentFocalPoint; previewMode?: TodoAttachmentPreviewMode }
  ) => void;
  onDeleteAttachment: (attachmentId: string) => void;
}

/**
 * Layered media attachments workspace: category tabs (image/video placeholder), upload dropzone,
 * 4:3 thumbnail gallery with orientation badges & non-destructive framing toggles, and original lightbox.
 */
export const TodoAttachmentsSection: React.FC<TodoAttachmentsSectionProps> = ({
  attachments,
  coverAttachmentId,
  isUploading,
  compact = false,
  title,
  onActivateTarget,
  onOpenCamera,
  onStartSnip,
  onPickImage,
  onUploadFiles,
  onSetCover,
  onUpdateMeta,
  onDeleteAttachment
}) => {
  const [activeTab, setActiveTab] = useState<MediaTab>('image');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [brokenSrcs, setBrokenSrcs] = useState<Record<string, true>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCameraInputRef = useRef<HTMLInputElement | null>(null);
  const capabilities = getNativeCapabilities();

  useEffect(() => {
    setBrokenSrcs({});
  }, [attachments]);

  const imageAttachments = attachments.filter(item => item.kind !== 'video');
  const videoAttachments = attachments.filter(item => item.kind === 'video');

  const markSrcBroken = (src: string) => {
    setBrokenSrcs(prev => (prev[src] ? prev : { ...prev, [src]: true }));
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    if (isUploading) return;
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      void onUploadFiles(event.dataTransfer.files);
    }
  };

  return (
    <section
      onMouseDown={() => onActivateTarget?.()}
      className={
        compact
          ? 'rounded-lg border border-white/[0.08] bg-slate-950/45 p-3'
          : 'rounded-xl border border-white/[0.08] bg-white/[0.025] p-4'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ImageIcon size={compact ? 13 : 14} className="text-amber-300" />
          <span className={`${compact ? 'text-[11px]' : 'text-[12px]'} font-bold text-slate-200`}>
            {title || (compact ? '子任务多媒体附件' : '多媒体附件专区')}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-slate-950/50 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('image')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-colors ${
              activeTab === 'image'
                ? 'bg-sky-400/20 text-sky-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ImageIcon size={12} />
            图片 ({imageAttachments.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('video')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-colors ${
              activeTab === 'video'
                ? 'bg-sky-400/20 text-sky-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Film size={12} />
            视频 ({videoAttachments.length})
          </button>
        </div>
      </div>

      {activeTab === 'image' ? (
        <div className="mt-3 space-y-3">
          {/* Layer 1: Upload / Capture Dropzone */}
          <div
            onDragOver={event => {
              event.preventDefault();
              if (!isDragOver) setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            className={`space-y-2.5 rounded-xl border border-dashed px-3.5 py-3 transition-colors ${
              isDragOver
                ? 'border-sky-400/60 bg-sky-500/10'
                : 'border-white/[0.12] bg-slate-950/35'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-sky-300">
                {isUploading ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <UploadCloud size={15} />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-200">
                  图片上传与采集区（原图无损保留）
                </div>
                <div className="text-[10px] text-slate-500">
                  支持拖拽图片到此区域、弹窗内直接 Ctrl+V 粘贴，或点击下方采集；自动校正手机竖拍方向
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {!capabilities.canUseNativeFileDialog && (
                <>
                  <input
                    ref={mobileCameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={event => {
                      if (event.target.files && event.target.files.length > 0) {
                        void onUploadFiles(event.target.files);
                        event.target.value = '';
                      }
                    }}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                    multiple
                    className="hidden"
                    onChange={event => {
                      if (event.target.files && event.target.files.length > 0) {
                        void onUploadFiles(event.target.files);
                        event.target.value = '';
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => mobileCameraInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg border border-sky-400/25 bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/25 disabled:opacity-50"
                    title="调起手机系统原生相机拍照"
                  >
                    <Smartphone size={12} className="text-sky-300" />
                    手机直拍
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={isUploading}
                onClick={onOpenCamera}
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
                title="调用摄像头拍照"
              >
                <Camera size={12} className="text-sky-300" />
                拍照
              </button>
              {capabilities.canScreenSnip && (
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={onStartSnip}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
                  title="框选屏幕截图加入卡片"
                >
                  <Scissors size={12} className="text-emerald-300" />
                  截屏
                </button>
              )}
              <button
                type="button"
                disabled={isUploading}
                onClick={() => {
                  if (capabilities.canUseNativeFileDialog) {
                    onPickImage();
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
                title="选择图片加入卡片"
              >
                <ImagePlus size={12} className="text-amber-300" />
                {capabilities.canUseNativeFileDialog ? '本地选图' : '相册选图'}
              </button>
            </div>
          </div>

          {/* Layer 2: Responsive 4:3 Preview Gallery */}
          {imageAttachments.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between text-[10px] text-slate-500">
                <span className="font-semibold uppercase tracking-wider">
                  预览画廊（点击查看完整原图）
                </span>
                <span>卡片仅截取前 2 张展示</span>
              </div>
              <div
                className={
                  compact
                    ? 'grid grid-cols-3 gap-2 sm:grid-cols-4'
                    : 'grid grid-cols-2 gap-2.5 sm:grid-cols-3'
                }
              >
                {imageAttachments.map((att, index) => {
                  const isCover = coverAttachmentId === att.id;
                  const thumbSrc = att.thumbUrl || att.assetUrl;
                  const useContain = isAttachmentContainMode(att);

                  return (
                    <div
                      key={att.id}
                      className={`group overflow-hidden rounded-xl border bg-black/40 ${
                        isCover
                          ? 'border-sky-400/60 ring-1 ring-sky-400/30'
                          : 'border-white/[0.08]'
                      }`}
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/50">
                        <button
                          type="button"
                          onClick={() => {
                            if (thumbSrc && brokenSrcs[thumbSrc]) {
                              setBrokenSrcs(prev => {
                                const next = { ...prev };
                                delete next[thumbSrc];
                                return next;
                              });
                            }
                            setPreviewIndex(index);
                          }}
                          className="block h-full w-full text-left"
                          title={`查看完整原图：${att.originalName} (${att.width}×${att.height})`}
                        >
                          {thumbSrc && !brokenSrcs[thumbSrc] ? (
                            <img
                              src={thumbSrc}
                              alt={att.originalName}
                              loading="lazy"
                              onError={() => markSrcBroken(thumbSrc)}
                              style={attachmentImageStyle(att)}
                              className={`h-full w-full transition-transform duration-200 group-hover:scale-105 ${
                                useContain ? 'object-contain p-1' : 'object-cover'
                              }`}
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center text-[10px] text-slate-500">
                              {thumbSrc ? '图片加载失败' : '无预览'}
                            </div>
                          )}
                        </button>

                        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[9px] text-slate-200 backdrop-blur-sm">
                          {formatOrientationLabel(att)}
                        </span>
                        {att.syncState && att.syncState !== 'local' && (
                          <span
                            className={`pointer-events-none absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold backdrop-blur-sm ${
                              att.syncState === 'synced'
                                ? 'bg-emerald-500/80 text-white'
                                : 'bg-amber-500/80 text-slate-950'
                            }`}
                          >
                            {att.syncState === 'synced' ? '已同步' : '待传'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-1 border-t border-white/[0.06] bg-slate-950/85 px-1.5 py-1">
                        <button
                          type="button"
                          onClick={() => onSetCover(isCover ? null : att.id)}
                          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                            isCover
                              ? 'bg-sky-500/80 text-white'
                              : 'bg-white/[0.06] text-slate-300 hover:bg-white/15'
                          }`}
                          title={isCover ? '取消看板封面' : '设为看板封面'}
                        >
                          <Star size={9} fill={isCover ? 'currentColor' : 'none'} />
                          {isCover ? '封面' : '设封面'}
                        </button>

                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateMeta(att.id, {
                                previewMode: useContain ? 'cover' : 'contain'
                              })
                            }
                            className={`rounded p-1 ${
                              useContain
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'text-slate-400 hover:bg-white/10 hover:text-slate-200'
                            }`}
                            title={
                              useContain
                                ? '当前：完整不裁切显示（点击切换填充取景）'
                                : '当前：焦点填充取景（点击切换完整不裁切）'
                            }
                          >
                            {useContain ? <Maximize2 size={10} /> : <Crop size={10} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`删除图片附件 "${att.originalName}"？`)) {
                                onDeleteAttachment(att.id);
                              }
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-rose-500/70 hover:text-white"
                            title="删除图片"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-white/[0.1] bg-slate-950/35 px-4 py-6 text-center">
          <div className="mx-auto grid h-9 w-9 place-items-center rounded-lg bg-white/[0.06] text-slate-300">
            <Film size={16} />
          </div>
          <div className="mt-2 text-[12px] font-semibold text-slate-200">
            视频附件与播放区（架构已预留扩展）
          </div>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">
            前后端媒体类型与卡片双格角标已就绪；后续阶段将在 `tauri.conf.json` 放行 `media-src` 后接入 MP4/WebM 上传、短视频录制与预览。
          </div>
        </div>
      )}

      {previewIndex !== null && (
        <TodoLightboxModal
          attachments={imageAttachments}
          activeIndex={previewIndex}
          coverAttachmentId={coverAttachmentId}
          onIndexChange={setPreviewIndex}
          onSetCover={onSetCover}
          onUpdateMeta={onUpdateMeta}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </section>
  );
};
