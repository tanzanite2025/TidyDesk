import React, { useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { proposeTidyActions } from '../utils/tidyEngine';
import { Sparkles, Calendar, Trash2, X, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';

interface TidyWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

type TidyRule = 'category' | 'date' | 'temp';

export const TidyWizard: React.FC<TidyWizardProps> = ({ isOpen, onClose }) => {
  const { files, executeSmartTidy } = useWorkspace();
  const [selectedRule, setSelectedRule] = useState<TidyRule>('category');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);

  // 清理定时器
  React.useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  // 1. 生成基于选定规则的整理提案预览
  const suggestions = proposeTidyActions(files, selectedRule);

  // 2. 执行智能整理与进度模拟 (乐观 UI 更新)
  const handleStartTidy = () => {
    if (suggestions.length === 0) return;
    setIsProcessing(true);
    setProgress(0);

    // 清理之前的定时器
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // 模拟极速工业进度条
    intervalRef.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setTimeout(() => {
            // 执行核心整理逻辑 (触发 context 中的乐观重绘)
            executeSmartTidy(selectedRule);
            setIsProcessing(false);
            onClose();
          }, 300);
          return 100;
        }
        return prev + 15;
      });
    }, 60);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4">
      {/* Borderless UDS Dialogue rounded-[32px] */}
      <div className="w-full max-w-2xl rounded-[32px] bg-[#0c0f16] p-8 shadow-2xl relative overflow-hidden flex flex-col gap-6 max-h-[90vh]">
        {/* Top visual gradient flare */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-dashed border-border/80 pb-4 z-10">
          <div>
            <h2 className="text-lg font-black tracking-tighter italic uppercase text-foreground leading-none mb-1.5 flex items-center gap-2">
              <Sparkles className="text-primary animate-pulse" size={18} />
              SMART TIDY ENGINE
            </h2>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 leading-none">
              AUTOMATED FILE ALLOCATION AND TIDYING TERMINAL
            </p>
          </div>
          <button 
            onClick={onClose} 
            disabled={isProcessing}
            className="text-muted-foreground hover:text-foreground transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {isProcessing ? (
          /* ================= PROGRESS VIEW ================= */
          <div className="flex-1 py-12 flex flex-col items-center justify-center text-center gap-4">
            <RefreshCw size={32} className="animate-spin text-primary" />
            <div>
              <h3 className="text-sm font-black tracking-tighter italic uppercase text-foreground mb-1">
                EXECUTING ALGORITHMIC ALLOCATION
              </h3>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">
                CREATING DIRECTORIES & OPTIMISTICALLY RE-ROUTING FILES...
              </p>
            </div>
            {/* Progress bar h-1 */}
            <div className="w-64 h-1 bg-muted/40 rounded-full overflow-hidden mt-2">
              <div 
                className="h-full bg-primary transition-all duration-100" 
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[8px] font-mono text-muted-foreground/45">
              PROGRESS: {progress}% // BUFFER OK
            </span>
          </div>
        ) : (
          /* ================= OPTIONS & PREVIEW VIEW ================= */
          <>
            {/* Three Organizer Options Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 z-10">
              
              {/* Option 1: Category */}
              <div
                onClick={() => setSelectedRule('category')}
                className={`p-4 rounded-[24px] border border-dashed cursor-pointer transition-all duration-300 flex flex-col gap-2 ${
                  selectedRule === 'category'
                    ? 'border-primary bg-primary/5 shadow-md'
                    : 'border-border/60 bg-muted/10 hover:bg-muted/20 hover:border-border'
                }`}
              >
                <div className={`p-2 rounded-xl w-fit ${selectedRule === 'category' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  <Sparkles size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-foreground leading-tight">品类智能分类</h4>
                  <span className="text-[8px] font-mono text-muted-foreground/50 uppercase tracking-widest block mt-0.5">
                    BY EXTENSION
                  </span>
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest opacity-60 text-muted-foreground mt-1">
                  自动将图片归入 Images、文档归入 Documents、代码归入 Developer 等。
                </p>
              </div>

              {/* Option 2: Date Timeline */}
              <div
                onClick={() => setSelectedRule('date')}
                className={`p-4 rounded-[24px] border border-dashed cursor-pointer transition-all duration-300 flex flex-col gap-2 ${
                  selectedRule === 'date'
                    ? 'border-primary bg-primary/5 shadow-md'
                    : 'border-border/60 bg-muted/10 hover:bg-muted/20 hover:border-border'
                }`}
              >
                <div className={`p-2 rounded-xl w-fit ${selectedRule === 'date' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  <Calendar size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-foreground leading-tight">时间跨度归档</h4>
                  <span className="text-[8px] font-mono text-muted-foreground/50 uppercase tracking-widest block mt-0.5">
                    BY DATE TIMELINE
                  </span>
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest opacity-60 text-muted-foreground mt-1">
                  自动按照今日、本周、本月及更早陈旧文件等修改时间划分收纳。
                </p>
              </div>

              {/* Option 3: Temp Isolation */}
              <div
                onClick={() => setSelectedRule('temp')}
                className={`p-4 rounded-[24px] border border-dashed cursor-pointer transition-all duration-300 flex flex-col gap-2 ${
                  selectedRule === 'temp'
                    ? 'border-primary bg-primary/5 shadow-md'
                    : 'border-border/60 bg-muted/10 hover:bg-muted/20 hover:border-border'
                }`}
              >
                <div className={`p-2 rounded-xl w-fit ${selectedRule === 'temp' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  <Trash2 size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-foreground leading-tight">临时垃圾隔离</h4>
                  <span className="text-[8px] font-mono text-muted-foreground/50 uppercase tracking-widest block mt-0.5">
                    TEMP CLEANER
                  </span>
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest opacity-60 text-muted-foreground mt-1">
                  只精准抓取“新建文本文档”、“Screenshot”等临时文件，挪入独立待整理区。
                </p>
              </div>

            </div>

            {/* Smart Preview Table */}
            <div className="flex-1 flex flex-col gap-2 min-h-0 z-10">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 flex justify-between border-b border-dashed border-border pb-1">
                <span>ALLOCATION PREVIEW ({suggestions.length} ACTIONS)</span>
                <span>DESTINATION</span>
              </div>

              {suggestions.length === 0 ? (
                <div className="flex-1 min-h-[160px] rounded-2xl border border-dashed border-border/40 bg-muted/5 flex flex-col items-center justify-center text-center p-4">
                  <ShieldCheck size={20} className="text-emerald-500 mb-1" />
                  <h4 className="text-xs font-semibold text-emerald-400">桌面上未检测到任何待整理文件</h4>
                  <p className="text-[8px] font-mono text-muted-foreground/50 uppercase tracking-widest mt-1">
                    ALL ROOT FILES COMPACTED OR ALLOCATED PERFECTLY
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto max-h-[220px] rounded-2xl border border-dashed border-border bg-black/20 p-2 space-y-1.5">
                  {suggestions.map((item, idx) => (
                    <div 
                      key={item.fileId + idx}
                      className="flex items-center justify-between text-xs px-3 py-2 bg-muted/20 border border-dashed border-border/40 rounded-xl hover:bg-muted/40 transition-all"
                    >
                      <div className="flex items-center gap-2 truncate max-w-[220px]" title={item.fileName}>
                        <span className="text-[8px] font-mono text-muted-foreground bg-muted/40 px-1 rounded">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-foreground truncate">
                          {item.fileName}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2 text-right">
                        <ArrowRight size={10} className="text-muted-foreground/40" />
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary font-bold">
                          📁 {item.targetFolder}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Bottom Actions */}
            <div className="flex justify-end items-center gap-4 border-t border-dashed border-border/80 pt-4 z-10">
              <button
                onClick={onClose}
                className="px-4 py-2 font-black text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
              >
                CANCEL
              </button>

              <button
                onClick={handleStartTidy}
                disabled={suggestions.length === 0}
                className="rounded-full h-11 px-6 bg-primary text-primary-foreground font-black text-[10px] uppercase tracking-widest flex items-center gap-2 shadow-lg hover:bg-primary/95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Sparkles size={12} />
                CONFIRM ALLOCATION
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
};
