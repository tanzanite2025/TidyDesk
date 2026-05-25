import React from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TodoPanelApp } from './modules/todos/TodoPanel';
import { createTauriNativeClient } from './native/tauri-adapter';

const tauriTodoClient = createTauriNativeClient();

export const TauriTodoApp: React.FC = () => (
  <ErrorBoundary>
    <TodoPanelApp client={tauriTodoClient} />
  </ErrorBoundary>
);
