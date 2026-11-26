import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function renameMobileHtmlPlugin(): Plugin {
  return {
    name: 'tidydesk-rename-mobile-html',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist-mobile');
      const mobileHtml = path.join(outDir, 'mobile.html');
      const indexHtml = path.join(outDir, 'index.html');
      if (fs.existsSync(mobileHtml)) {
        fs.rmSync(indexHtml, { force: true });
        fs.renameSync(mobileHtml, indexHtml);
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), renameMobileHtmlPlugin()],
  base: './',
  resolve: {
    alias: {
      [path.resolve(__dirname, 'src/native/tauri-adapter.ts')]: path.resolve(
        __dirname,
        'src/native/tauri-adapter.mobile-stub.ts'
      ),
      '@tauri-apps/api/core': path.resolve(__dirname, 'src/native/tauri-api.mobile-stub.ts'),
      '@tauri-apps/api/event': path.resolve(__dirname, 'src/native/tauri-api.mobile-stub.ts')
    }
  },
  build: {
    outDir: 'dist-mobile',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'mobile.html')
    }
  }
});
