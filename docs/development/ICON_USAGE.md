# 图标使用说明

当前 TidyDesk 使用 Tauri 打包，主图标位于：

```text
build/icon.ico
```

该文件由 `src-tauri/tauri.conf.json` 引用，用于 Windows 安装包、应用窗口、任务栏和开始菜单入口。

## 验证方式

开发态检查：

```bash
npm run tauri:dev
```

打包后检查：

```bash
npm run tauri:bundle
```

重点确认：

- 安装程序显示 TidyDesk 图标。
- 安装后桌面快捷方式显示 TidyDesk 图标。
- 开始菜单快捷方式显示 TidyDesk 图标。
- 运行后窗口和任务栏图标一致。

## 维护规则

- 不要提交临时转换脚本或中间图标文件，除非构建流程确实依赖。
- 如果替换 `build/icon.ico`，需要重新执行 `npm run tauri:bundle` 验证安装包图标。
- 历史 Electron 图标文档已过期，当前命令以根目录 README 为准。

## 相关文档

- [图标转换说明](./ICON_CONVERSION_GUIDE.md)
- [主项目 README](../../README.md)
