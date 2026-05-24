import { useEffect, useState } from 'react';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface SidecarVersionInfo {
  name?: string;
  version?: string;
  protocolVersion?: string;
  runtime?: string;
  os?: string;
  arch?: string;
  methods?: string[];
}

interface SidecarHealthInfo {
  status?: string;
  uptimeMs?: number;
  methods?: string[];
}

interface SidecarProbeResult {
  executablePath: string;
  ping: {
    pong?: string;
  };
  version: SidecarVersionInfo;
  health: SidecarHealthInfo;
}

interface ScanMetadataResult {
  shortcuts?: unknown[];
  scannedPaths?: string[];
  durationMs?: number;
}

export function TauriPocApp() {
  const [invoke, setInvoke] = useState<TauriInvoke | null>(null);
  const [result, setResult] = useState<SidecarProbeResult | null>(null);
  const [metadata, setMetadata] = useState<ScanMetadataResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isTauriAvailable = Boolean(invoke);

  const runProbe = async () => {
    if (!invoke) {
      setError('Tauri invoke API is not available. Open this page from the Tauri shell.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await invoke<SidecarProbeResult>('probe_go_sidecar');
      setResult(data);
      const scan = await invoke<ScanMetadataResult>('apps_scan_metadata');
      setMetadata(scan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const openAppPickerPoc = async () => {
    if (!invoke) {
      setError('Tauri invoke API is not available. Open this page from the Tauri shell.');
      return;
    }

    setError(null);
    try {
      await invoke('open_app_picker_poc');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    let disposed = false;
    import('@tauri-apps/api/core')
      .then(api => {
        if (!disposed) setInvoke(() => api.invoke as TauriInvoke);
      })
      .catch(err => {
        if (!disposed) setError(`Failed to load Tauri API: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (invoke) runProbe();
  }, [invoke]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-6 px-8 py-10">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-300">TidyDesk</p>
          <h1 className="text-4xl font-semibold tracking-tight">Tauri 最小壳 PoC</h1>
          <p className="max-w-2xl text-base leading-7 text-slate-300">
            这个页面只验证 Tauri 窗口、命令调用和 Go sidecar stdio JSON-RPC 模型，不迁移现有 Electron IPC。
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-cyan-950/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-400">Tauri invoke</p>
              <p className={isTauriAvailable ? 'text-emerald-300' : 'text-amber-300'}>
                {isTauriAvailable ? 'available' : 'not available'}
              </p>
            </div>
            <button
              className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              disabled={loading || !isTauriAvailable}
              onClick={runProbe}
            >
              {loading ? 'Probing...' : 'Probe Go sidecar'}
            </button>
            <button
              className="rounded-full border border-cyan-400/50 px-5 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
              disabled={!isTauriAvailable}
              onClick={openAppPickerPoc}
            >
              Open AppPicker PoC
            </button>
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-red-500/40 bg-red-950/50 p-4 text-sm text-red-200">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <InfoCard title="Sidecar path" value={result.executablePath} />
              <InfoCard title="Ping" value={result.ping?.pong || 'unknown'} />
              <InfoCard title="Version" value={`${result.version?.version || 'unknown'} / protocol ${result.version?.protocolVersion || 'unknown'}`} />
              <InfoCard title="Runtime" value={`${result.version?.runtime || 'unknown'} (${result.version?.os || 'unknown'}/${result.version?.arch || 'unknown'})`} />
              <InfoCard title="Health" value={result.health?.status || 'unknown'} />
              <InfoCard title="Methods" value={String(result.version?.methods?.length || result.health?.methods?.length || 0)} />
              <InfoCard title="Metadata shortcuts" value={String(metadata?.shortcuts?.length || 0)} />
              <InfoCard title="Metadata duration" value={`${metadata?.durationMs ?? 'unknown'}ms`} />
              <InfoCard title="Scanned paths" value={String(metadata?.scannedPaths?.length || 0)} />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <p className="mt-2 break-words text-sm text-slate-100">{value}</p>
    </div>
  );
}
