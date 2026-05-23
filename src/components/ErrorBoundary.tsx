import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[CRITICAL SYSTEM CRASH]", error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-[#07090e] p-8 industrial-grid font-sans">
          <div className="w-full max-w-2xl rounded-[32px] bg-rose-950/20 border-2 border-dashed border-rose-500/40 p-8 shadow-2xl relative overflow-hidden backdrop-blur-md">
            {/* Top gradient blur */}
            <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 via-transparent to-transparent pointer-events-none" />

            {/* Error header conforming to H1 UDS */}
            <div className="flex items-center gap-4 mb-6 border-b border-dashed border-rose-500/30 pb-6">
              <div className="p-3 bg-rose-500/20 rounded-2xl text-rose-500 animate-pulse">
                <AlertOctagon size={32} />
              </div>
              <div>
                <h1 className="text-lg font-black tracking-tighter italic uppercase text-rose-500">
                  CRITICAL ENGINE BREAKDOWN
                </h1>
                <p className="text-[9px] font-black uppercase tracking-widest text-rose-400 opacity-60">
                  SYSTEM CORE INTERRUPT // FAIL LOUDLY PROTOCOL
                </p>
              </div>
            </div>

            {/* Error description conforming to card text */}
            <div className="mb-6 space-y-4">
              <div className="p-4 bg-black/40 rounded-2xl border border-dashed border-rose-500/20">
                <div className="text-[10px] font-black uppercase tracking-widest text-rose-500/50 mb-1">
                  ERROR CLASS & MESSAGE
                </div>
                <div className="text-xs font-semibold text-rose-300">
                  {this.state.error?.name || "SystemError"}: {this.state.error?.message || "Unknown internal system crash."}
                </div>
              </div>

              {this.state.error?.stack && (
                <div className="p-4 bg-black/60 rounded-2xl border border-dashed border-rose-500/20 max-h-48 overflow-y-auto">
                  <div className="text-[10px] font-black uppercase tracking-widest text-rose-500/50 mb-1">
                    STACK TRACE
                  </div>
                  <pre className="text-[8px] font-mono text-rose-400 whitespace-pre-wrap leading-relaxed">
                    {this.state.error.stack}
                  </pre>
                </div>
              )}
            </div>

            {/* Action buttons conforming to UDS capsule */}
            <div className="flex justify-end border-t border-dashed border-rose-500/30 pt-6">
              <button
                onClick={() => window.location.reload()}
                className="rounded-full h-11 px-6 font-black text-[10px] uppercase tracking-widest bg-rose-500 text-white hover:bg-rose-600 transition-all flex items-center gap-2 shadow-lg shadow-rose-500/20"
              >
                <RefreshCw size={12} className="animate-spin-slow" />
                REBOOT CORE ENGINE
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
