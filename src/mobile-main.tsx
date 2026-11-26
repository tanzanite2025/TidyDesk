import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MobileTodoApp } from './modules/mobile/MobileTodoApp';

(window as unknown as { __TIDYDESK_MOBILE__?: boolean }).__TIDYDESK_MOBILE__ = true;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MobileTodoApp />
    </ErrorBoundary>
  </React.StrictMode>
);
