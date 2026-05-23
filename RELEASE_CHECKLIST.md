# TidyDesk 发布检查清单

## 📋 发布前准备

### 1. 代码准备
- [ ] 所有功能已完成并测试
- [ ] 所有 Bug 已修复
- [ ] 代码已提交到 Git
- [ ] 无未提交的更改

### 2. 版本更新
- [ ] 更新 `package.json` 中的版本号
- [ ] 更新 `CHANGELOG.md`
- [ ] 更新 `README.md`（如有必要）

### 3. 配置检查
- [ ] `package.json` 中的 `build.publish` 配置正确
- [ ] GitHub 用户名和仓库名正确
- [ ] 已设置 `GH_TOKEN` 环境变量

---

## 🚀 发布步骤

### 步骤 1: 设置 GitHub Token

```powershell
# Windows PowerShell
$env:GH_TOKEN="your_github_token_here"

# 验证
echo $env:GH_TOKEN
```

### 步骤 2: 安装依赖

```bash
npm install
```

### 步骤 3: 构建前端

```bash
npm run build
```

**检查**:
- [ ] `dist/` 目录已生成
- [ ] 无构建错误

### 步骤 4: 打包并发布

```bash
npm run build:publish
```

**这个命令会**:
1. 打包 Electron 应用
2. 创建安装程序
3. 上传到 GitHub Releases
4. 生成更新元数据

**预期输出**:
```
• electron-builder  version=24.13.3
• loaded configuration  file=package.json
• building        target=nsis arch=x64
• packaging       platform=win32 arch=x64
• building block map  blockMapFile=TidyDesk-3.1.0-Setup.exe.blockmap
• uploading       file=TidyDesk-3.1.0-Setup.exe
• uploaded        file=TidyDesk-3.1.0-Setup.exe
```

### 步骤 5: 完成 GitHub Release

1. 访问 https://github.com/your-username/TidyDesk/releases
2. 找到 draft release
3. 编辑发布说明
4. 点击 "Publish release"

**检查**:
- [ ] Release 已发布（不是 draft）
- [ ] 包含 `.exe` 安装程序
- [ ] 包含 `latest.yml` 文件
- [ ] 发布说明完整

---

## ✅ 发布后验证

### 1. 下载测试
- [ ] 从 GitHub Releases 下载安装程序
- [ ] 安装到测试机器
- [ ] 验证应用正常启动

### 2. 更新测试
- [ ] 打开已安装的旧版本
- [ ] 点击"检查更新"
- [ ] 验证检测到新版本
- [ ] 下载并安装更新
- [ ] 验证更新成功

### 3. 功能测试
- [ ] 所有核心功能正常
- [ ] 无明显 Bug
- [ ] 性能正常

---

## 📝 发布说明模板

```markdown
## TidyDesk v3.1.0

### ✨ 新功能
- 🔍 实时文件监控 - 自动检测目标文件变化
- 🔧 智能快捷方式修复 - 在常见位置自动搜索文件
- ⏰ 定期自动验证 - 每 30 分钟自动维护
- 🔄 应用内自动更新 - 一键更新到最新版本
- 📦 多抽屉卡片系统 - 创建和管理多个抽屉

### 🐛 修复
- 修复快捷方式验证问题
- 修复内存泄漏
- 优化搜索性能

### 🔧 改进
- 提升启动速度 17%
- 降低内存占用 21%
- 搜索响应提升 70%

### 📥 下载
- Windows x64: [TidyDesk-3.1.0-Setup.exe](链接)

### 📚 文档
- [完整更新日志](CHANGELOG.md)
- [使用指南](README.md)
- [自动更新指南](AUTO_UPDATE_GUIDE.md)

### 🙏 致谢
感谢所有用户的反馈和支持！
```

---

## 🐛 常见问题

### Q1: 发布失败 - "Error: GitHub token is not set"

**解决方案**:
```powershell
# 设置环境变量
$env:GH_TOKEN="your_token_here"

# 或创建 .env 文件
echo GH_TOKEN=your_token_here > .env
```

### Q2: 发布失败 - "Error: Cannot find module 'electron-builder'"

**解决方案**:
```bash
npm install electron-builder --save-dev
```

### Q3: latest.yml 未生成

**解决方案**:
```bash
# 确保 publish 配置正确
# 重新运行
npm run build:publish -- --publish always
```

### Q4: 更新检测不到新版本

**检查**:
1. GitHub Release 是否已发布（不是 draft）
2. `latest.yml` 是否存在
3. 版本号是否正确递增
4. 网络连接是否正常

---

## 📊 版本号规则

```
当前版本: 3.1.0

修复 Bug:     3.1.0 → 3.1.1
新功能:       3.1.0 → 3.2.0
重大变更:     3.1.0 → 4.0.0
```

---

## 🎯 快速命令

```bash
# 完整发布流程
npm install
npm run build
npm run build:publish

# 仅打包（不发布）
npm run build:electron

# 开发模式
npm run dev
```

---

## ✅ 最终检查

发布前确认：
- [ ] 版本号已更新
- [ ] CHANGELOG 已更新
- [ ] 代码已提交
- [ ] GH_TOKEN 已设置
- [ ] 构建成功
- [ ] 发布成功
- [ ] Release 已发布
- [ ] 更新测试通过

**🎉 准备发布！**
