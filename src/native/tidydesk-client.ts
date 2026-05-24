import type { TidyDeskAPI } from '../types/tidydesk-api';

export function getTidyDeskApi(): TidyDeskAPI | null {
  return window.tidyDesk ?? null;
}

export function hasTidyDeskApi(): boolean {
  return Boolean(window.tidyDesk);
}
