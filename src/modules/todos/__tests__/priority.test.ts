import { describe, expect, it } from 'vitest';
import {
  getTodoPriorityMeta,
  normalizeTodoPriority,
  TODO_PRIORITY_OPTIONS
} from '../priority';

describe('todo priority options and normalization', () => {
  it('exposes four ordered urgency levels', () => {
    expect(TODO_PRIORITY_OPTIONS.map(item => item.value)).toEqual([
      'low',
      'normal',
      'high',
      'urgent'
    ]);
  });

  it('defaults missing or unknown stored priority to normal', () => {
    expect(normalizeTodoPriority(undefined)).toBe('normal');
    expect(normalizeTodoPriority(null)).toBe('normal');
    expect(normalizeTodoPriority('unexpected')).toBe('normal');
    expect(normalizeTodoPriority(' HIGH ')).toBe('high');
  });

  it('maps urgent and high to visible tile badge and color stripe while keeping normal clean', () => {
    const urgent = getTodoPriorityMeta('urgent');
    expect(urgent.showTileBadge).toBe(true);
    expect(urgent.stripeClass).toContain('rose');

    const high = getTodoPriorityMeta('high');
    expect(high.showTileBadge).toBe(true);
    expect(high.stripeClass).toContain('amber');

    const normal = getTodoPriorityMeta('normal');
    expect(normal.showTileBadge).toBe(false);
    expect(normal.stripeClass).toBe('');
  });
});
