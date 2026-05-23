# TidyDesk 自动更新完整指南

## 📋 目录
1. [功能概述](#功能概述)
2. [技术架构](#技术架构)
3. [配置说明](#配置说明)
4. [发布流程](#发布流程)
5. [用户使用](#用户使用)
6. [故障排除](#故障排除)

---

## 🎯 功能概述

TidyDesk 现在支持完整的应用内自动更新功能：

### 核心功能
- ✅ 自动检查更新（启动时 + 手动）
- ✅ 下载更新包
- ✅ 安装并重启
- ✅ 版本信息显示
- ✅ 更新进度显示
- ✅ 发布说明展示

### 更新流程
```
应用启动
    ↓
延迟 3 秒后自动检查更新
    ↓
发现新版本
    ↓
通知用户
    ↓
用户点击"下载更新"
    ↓
显示下载进度
    ↓
下载完成
    ↓
用户点击"安装并重启"
    ↓
应用重启并安装更新
```

---

## 🏗️ 技术架构

### 使用的技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **electron-updater** | ^6.1.7 | 自动更新核心库 |
| **electron-builder** | ^24.13.3 | 打包和发布工具 |
| **electron-log** | ^5.1.0 | 日志记录 |
| **GitHub Releases** | - | 发布渠道 |

### 架构图

```
┌─────────────────────────────────────────┐
│           前端 (React)                   │
│  ┌─────────────────────────────────┐   │
│  │     SettingsPanel.tsx            │   │
│  │  - 检查更新按钮                   │   │
│  │  - 下载更新按钮                   │   │
│  │  - 安装更新按钮                   │   │
│  │  - 进度显示                       │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
                    ↕ IPC
┌─────────────────────────────────────────┐
│        主进程 (Electron)                 │
│  ┌─────────────────────────────────┐   │
│  │     electron-updater             │   │
│  │  - checkForUpdates()             │   │
│  │  - downloadUpdate()              │   │
│  │  - quitAndInstall()              │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
                    ↕ HTTPS
┌─────────────────────────────────────────┐
│        GitHub Releases                   │
│  - latest.yml (更新元数据)              │
│  - TidyDesk-3.1.0-Setup.exe            │
│  - 发布说明                             │
└─────────────────────────────────────────┘
```

---

## ⚙️ 配置说明

### 1. package.json 配置

```json
{
  "name": "tidydesk",
  "version": "3.1.0",
  "main": "electron/main.cjs",
  "build": {
    "appId": "com.tidydesk.app",
    "productName": "TidyDesk",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "package.json"
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "icon": "build/icon.ico",
      "artifactName": "${productName}-${version}-Setup.${ext}"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "TidyDesk"
    },
    "publish": {
      "provider": "github",
      "owner": "your-github-username",
      "repo": "TidyDesk",
      "releaseType": "release"
    }
  }
}
```

### 2. 主进程配置

```javascript
// electron/main.cjs
const { autoUpdater } = require('electron-updater');

// 配置
autoUpdater.autoDownload = false; // 不自动下载
autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装

// 日志
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';
```

### 3. 环境变量

创建 `.env` 文件（不要提交到 Git）：

```bash
# GitHub Personal Access Token (用于发布)
GH_TOKEN=your_github_personal_access_token
```

---

## 🚀 发布流程

### 步骤 1: 准备发布

#### 1.1 更新版本号

```bash
# 在 package.json 中更新版本
{
  "version": "3.1.0"  # 修改这里
}
```

#### 1.2 更新 CHANGELOG.md

```markdown
## [3.1.0] - 2026-05-24

### Added
- 文件监控功能
- 智能修复功能
- 定期验证功能
- 自动更新功能

### Fixed
- 修复快捷方式验证问题
```

#### 1.3 提交代码

```bash
git add .
git commit -m "chore: bump version to 3.1.0"
git push
```

### 步骤 2: 创建 GitHub Token

1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 勾选 `repo` 权限
4. 生成并复制 token
5. 设置环境变量：
   ```bash
   # Windows (PowerShell)
   $env:GH_TOKEN="your_token_here"
   
   # 或者创建 .env 文件
   echo GH_TOKEN=your_token_here > .env
   ```

### 步骤 3: 构建和发布

```bash
# 安装依赖
npm install

# 构建前端
npm run build

# 打包并发布到 GitHub
npm run build:publish
```

**这个命令会**:
1. 构建 React 应用
2. 打包 Electron 应用
3. 创建安装程序 (.exe)
4. 上传到 GitHub Releases
5. 生成 `latest.yml` 元数据文件

### 步骤 4: 创建 GitHub Release

electron-builder 会自动创建 draft release，你需要：

1. 访问 https://github.com/your-username/TidyDesk/releases
2. 找到 draft release
3. 编辑发布说明：
   ```markdown
   ## TidyDesk v3.1.0
   
   ### ✨ 新功能
   - 🔍 实时文件监控
   - 🔧 智能快捷方式修复
   - ⏰ 定期自动验证
   - 🔄 应用内自动更新
   
   ### 🐛 修复
   - 修复快捷方式验证问题
   - 优化性能
   
   ### 📥 下载
   - Windows: TidyDesk-3.1.0-Setup.exe
   ```
4. 点击 "Publish release"

### 步骤 5: 验证发布

检查 Release 中是否包含：
- ✅ `TidyDesk-3.1.0-Setup.exe` - 安装程序
- ✅ `latest.yml` - 更新元数据
- ✅ 发布说明

---

## 👤 用户使用

### 首次安装

1. 下载 `TidyDesk-3.1.0-Setup.exe`
2. 运行安装程序
3. 选择安装位置
4. 完成安装

### 检查更新

#### 自动检查
- 应用启动后 3 秒自动检查
- 发现更新会显示通知

#### 手动检查
1. 点击顶部工具栏的 ⚙️ 设置按钮
2. 在"软件更新"部分点击"检查更新"
3. 等待检查结果

### 更新流程

#### 发现新版本
```
┌──────────────────────────────────┐
│ ⚠️ 发现新版本: v3.2.0            │
│ 新功能：                         │
│ - 云同步功能                     │
│ - 主题系统                       │
│ [下载更新]                       │
└──────────────────────────────────┘
```

#### 下载更新
```
┌──────────────────────────────────┐
│ 📥 正在下载更新... 45.2%         │
│ ████████████░░░░░░░░░░░░░░       │
└──────────────────────────────────┘
```

#### 安装更新
```
┌──────────────────────────────────┐
│ ✅ 更新已下载，准备安装           │
│ [安装并重启]                     │
└──────────────────────────────────┘
```

点击"安装并重启"后：
1. 应用自动关闭
2. 安装新版本
3. 自动重启应用

---

## 🎨 UI 展示

### 设置面板

```
┌─────────────────────────────────────────┐
│ 设置                              [X]   │
│ 应用设置和更新                          │
├─────────────────────────────────────────┤
│                                         │
│ 应用信息                                │
│ ┌─────────────────────────────────────┐│
│ │ 应用名称          TidyDesk          ││
│ │ 当前版本          v3.1.0            ││
│ │ 运行模式          生产模式          ││
│ └─────────────────────────────────────┘│
│                                         │
│ 软件更新                                │
│ ┌─────────────────────────────────────┐│
│ │ ✅ 已是最新版本                     ││
│ └─────────────────────────────────────┘│
│ [检查更新]                              │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🔧 开发模式

### 跳过更新检查

开发模式下自动跳过更新检查：

```javascript
if (process.env.NODE_ENV === 'development') {
  console.log('[TIDYDESK] Skip update check in development mode');
  return;
}
```

### 测试更新功能

1. 构建生产版本：
   ```bash
   npm run build:electron
   ```

2. 安装到系统：
   ```bash
   # 运行 release/TidyDesk-3.1.0-Setup.exe
   ```

3. 发布新版本到 GitHub

4. 打开已安装的应用，测试更新

---

## 🐛 故障排除

### 问题 1: 检查更新失败

**症状**: 点击"检查更新"后显示错误

**可能原因**:
- 网络连接问题
- GitHub API 限制
- 配置错误

**解决方案**:
```javascript
// 检查日志
// Windows: %APPDATA%\TidyDesk\logs\main.log

// 验证配置
{
  "publish": {
    "provider": "github",
    "owner": "your-github-username",  // ← 确认正确
    "repo": "TidyDesk",               // ← 确认正确
    "releaseType": "release"
  }
}
```

### 问题 2: 下载更新失败

**症状**: 下载进度卡住或失败

**可能原因**:
- 网络不稳定
- GitHub 服务器问题
- 磁盘空间不足

**解决方案**:
1. 检查网络连接
2. 检查磁盘空间
3. 重试下载

### 问题 3: 安装更新失败

**症状**: 点击"安装并重启"后没有反应

**可能原因**:
- 权限不足
- 应用被占用
- 安装包损坏

**解决方案**:
1. 以管理员身份运行
2. 关闭所有 TidyDesk 窗口
3. 重新下载更新

### 问题 4: latest.yml 未生成

**症状**: GitHub Release 中没有 latest.yml

**可能原因**:
- electron-builder 配置错误
- 发布失败

**解决方案**:
```bash
# 检查 electron-builder 配置
npm run build:publish -- --publish always

# 手动上传 latest.yml
# 从 release/ 目录找到 latest.yml 并手动上传到 GitHub Release
```

---

## 📊 版本管理

### 语义化版本

遵循 [Semantic Versioning](https://semver.org/)：

```
MAJOR.MINOR.PATCH

例如: 3.1.0
  │   │  │
  │   │  └─ PATCH: 修复 bug
  │   └──── MINOR: 新功能（向后兼容）
  └──────── MAJOR: 破坏性变更
```

### 版本号规则

| 类型 | 示例 | 说明 |
|------|------|------|
| **Major** | 3.0.0 → 4.0.0 | 重大架构变更 |
| **Minor** | 3.0.0 → 3.1.0 | 新功能 |
| **Patch** | 3.1.0 → 3.1.1 | Bug 修复 |

---

## 🔐 安全性

### 代码签名（可选）

为了避免 Windows SmartScreen 警告，建议购买代码签名证书：

```json
{
  "win": {
    "certificateFile": "path/to/cert.pfx",
    "certificatePassword": "password",
    "signingHashAlgorithms": ["sha256"]
  }
}
```

### 更新验证

electron-updater 自动验证：
- ✅ HTTPS 连接
- ✅ 文件完整性（SHA512）
- ✅ 签名验证（如果有证书）

---

## 📝 最佳实践

### 1. 发布前检查清单

- [ ] 更新版本号
- [ ] 更新 CHANGELOG.md
- [ ] 测试所有功能
- [ ] 构建成功
- [ ] 本地测试安装
- [ ] 提交代码
- [ ] 创建 Git tag
- [ ] 发布到 GitHub
- [ ] 编写发布说明
- [ ] 测试自动更新

### 2. 发布频率

- **Major**: 每年 1-2 次
- **Minor**: 每月 1-2 次
- **Patch**: 按需发布

### 3. 发布说明模板

```markdown
## TidyDesk vX.Y.Z

### ✨ 新功能
- 功能 1
- 功能 2

### 🐛 修复
- 修复 1
- 修复 2

### 🔧 改进
- 改进 1
- 改进 2

### 📥 下载
- Windows: TidyDesk-X.Y.Z-Setup.exe

### 📚 文档
- [完整更新日志](CHANGELOG.md)
- [使用指南](README.md)
```

---

## 🎯 总结

### 实现的功能

1. ✅ **自动检查更新** - 启动时 + 手动
2. ✅ **下载更新** - 显示进度
3. ✅ **安装更新** - 一键重启
4. ✅ **版本管理** - 语义化版本
5. ✅ **GitHub 集成** - 自动发布

### 用户体验

- 🚀 无缝更新体验
- 📊 清晰的进度显示
- 💬 友好的提示信息
- 🔒 安全的更新机制

### 开发体验

- 🛠️ 简单的发布流程
- 📦 自动化打包
- 🔄 持续集成友好
- 📝 完整的文档

---

**文档版本**: v1.0  
**创建日期**: 2026-05-24  
**最后更新**: 2026-05-24  
**作者**: Kiro AI
