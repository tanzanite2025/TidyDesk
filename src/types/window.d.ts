/**
 * TidyDesk Window API 类型定义
 */

import type { TidyDeskAPI } from './tidydesk-api';

declare global {
  interface Window {
    tidyDesk?: TidyDeskAPI;
  }
}

export {};
