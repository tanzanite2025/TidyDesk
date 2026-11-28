import React from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HandleApp } from './modules/handle/HandleApp';
import { QuickCaptureApp } from './modules/capture/QuickCaptureApp';
import { StickyNoteApp } from './modules/notes/StickyNoteApp';
import { MobileTodoApp } from './modules/mobile/MobileTodoApp';
import { SettingsWindowApp } from './modules/settings/SettingsWindowApp';
import { SnipOverlayApp } from './modules/stickers/SnipOverlayApp';
import { TodoPanelApp } from './modules/todos/TodoPanel';

const windowMode = new URLSearchParams(window.location.search).get('mode');

const App: React.FC = () => {
  let content: React.ReactNode;

  if (windowMode === 'bootstrap') {
    return null;
  }

  if (windowMode === 'todos' || windowMode === 'tauri-todos') {
    content = <TodoPanelApp />;
  } else if (windowMode === 'mobile') {
    content = <MobileTodoApp />;
  } else if (windowMode === 'capture') {
    content = <QuickCaptureApp />;
  } else if (windowMode === 'settings') {
    content = <SettingsWindowApp />;
  } else if (windowMode === 'sticky') {
    content = <StickyNoteApp />;
  } else if (windowMode === 'snip') {
    content = <SnipOverlayApp />;
  } else {
    content = <HandleApp />;
  }

  return (
    <ErrorBoundary>
      {content}
    </ErrorBoundary>
  );
};

export default App;
