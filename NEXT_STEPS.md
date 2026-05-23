# TidyDesk - 下一步操作指南

## ✅ 已完成的功能

### 1. 核心功能
- ✅ 多抽屉卡片系统
- ✅ 拖拽文件到抽屉（创建快捷方式）
- ✅ 抽屉重命名和删除
- ✅ 文件打开和管理

### 2. 高级功能
- ✅ 快捷方式验证系统
- ✅ 实时文件监控（chokidar）
- ✅ 智能修复功能（自动搜索移动的文件）
- ✅ 定期验证（每30分钟）
- ✅ 批量清理失效快捷方式

### 3. 自动更新系统
- ✅ electron-updater 集成
- ✅ electron-builder 配置
- ✅ 设置面板 UI
- ✅ 检查更新功能
- ✅ 下载更新功能
- ✅ 安装更新功能
- ✅ 版本信息显示
- ✅ 更新进度显示

---

## 🚀 接下来需要做的事情

### 步骤 1: 配置 GitHub 仓库

#### 1.1 更新 package.json 中的 GitHub 信息

打开 `package.json`，找到 `build.publish` 部分，修改为你的 GitHub 用户名：

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "your-github-username",  // ← 改成你的 GitHub 用户名
      "repo": "TidyDesk",
      "releaseType": "release"
    }
  }
}
```

**示例**：
- 如果你的 GitHub 是 `https://github.com/zhangsan`
- 那么 `owner` 应该填 `"zhangsan"`

#### 1.2 创建 GitHub 仓库

1. 访问 https://github.com/new
2. 仓库名称填写：`TidyDesk`
3. 选择 Public 或 Private（推荐 Public，这样用户可以下载）
4. 不要勾选 "Initialize this repository with a README"
5. 点击 "Create repository"

#### 1.3 推送代码到 GitHub

```bash
# 初始化 Git（如果还没有）
git init

# 添加远程仓库（替换成你的 GitHub 用户名）
git remote add origin https://github.com/your-github-username/TidyDesk.git

# 添加所有文件
git add .

# 提交
git commit -m "Initial commit: TidyDesk v3.0.0 with auto-update"

# 推送到 GitHub
git push -u origin main
```

---

### 步骤 2: 创建 GitHub Personal Access Token

#### 2.1 生成 Token

1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token" → "Generate new token (classic)"
3. 填写信息：
   - **Note**: `TidyDesk Auto Update`
   - **Expiration**: 选择 `No expiration` 或 `90 days`
   - **Select scopes**: 勾选 `repo` (完整的仓库权限)
4. 点击 "Generate token"
5. **重要**: 复制生成的 token（只显示一次！）

#### 2.2 设置环境变量

**Windows PowerShell**:
```powershell
# 临时设置（当前会话有效）
$env:GH_TOKEN="ghp_your_token_here"

# 验证
echo $env:GH_TOKEN
```

**或者创建 .env 文件**（推荐）:
```bash
# 在项目根目录创建 .env 文件
echo GH_TOKEN=ghp_your_token_here > .env
```

> ⚠️ **注意**: `.env` 文件已经在 `.gitignore` 中，不会被提交到 Git

---

### 步骤 3: 安装依赖

```bash
npm install
```

这会安装：
- `electron-updater@^6.1.7` - 自动更新核心
- `electron-builder@^24.13.3` - 打包工具
- `electron-log@^5.1.0` - 日志记录
- `chokidar@^3.6.0` - 文件监控

---

### 步骤 4: 测试开发环境

```bash
# 启动开发服务器
npm run dev
```

**测试功能**:
1. ✅ 创建抽屉
2. ✅ 拖拽文件到抽屉
3. ✅ 点击设置按钮（⚙️）
4. ✅ 查看版本信息
5. ✅ 点击"检查更新"（开发模式会显示提示）

---

### 步骤 5: 构建第一个版本

#### 5.1 确认版本号

打开 `package.json`，确认版本号：
```json
{
  "version": "3.0.0"  // 第一个版本
}
```

#### 5.2 构建并发布

```bash
# 构建前端
npm run build

# 打包并发布到 GitHub
npm run build:publish
```

**预期输出**:
```
• electron-builder  version=24.13.3
• loaded configuration  file=package.json
• building        target=nsis arch=x64
• packaging       platform=win32 arch=x64
• building block map  blockMapFile=TidyDesk-3.0.0-Setup.exe.blockmap
• uploading       file=TidyDesk-3.0.0-Setup.exe
• uploaded        file=TidyDesk-3.0.0-Setup.exe
```

构建产物会在 `release/` 目录：
- `TidyDesk-3.0.0-Setup.exe` - 安装程序
- `latest.yml` - 更新元数据

---

### 步骤 6: 发布 GitHub Release

#### 6.1 访问 GitHub Releases

1. 访问 `https://github.com/your-github-username/TidyDesk/releases`
2. 你会看到一个 **Draft** release（草稿）

#### 6.2 编辑 Release

点击 "Edit" 按钮，填写发布说明：

```markdown
## TidyDesk v3.0.0 - 首次发布 🎉

### ✨ 核心功能
- 🗂️ 多抽屉卡片系统 - 创建多个抽屉分类管理桌面文件
- 🖱️ 拖拽操作 - 直接拖拽桌面文件到抽屉
- ✏️ 抽屉管理 - 重命名、删除抽屉
- 📂 快捷方式管理 - 非破坏性操作，不移动原文件

### 🔍 智能功能
- ✅ 快捷方式验证 - 自动检测失效的快捷方式
- 🔧 智能修复 - 自动搜索移动的文件并修复快捷方式
- 👁️ 实时监控 - 监控目标文件变化
- ⏰ 定期验证 - 每30分钟自动维护
- 🧹 批量清理 - 一键清理所有失效快捷方式

### 🔄 自动更新
- 📥 应用内更新 - 无需手动下载
- 📊 更新进度显示
- 🔔 更新通知

### 📥 下载
- Windows x64: [TidyDesk-3.0.0-Setup.exe](链接会自动生成)

### 📚 使用指南
1. 下载并安装 TidyDesk
2. 点击 "+" 创建抽屉
3. 拖拽桌面文件到抽屉
4. 点击 ⚙️ 设置按钮检查更新

### 🙏 致谢
感谢使用 TidyDesk！如有问题请提交 Issue。
```

#### 6.3 发布

1. 确认 Release 包含：
   - ✅ `TidyDesk-3.0.0-Setup.exe`
   - ✅ `latest.yml`
2. 点击 **"Publish release"**（不是 "Save draft"）

---

### 步骤 7: 测试自动更新

#### 7.1 安装第一个版本

1. 从 GitHub Release 下载 `TidyDesk-3.0.0-Setup.exe`
2. 运行安装程序
3. 安装到系统

#### 7.2 创建第二个版本

1. 修改 `package.json` 版本号：
   ```json
   {
     "version": "3.0.1"  // 升级版本
   }
   ```

2. 更新 `CHANGELOG.md`：
   ```markdown
   ## [3.0.1] - 2026-05-24
   
   ### Fixed
   - 修复某个 bug
   ```

3. 提交代码：
   ```bash
   git add .
   git commit -m "chore: bump version to 3.0.1"
   git push
   ```

4. 构建并发布：
   ```bash
   npm run build:publish
   ```

5. 发布 GitHub Release（同步骤 6）

#### 7.3 测试更新

1. 打开已安装的 TidyDesk v3.0.0
2. 点击 ⚙️ 设置按钮
3. 点击 "检查更新"
4. 应该显示 "发现新版本: v3.0.1"
5. 点击 "下载更新"
6. 等待下载完成
7. 点击 "安装并重启"
8. 应用重启后，版本应该是 v3.0.1

---

## 📋 快速命令参考

```bash
# 开发
npm run dev                  # 启动开发服务器

# 构建
npm run build                # 构建前端
npm run build:electron       # 打包（不发布）
npm run build:publish        # 打包并发布到 GitHub

# Git
git add .
git commit -m "message"
git push

# 环境变量
$env:GH_TOKEN="your_token"   # PowerShell
echo $env:GH_TOKEN           # 验证
```

---

## 🐛 常见问题

### Q1: 发布失败 - "Error: GitHub token is not set"

**解决方案**:
```powershell
$env:GH_TOKEN="your_token_here"
```

### Q2: 发布失败 - "Error: Cannot find module 'electron-builder'"

**解决方案**:
```bash
npm install
```

### Q3: 更新检测不到新版本

**检查**:
1. GitHub Release 是否已发布（不是 draft）
2. `latest.yml` 是否存在
3. 版本号是否正确递增（3.0.0 → 3.0.1）
4. 网络连接是否正常

### Q4: Windows Defender 警告

这是正常的，因为应用没有代码签名证书。用户需要点击 "更多信息" → "仍要运行"。

**解决方案**（可选）:
- 购买代码签名证书（约 $200-400/年）
- 配置 `win.certificateFile` 和 `win.certificatePassword`

---

## 📚 相关文档

- [AUTO_UPDATE_GUIDE.md](./AUTO_UPDATE_GUIDE.md) - 自动更新完整指南
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) - 发布检查清单
- [CHANGELOG.md](./CHANGELOG.md) - 版本更新日志
- [README.md](./README.md) - 项目说明

---

## 🎯 总结

### 当前状态
✅ 所有功能已实现  
✅ 自动更新系统已配置  
⏳ 等待 GitHub 配置和首次发布

### 下一步
1. 修改 `package.json` 中的 GitHub 用户名
2. 创建 GitHub 仓库并推送代码
3. 创建 GitHub Token
4. 运行 `npm install`
5. 运行 `npm run build:publish`
6. 发布 GitHub Release
7. 测试自动更新

### 预计时间
- GitHub 配置: 10 分钟
- 首次构建: 5 分钟
- 发布 Release: 5 分钟
- 测试更新: 10 分钟
- **总计**: 约 30 分钟

---

**准备好了吗？开始第一步：修改 package.json 中的 GitHub 用户名！** 🚀
