# TidyDesk 🗂️

> 智能桌面文件整理工具 - 让你的 Windows 桌面井然有序

[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](https://github.com/yourusername/tidydesk)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-brightgreen.svg)](https://www.microsoft.com/windows)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## ✨ 特性

- 🎯 **智能分类** - 自动识别文件类型（图片、文档、代码、压缩包等）
- 📊 **健康度评分** - 实时评估桌面整洁度，提供优化建议
- 🚀 **快捷方式抽屉** - 创建快捷方式而非移动原文件，安全无损
- 🎨 **现代化 UI** - 赛博朋克风格，毛玻璃效果，流畅动画
- 🪟 **侧边栏设计** - 从屏幕右侧滑出，不干扰工作流程
- 🔒 **安全可靠** - 路径验证、系统文件保护、错误恢复机制
- 📱 **高 DPI 支持** - 完美适配 4K 显示器和各种缩放比例

## 🖼️ 截图

### 收起状态
侧边栏手柄，随时可以打开抽屉

### 展开状态
从右侧滑出的抽屉，显示已整理的文件快捷方式

### 智能整理向导
三种整理模式：按类别、按时间、临时文件隔离

## 🚀 快速开始

### 系统要求

- **操作系统**: Windows 10 (21H2+) 或 Windows 11
- **Node.js**: 18.x 或更高
- **内存**: 至少 4GB RAM
- **磁盘空间**: 200MB

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/tidydesk.git
cd tidydesk

# 安装依赖
npm install

# 开发模式运行
npm run desktop

# 构建生产版本
npm run build
```

### 使用方法

1. **启动应用** - 运行 `npm run desktop` 或双击打包后的 `.exe` 文件
2. **打开抽屉** - 点击屏幕右侧的侧边栏手柄
3. **拖入文件** - 将桌面文件拖入抽屉区域
4. **创建快捷方式** - 应用会自动创建快捷方式，原文件保持不动
5. **管理文件** - 搜索、重命名、删除快捷方式

## 📚 核心功能

### 1. 桌面健康度评分

TidyDesk 会根据以下因素计算桌面健康度（0-100 分）：

- **文件数量** - 桌面直接放置的文件数（超过 5 个开始扣分）
- **临时文件** - "新建文本文档"、"Screenshot" 等临时文件
- **大文件** - 超过 100MB 的文件（占用 C 盘空间）
- **陈旧文件** - 超过 60 天未修改的文件

**健康状态**:
- 🟢 **HEALTHY** (85-100 分) - 桌面井然有序
- 🟡 **ALERT** (60-84 分) - 需要整理
- 🔴 **CRITICAL** (<60 分) - 严重杂乱

### 2. 智能文件分类

自动识别文件类型：

| 类别 | 文件类型 | 示例 |
|------|----------|------|
| 📷 **图片** | jpg, png, gif, svg, webp | 照片、截图、图标 |
| 📄 **文档** | doc, pdf, txt, xlsx, ppt | 办公文档、笔记 |
| 📦 **压缩包** | zip, rar, 7z, tar | 归档文件 |
| 💻 **开发文件** | ts, js, py, go, json | 代码、配置 |
| 🎮 **应用程序** | exe, msi, dmg | 安装包 |
| 🗑️ **临时文件** | 新建*, untitled*, temp* | 待清理文件 |

### 3. 三种整理模式

#### 按类别整理
- 图片 → `桌面图片`
- 文档 → `桌面文档`
- 代码 → `开发者项目文件`
- 压缩包 → `归档压缩包`
- 应用 → `应用程序安装包`
- 临时 → `临时待清理隔离区`

#### 按时间整理
- 今日修改 → `今日整理 (Today)`
- 本周修改 → `本周整理 (This Week)`
- 本月修改 → `本月整理 (This Month)`
- 更早 → `更早陈旧文件 (Earlier)`

#### 临时文件隔离
- 只隔离临时垃圾文件
- 其他文件保持不动

## 🛠️ 技术栈

### 前端
- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Tailwind CSS** - 样式框架
- **Lucide React** - 图标库
- **Vite** - 构建工具

### 桌面端
- **Electron 30** - 跨平台桌面框架
- **Node.js** - 文件系统操作

### 开发工具
- **Concurrently** - 并行运行开发服务器
- **Wait-on** - 等待服务器启动

## 📁 项目结构

```
TidyDesk/
├── electron/
│   ├── main.cjs          # Electron 主进程
│   └── preload.cjs       # 预加载脚本
├── src/
│   ├── components/
│   │   ├── ErrorBoundary.tsx
│   │   └── TidyWizard.tsx
│   ├── context/
│   │   └── WorkspaceContext.tsx
│   ├── types/
│   │   └── file.ts
│   ├── utils/
│   │   └── tidyEngine.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

## 🔧 配置

### 开发环境变量

创建 `.env` 文件：

```env
# 开发模式
NODE_ENV=development

# 启用 DevTools（可选）
TIDYDESK_DEVTOOLS=1
```

### 构建配置

修改 `package.json` 中的构建脚本：

```json
{
  "scripts": {
    "dev": "vite",
    "desktop": "concurrently \"vite\" \"wait-on http://localhost:3000 && electron .\"",
    "build": "tsc && vite build",
    "package": "electron-builder"
  }
}
```

## 🐛 故障排除

### 问题：窗口圆角显示异常
**解决方案**: 确保使用 Windows 11，Windows 10 会自动降级为简单圆角

### 问题：高 DPI 屏幕上窗口大小不正确
**解决方案**: 已在 v3.0.0 中修复，更新到最新版本

### 问题：拖拽文件无响应
**解决方案**: 检查文件是否在系统保护目录（如 `C:\Windows`）

### 问题：内存占用过高
**解决方案**: 已在 v3.0.0 中修复内存泄漏，重启应用

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 开发指南

- 遵循 TypeScript 严格模式
- 使用 ESLint 和 Prettier 格式化代码
- 编写清晰的提交信息
- 添加必要的注释和文档

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [React](https://react.dev/) - UI 框架
- [Tailwind CSS](https://tailwindcss.com/) - 样式框架
- [Lucide](https://lucide.dev/) - 图标库

## 📞 联系方式

- **作者**: Your Name
- **邮箱**: your.email@example.com
- **GitHub**: [@yourusername](https://github.com/yourusername)
- **问题反馈**: [GitHub Issues](https://github.com/yourusername/tidydesk/issues)

## 🗺️ 路线图

### v3.1.0 (计划中)
- [ ] 多语言支持（英文、日文）
- [ ] 用户设置持久化
- [ ] 键盘快捷键
- [ ] 批量操作

### v3.2.0 (计划中)
- [ ] 主题系统（浅色/深色/自定义）
- [ ] 云同步功能
- [ ] 性能监控面板
- [ ] 错误上报（Sentry）

### v4.0.0 (未来)
- [ ] macOS 支持
- [ ] Linux 支持
- [ ] 插件系统
- [ ] AI 智能推荐

---

**⭐ 如果这个项目对你有帮助，请给个 Star！**

Made with ❤️ by TidyDesk Team
