import React, { type ComponentType } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// 获取窗口模式
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');

// 根据模式渲染不同的应用
const root = ReactDOM.createRoot(document.getElementById('root')!);

async function resolveAppComponent(): Promise<ComponentType> {
  if (mode === 'app-picker') {
    return (await import('./AppPickerApp.tsx')).AppPickerApp;
  }

  if (mode === 'tauri-poc') {
    return (await import('./TauriPocApp.tsx')).TauriPocApp;
  }

  if (mode === 'tauri-todos') {
    return (await import('./TauriTodoApp.tsx')).TauriTodoApp;
  }

  return (await import('./App.tsx')).default;
}

void resolveAppComponent()
  .then(AppComponent => {
    root.render(
      <React.StrictMode>
        <AppComponent />
      </React.StrictMode>,
    )
  })
  .catch(error => {
    console.error('[TIDYDESK] Failed to bootstrap app:', error)
    root.render(
      <React.StrictMode>
        <div className="grid h-screen place-items-center bg-[#11131c] text-sm text-rose-200">
          启动失败：{error instanceof Error ? error.message : String(error)}
        </div>
      </React.StrictMode>,
    )
  })
