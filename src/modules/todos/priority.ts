import { normalizeTodoPriority, TODO_PRIORITY_VALUES, type TodoPriority } from '../../types/todo';

export { normalizeTodoPriority };

export interface TodoPriorityMeta {
  value: TodoPriority;
  label: string;
  tileClass: string;
  selectedTileClass: string;
  stripeClass: string;
  badgeClass: string;
  chipActiveClass: string;
  dotClass: string;
  showTileBadge: boolean;
}

const PRIORITY_META_MAP: Record<TodoPriority, TodoPriorityMeta> = {
  low: {
    value: 'low',
    label: '低',
    tileClass: 'border-sky-300/15 bg-sky-400/[0.03] hover:border-sky-300/30 hover:bg-sky-400/[0.06]',
    selectedTileClass: 'border-sky-300/45 bg-sky-400/15 ring-1 ring-sky-400/30',
    stripeClass: 'bg-sky-400/45',
    badgeClass: 'bg-slate-500/25 text-slate-300 ring-1 ring-white/10',
    chipActiveClass: 'bg-slate-500/35 text-slate-100 ring-1 ring-slate-300/40',
    dotClass: 'bg-sky-400/75',
    showTileBadge: true
  },
  normal: {
    value: 'normal',
    label: '普通',
    tileClass: 'border-white/[0.08] bg-white/[0.045] hover:border-white/[0.16] hover:bg-white/[0.08]',
    selectedTileClass: 'border-sky-300/40 bg-sky-400/15 ring-1 ring-sky-400/25',
    stripeClass: '',
    badgeClass: '',
    chipActiveClass: 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40',
    dotClass: 'bg-slate-400',
    showTileBadge: false
  },
  high: {
    value: 'high',
    label: '高',
    tileClass: 'border-amber-400/30 bg-amber-500/[0.06] hover:border-amber-300/45 hover:bg-amber-500/[0.10]',
    selectedTileClass: 'border-amber-300/55 bg-amber-500/20 ring-1 ring-amber-400/35',
    stripeClass: 'bg-amber-400',
    badgeClass: 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30',
    chipActiveClass: 'bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/45',
    dotClass: 'bg-amber-400',
    showTileBadge: true
  },
  urgent: {
    value: 'urgent',
    label: '紧急',
    tileClass: 'border-rose-400/35 bg-rose-500/[0.08] hover:border-rose-300/50 hover:bg-rose-500/[0.13]',
    selectedTileClass: 'border-rose-300/60 bg-rose-500/20 ring-1 ring-rose-400/40',
    stripeClass: 'bg-rose-500',
    badgeClass: 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/35',
    chipActiveClass: 'bg-rose-500/25 text-rose-100 ring-1 ring-rose-400/50',
    dotClass: 'bg-rose-400',
    showTileBadge: true
  }
};

export const TODO_PRIORITY_OPTIONS: TodoPriorityMeta[] = TODO_PRIORITY_VALUES.map(
  value => PRIORITY_META_MAP[value]
);

export function getTodoPriorityMeta(raw?: string | null): TodoPriorityMeta {
  return PRIORITY_META_MAP[normalizeTodoPriority(raw)];
}
