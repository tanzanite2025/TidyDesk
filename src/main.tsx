import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { AppPickerApp } from './AppPickerApp.tsx'
import './index.css'

// 获取窗口模式
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');

// 根据模式渲染不同的应用
const AppComponent = mode === 'app-picker' ? AppPickerApp : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppComponent />
  </React.StrictMode>,
)
