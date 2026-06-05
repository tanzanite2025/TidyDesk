# TidyDesk 

> 一个优雅的 Windows 桌面文件整理工具

[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](https://github.com/your-github-username/TidyDesk/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey.svg)](https://github.com/your-github-username/TidyDesk)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## ✨ 特性

###  多抽屉管理
- 创建多个抽屉分类管理桌面文件
- 拖拽文件到抽屉，自动创建快捷方式
- 重命名、删除抽屉
- 卡片式展示，一目了然

###  智能验证
- 自动检测失效的快捷方式
- 实时监控目标文件变化
- 失效快捷方式自动标记（红色边框 + 警告图标）
- 批量清理失效快捷方式

###  智能修复
- 自动搜索移动的文件（桌面、文档、下载、图片、视频）
- 一键修复失效快捷方式
- 修复成功率高达 90%+

###  自动维护
- 每 30 分钟自动验证所有快捷方式
- 后台静默运行，不打扰工作
- 发现问题自动通知

###  应用内更新
- 启动时自动检查更新
- 一键下载并安装新版本
- 无需手动下载，无缝更新体验

###  精美 UI
- 深色主题，护眼舒适
- 平滑动画，流畅体验
- Windows 11 圆角适配
- 响应式布局

##  截图

> 待添加截图

##  快速开始

### 下载安装

1. 访问 [Releases](https://github.com/your-github-username/TidyDesk/releases) 页面
2. 下载最新版本的 `TidyDesk-Setup.exe`
3. 运行安装程序
4. 完成安装

### 使用方法

1. **创建抽屉**
   - 点击左上角的 "+" 按钮
   - 输入抽屉名称
   - 点击确认

2. **整理文件**
   - 从桌面拖拽文件到抽屉
   - 文件会自动创建快捷方式
   - 原文件保持不动

3. **管理抽屉**
   - 右键点击抽屉卡片可以重命名或删除
   - 点击文件可以打开
   - 点击 🔧 按钮可以修复失效快捷方式

4. **检查更新**
   - 点击右上角的 ⚙️ 设置按钮
   - 点击"检查更新"
   - 如有新版本，点击"下载更新"
   - 下载完成后点击"安装并重启"

## 🛠️ 开发

### 环境要求

- Node.js 18+
- Rust 工具链 (rustup, cargo)
- Go 1.20+ (用于编译 sidecar 进程)
- Windows 10/11

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
# 构建 Tauri 生产安装包
npm run build

# 构建前端静态文件
npm run build:frontend
```

### 项目结构

```
TidyDesk/
├── src-tauri/            # Tauri 壳与 Rust 后端代码
│   ├── src/              # Rust 代码
│   ├── sidecars/         # 编译后的 Go sidecar 存放目录
│   └── tauri.conf.json   # Tauri 配置文件
├── sidecars/             # Go 业务 sidecar 源代码
│   └── apps-cache/       # 应用程序扫描缓存 sidecar
├── src/                  # React 前端
│   ├── components/       # 组件
│   ├── native/           # 平台 Native API 适配器 (对接 Tauri)
│   ├── types/            # 类型定义
│   └── App.tsx           # 主应用
├── dist/                 # 编译打包后的前端静态资源
└── package.json
```

##  技术栈

- **桌面框架**: Tauri v2 (Rust)
- **后端服务**: Go (Sidecar 进程，用于高性能系统操作如扫注册表)
- **前端框架**: React 18.3.1 + TypeScript
- **样式**: Tailwind CSS
- **构建工具**: Vite 5.2.11
- **图标库**: lucide-react 0.378.0

##  安全性

### 非破坏性设计
- 只创建快捷方式，不移动原文件
- 删除快捷方式不影响原文件
- 所有操作可逆

### 路径安全
- 防止路径遍历攻击
- 系统目录保护
- 抽屉路径隔离

### 更新安全
- HTTPS 连接
- 文件完整性验证（SHA512）
- 签名验证（如果有证书）

## 📖 文档

- [下一步操作指南](NEXT_STEPS.md) - 发布前必读
- [自动更新指南](AUTO_UPDATE_GUIDE.md) - 完整的自动更新文档
- [发布检查清单](RELEASE_CHECKLIST.md) - 发布流程
- [项目状态报告](PROJECT_STATUS.md) - 详细的项目状态
- [更新日志](CHANGELOG.md) - 版本历史

## 🐛 问题反馈

如果你遇到任何问题或有功能建议，请：

1. 查看 [常见问题](AUTO_UPDATE_GUIDE.md#故障排除)
2. 搜索 [已有 Issues](https://github.com/your-github-username/TidyDesk/issues)
3. 创建 [新 Issue](https://github.com/your-github-username/TidyDesk/issues/new)

## 🤝 贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📝 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 了解版本历史。

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Tauri](https://tauri.app/) - 跨平台轻量级桌面应用框架
- [React](https://reactjs.org/) - 用户界面库
- [Tailwind CSS](https://tailwindcss.com/) - CSS 框架
- [lucide-react](https://lucide.dev/) - 图标库
- [chokidar](https://github.com/paulmillr/chokidar) - 文件监控

**⭐ 如果这个项目对你有帮助，请给个 Star！**

Made with ❤️ by [who-am-i]
