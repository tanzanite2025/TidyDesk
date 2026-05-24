import React, { useCallback, useMemo, useState } from 'react';
import { Check, Clipboard, Copy, FolderOpen, ImagePlus, Loader2, RefreshCw } from 'lucide-react';
import { createJobsFromPresets, DEFAULT_ASSET_PRESETS } from '../contracts/presets';
import {
  AssetLabClient,
  AssetPreset,
  AssetProcessFile,
  AssetProcessRequest,
  AssetSourceRef
} from '../contracts/types';

type AssetLabPanelProps = {
  client?: AssetLabClient;
  presets?: AssetPreset[];
  initialSource?: AssetSourceRef | null;
  defaultOutputDir?: string;
};

type FileWithPath = File & {
  path?: string;
};

function buildRequestId() {
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sourceFromFile(file: FileWithPath): AssetSourceRef | null {
  if (!file.path) return null;

  return {
    kind: 'file',
    name: file.name,
    path: file.path,
    previewUrl: URL.createObjectURL(file)
  };
}

function outputMime(file: AssetProcessFile) {
  if (file.format === 'jpg' || file.format === 'jpeg') return 'image/jpeg';
  if (file.format === 'ico') return 'image/x-icon';
  if (file.format === 'webp') return 'image/webp';
  return 'image/png';
}

export const AssetLabPanel: React.FC<AssetLabPanelProps> = ({
  client,
  presets = DEFAULT_ASSET_PRESETS,
  initialSource = null,
  defaultOutputDir = ''
}) => {
  const [source, setSource] = useState<AssetSourceRef | null>(initialSource);
  const [outputDir, setOutputDir] = useState(defaultOutputDir);
  const [selectedPresetIds, setSelectedPresetIds] = useState(() => new Set(presets.map(preset => preset.id)));
  const [files, setFiles] = useState<AssetProcessFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const selectedPresets = useMemo(
    () => presets.filter(preset => selectedPresetIds.has(preset.id)),
    [presets, selectedPresetIds]
  );

  const canProcess = Boolean(client && source && selectedPresets.length > 0 && !isProcessing);

  const setFileSource = useCallback((file: FileWithPath) => {
    const nextSource = sourceFromFile(file);
    if (!nextSource) {
      setError('This input needs to be staged by Electron before processing.');
      return;
    }

    setSource(current => {
      if (current?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(current.previewUrl);
      return nextSource;
    });
    setFiles([]);
    setError(null);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find(item => item.type.startsWith('image/')) as FileWithPath | undefined;
    if (file) setFileSource(file);
  }, [setFileSource]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.files).find(item => item.type.startsWith('image/')) as FileWithPath | undefined;
    if (file) setFileSource(file);
  }, [setFileSource]);

  const togglePreset = useCallback((presetId: string) => {
    setSelectedPresetIds(current => {
      const next = new Set(current);
      if (next.has(presetId)) {
        next.delete(presetId);
      } else {
        next.add(presetId);
      }
      return next;
    });
  }, []);

  const processAssets = useCallback(async () => {
    if (!client || !source) return;

    setIsProcessing(true);
    setError(null);

    const request: AssetProcessRequest = {
      requestId: buildRequestId(),
      input: source,
      outputDir: outputDir.trim() || undefined,
      overwrite: false,
      jobs: createJobsFromPresets(selectedPresets)
    };

    try {
      const response = await client.process(request);
      setFiles(response.files);
      setError(response.errors[0]?.message ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  }, [client, outputDir, selectedPresets, source]);

  const clear = useCallback(() => {
    if (source?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(source.previewUrl);
    setSource(null);
    setFiles([]);
    setError(null);
  }, [source]);

  return (
    <div
      className="flex h-screen w-full flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#11151f]/98 text-slate-100 shadow-2xl"
      onDrop={handleDrop}
      onDragOver={event => event.preventDefault()}
      onPaste={handlePaste}
      tabIndex={0}
    >
      <header className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-400/15 text-cyan-100">
            <ImagePlus size={16} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-black">Asset Lab</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Quick web outputs</div>
          </div>
        </div>
        <button
          type="button"
          onClick={clear}
          className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
          title="Reset"
        >
          <RefreshCw size={14} />
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[280px_1fr] gap-0">
        <aside className="flex min-h-0 flex-col gap-3 border-r border-white/[0.08] p-4">
          <label
            className="grid min-h-[180px] cursor-pointer place-items-center rounded-lg border border-dashed border-white/[0.16] bg-white/[0.035] p-4 text-center hover:bg-white/[0.055]"
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={event => {
                const file = event.target.files?.[0] as FileWithPath | undefined;
                if (file) setFileSource(file);
              }}
            />
            {source?.previewUrl ? (
              <img src={source.previewUrl} alt="" className="max-h-36 max-w-full rounded-md object-contain" />
            ) : (
              <div className="space-y-2">
                <ImagePlus className="mx-auto text-slate-500" size={28} />
                <div className="text-[12px] font-bold text-slate-300">Drop image</div>
                <div className="text-[10px] text-slate-500">Paste or pick a local file</div>
              </div>
            )}
          </label>

          <div className="min-w-0">
            <div className="truncate text-[12px] font-bold text-slate-200">{source?.name || 'No image selected'}</div>
            <div className="mt-1 truncate text-[10px] text-slate-500">{source?.path || 'Waiting for Electron-staged input'}</div>
          </div>

          <input
            value={outputDir}
            onChange={event => setOutputDir(event.target.value)}
            className="h-9 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/35"
            placeholder="Output folder, optional"
          />

          <button
            type="button"
            onClick={processAssets}
            disabled={!canProcess}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-cyan-400/18 px-3 text-[12px] font-bold text-cyan-100 hover:bg-cyan-400/26 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Generate
          </button>

          {error && (
            <div className="rounded-lg border border-rose-400/20 bg-rose-500/10 p-3 text-[11px] leading-4 text-rose-100">
              {error}
            </div>
          )}
        </aside>

        <section className="min-h-0 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            {presets.map(preset => {
              const isSelected = selectedPresetIds.has(preset.id);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => togglePreset(preset.id)}
                  className={`rounded-lg border p-3 text-left transition ${
                    isSelected
                      ? 'border-cyan-300/35 bg-cyan-400/12'
                      : 'border-white/[0.07] bg-white/[0.035] hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-black text-slate-100">{preset.label}</span>
                    <span className="text-[10px] text-slate-500">{preset.outputs.map(output => output.label).join(' / ')}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">{preset.description}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {files.map(file => (
              <article
                key={`${file.jobId}:${file.path}`}
                draggable
                onDragStart={event => {
                  event.dataTransfer.setData('text/plain', file.path);
                  event.dataTransfer.setData('DownloadURL', `${outputMime(file)}:${file.fileName}:file://${file.path}`);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-bold text-slate-100">{file.label}</div>
                    <div className="mt-1 truncate text-[10px] text-slate-500">{file.fileName}</div>
                  </div>
                  <div className="text-[10px] uppercase text-slate-500">{file.format}</div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
                  <span>{file.width} x {file.height}</span>
                  <span>{Math.ceil(file.bytes / 1024)} KB</span>
                </div>
                <div className="mt-3 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => client?.copyFilePath?.(file.path)}
                    className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
                    title="Copy path"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => client?.revealFile?.(file.path)}
                    className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
                    title="Reveal file"
                  >
                    <FolderOpen size={13} />
                  </button>
                </div>
              </article>
            ))}
            {files.length === 0 && (
              <div className="col-span-2 grid min-h-[220px] place-items-center rounded-lg border border-white/[0.07] bg-white/[0.025] text-center">
                <div className="space-y-2">
                  <Clipboard className="mx-auto text-slate-600" size={28} />
                  <div className="text-[12px] font-bold text-slate-400">Generated files land here</div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

