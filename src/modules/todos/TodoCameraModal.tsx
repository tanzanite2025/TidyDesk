import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X } from 'lucide-react';

interface TodoCameraModalProps {
  isUploading: boolean;
  onCapture: (fileName: string, bytes: number[]) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Webcam capture modal that previews live video, captures a PNG frame, and releases all tracks cleanly on exit.
 */
export const TodoCameraModal: React.FC<TodoCameraModalProps> = ({
  isUploading,
  onCapture,
  onClose
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);
  const [capturedBytes, setCapturedBytes] = useState<number[] | null>(null);
  const [cameraError, setCameraError] = useState<string>('');
  const [isStarting, setIsStarting] = useState(true);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const clearPreview = useCallback(() => {
    setCapturedBytes(null);
    setCapturedPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const startCamera = useCallback(async (deviceId?: string) => {
    stopStream();
    setIsStarting(true);
    setCameraError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setIsStarting(false);
      setCameraError('当前运行环境不支持浏览器摄像头接口（mediaDevices 不可用）。');
      return;
    }

    try {
      const videoConstraint: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } };

      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(err => {
          console.warn('[TIDYDESK] Camera preview autoplay warning:', err);
        });
      }

      const enumerated = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = enumerated.filter(item => item.kind === 'videoinput');
      setDevices(videoInputs);
      const activeTrackDevice = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeTrackDevice) {
        setSelectedDeviceId(activeTrackDevice);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCameraError(`无法打开摄像头：${message}。请检查系统隐私设置中的桌面应用相机权限，或改用“截屏 / 选图”。`);
    } finally {
      setIsStarting(false);
    }
  }, [stopStream]);

  useEffect(() => {
    if (!capturedPreviewUrl && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(err => {
        console.warn('[TIDYDESK] Camera preview resume warning:', err);
      });
    }
  }, [capturedPreviewUrl]);

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      stopStream();
      setCapturedPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [startCamera, stopStream]);

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setCameraError('摄像头画面尚未就绪，请稍候再试。');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError('无法创建画布上下文以抓取照片。');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async blob => {
      if (!mountedRef.current) return;
      if (!blob) {
        setCameraError('照片编码失败。');
        return;
      }
      const buffer = await blob.arrayBuffer();
      if (!mountedRef.current) return;
      const bytes = Array.from(new Uint8Array(buffer));
      clearPreview();
      setCapturedBytes(bytes);
      setCapturedPreviewUrl(URL.createObjectURL(blob));
    }, 'image/png');
  };

  const handleConfirmUpload = async () => {
    if (!capturedBytes) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ok = await onCapture(`camera-${stamp}.png`, capturedBytes);
    if (ok) {
      stopStream();
      clearPreview();
      onClose();
    }
  };

  const handleClose = useCallback(() => {
    stopStream();
    clearPreview();
    onClose();
  }, [clearPreview, onClose, stopStream]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isUploading) {
        event.preventDefault();
        event.stopPropagation();
        handleClose();
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopStream();
        if (!isUploading) {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [handleClose, isUploading]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-[540px] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#131724] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-bold text-slate-100">
            <Camera size={16} className="text-sky-300" />
            <span>拍照添加到待办卡片</span>
          </div>
          <button
            type="button"
            disabled={isUploading}
            onClick={handleClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-4">
          {devices.length > 1 && !capturedPreviewUrl && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] text-slate-400">摄像头</span>
              <select
                value={selectedDeviceId}
                onChange={event => {
                  const nextId = event.target.value;
                  setSelectedDeviceId(nextId);
                  void startCamera(nextId);
                }}
                className="flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-[12px] text-slate-100 outline-none"
              >
                {devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId} className="bg-[#131724]">
                    {device.label || `摄像头 ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {cameraError ? (
            <div className="rounded-lg border border-rose-400/25 bg-rose-500/10 p-4 text-[12px] leading-5 text-rose-100">
              {cameraError}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void startCamera(selectedDeviceId || undefined)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-100 hover:bg-white/15"
                >
                  <RefreshCw size={12} />
                  重试打开摄像头
                </button>
              </div>
            </div>
          ) : (
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black">
              {capturedPreviewUrl ? (
                <img src={capturedPreviewUrl} alt="拍照预览" className="h-full w-full object-contain" />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              )}
              {isStarting && !capturedPreviewUrl && (
                <div className="absolute inset-0 grid place-items-center bg-black/50 text-[12px] text-slate-300">
                  正在启动摄像头...
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.08] px-4 py-3">
          <button
            type="button"
            disabled={isUploading}
            onClick={handleClose}
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-slate-400 hover:bg-white/[0.08] hover:text-slate-100 disabled:opacity-40"
          >
            取消
          </button>
          {capturedPreviewUrl ? (
            <>
              <button
                type="button"
                disabled={isUploading}
                onClick={clearPreview}
                className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12px] font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                重拍
              </button>
              <button
                type="button"
                disabled={isUploading}
                onClick={() => void handleConfirmUpload()}
                className="rounded-lg bg-sky-500 px-4 py-1.5 text-[12px] font-bold text-white hover:bg-sky-400 disabled:opacity-50"
              >
                {isUploading ? '正在保存...' : '保存到卡片'}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isStarting || Boolean(cameraError)}
              onClick={captureFrame}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-1.5 text-[12px] font-bold text-white hover:bg-sky-400 disabled:opacity-50"
            >
              <Camera size={14} />
              拍照
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
