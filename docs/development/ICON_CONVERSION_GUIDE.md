# 图标转换说明

当前仓库只需要提交 Tauri 实际使用的 `build/icon.ico`。如果需要替换图标，建议先在设计工具中导出包含常见 Windows 尺寸的 ICO，再提交最终产物。

## 推荐尺寸

`build/icon.ico` 建议至少包含：

- 16x16
- 32x32
- 48x48
- 256x256

## 可选转换方式

如果本机安装了 ImageMagick，可以从 SVG/PNG 转换：

```bash
magick convert source.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

也可以使用在线转换工具，但只提交最终 `build/icon.ico`。

## 转换后验证

```bash
npm run tauri:dev
npm run tauri:bundle
```

确认开发窗口、安装包、桌面快捷方式和开始菜单图标一致。

## 注意事项

- 旧的 `npm run build:electron` 命令已经过期。
- 不要把临时源图、导出缓存或在线转换下载目录提交到仓库。
- 当前打包配置和构建命令以根目录 [README](../../README.md) 为准。
