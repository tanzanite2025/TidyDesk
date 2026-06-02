import React from 'react';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DrawerApp } from './modules/drawer/DrawerApp';
import { HandleApp } from './modules/handle/HandleApp';
import { RailApp } from './modules/rail/RailApp';
import { SnipOverlayApp } from './modules/stickers/SnipOverlayApp';
import { StickerApp } from './modules/stickers/StickerApp';
import { TodoPanelApp } from './modules/todos/TodoPanel';

const windowMode = new URLSearchParams(window.location.search).get('mode');

const App: React.FC = () => {
  let content: React.ReactNode;

  if (windowMode === 'handle') {
    content = <HandleApp />;
  } else if (windowMode === 'rail') {
    content = <RailApp />;
  } else if (windowMode === 'todos') {
    content = <TodoPanelApp />;
  } else if (windowMode === 'snip') {
    content = <SnipOverlayApp />;
  } else if (windowMode === 'sticker') {
    content = <StickerApp />;
  } else {
    content = (
      <WorkspaceProvider>
        <DrawerApp />
      </WorkspaceProvider>
    );
  }

  return (
    <ErrorBoundary>
      {content}
    </ErrorBoundary>
  );
};

export default App;
