# TidyDesk 发布命令清单

## 📋 完整发布流程

### 1️⃣ 准备阶段

#### 更新版本号
```bash
# 手动编辑 package.json，将 version 改为 "3.1.0"
```

#### 更新 CHANGELOG.md
```bash
# 手动编辑 CHANGELOG.md，添加版本更新日志
```

---

### 2️⃣ 测试阶段

#### 开发模式测试
```bash
npm run dev
```

**测试内容**:
- ✅ 拖动文件到抽屉
- ✅ 点击还原按钮
- ✅ 点击"+"按钮添加应用
- ✅ 检查文件图标显示
- ✅ 检查任务栏是否有图标

---

### 3️⃣ 构建阶段

#### 清理旧构建
```bash
# 删除 dist 和 release 目录（可选）
rmdir /s /q dist
rmdir /s /q release
```

#### 构建应用
```bash
npm run build
```

**输出文件**:
- `release/TidyDesk-3.1.0-Setup.exe` - 安装程序
- `release/TidyDesk-3.1.0-Setup.exe.blockmap` - 增量更新文件
- `release/latest.yml` - 更新配置文件

---

### 4️⃣ 发布阶段

#### 发布到 GitHub Releases
```bash
npm run publish
```

**这个命令会**:
1. 构建应用（如果还没构建）
2. 上传文件到 GitHub Releases
3. 创建新的 Release 标签

**需要的环境变量**:
- `GH_TOKEN` - GitHub Personal Access Token（已在 .env 中配置）

---

### 5️⃣ 验证阶段

#### 检查 GitHub Release
1. 访问 https://github.com/tanzanite2025/TidyDesk/releases
2. 确认 v3.1.0 已发布
3. 确认文件已上传：
   - `TidyDesk-3.1.0-Setup.exe`
   - `TidyDesk-3.1.0-Setup.exe.blockmap`
   - `latest.yml`

#### 测试自动更新
1. 安装旧版本（v3.0.x）
2. 启动应用
3. 检查是否提示更新
4. 测试更新流程

---

## 🔑 环境配置

### .env 文件
```env
GH_TOKEN=your_github_token_here
```

### package.json 配置
```json
{
  "name": "tidydesk",
  "version": "3.1.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/tanzanite2025/TidyDesk.git"
  },
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "tanzanite2025",
        "repo": "TidyDesk"
      }
    ]
  }
}
```

---

## 📝 快速命令参考

### 常用命令
```bash
# 开发模式
npm run dev

# 构建应用
npm run build

# 发布到 GitHub
npm run publish

# 清理构建
rmdir /s /q dist release
```

### Git 命令（可选）
```bash
# 提交代码
git add .
git commit -m "Release v3.1.0"
git push origin main

# 创建标签
git tag v3.1.0
git push origin v3.1.0
```

---

## ⚠️ 注意事项

### 发布前检查
- [ ] 版本号已更新（package.json）
- [ ] CHANGELOG.md 已更新
- [ ] .env 文件中的 GH_TOKEN 有效
- [ ] 所有功能已测试通过
- [ ] 没有未提交的代码更改

### 发布后检查
- [ ] GitHub Release 已创建
- [ ] 文件已上传完整
- [ ] latest.yml 内容正确
- [ ] 自动更新功能正常

### 常见问题

**Q: npm run publish 失败怎么办？**
A: 检查：
1. GH_TOKEN 是否有效
2. 网络连接是否正常
3. GitHub 仓库权限是否正确

**Q: 如何重新发布？**
A: 
1. 删除 GitHub 上的 Release
2. 删除本地 release 目录
3. 重新运行 `npm run build` 和 `npm run publish`

**Q: 如何发布测试版本？**
A: 
1. 版本号使用 `-beta` 后缀（如 3.1.0-beta.1）
2. 在 GitHub Release 中勾选 "This is a pre-release"

---

## 📊 发布检查清单

### 发布前
- [ ] 代码已提交到 Git
- [ ] 版本号已更新
- [ ] CHANGELOG.md 已更新
- [ ] 所有功能已测试
- [ ] 文档已更新

### 发布中
- [ ] 运行 `npm run build`
- [ ] 检查构建输出
- [ ] 运行 `npm run publish`
- [ ] 等待上传完成

### 发布后
- [ ] 检查 GitHub Release
- [ ] 下载并测试安装程序
- [ ] 测试自动更新
- [ ] 通知用户更新

---

## 🚀 一键发布脚本

创建 `publish.bat` 文件：

```batch
@echo off
echo ========================================
echo TidyDesk 发布脚本
echo ========================================
echo.

echo [1/4] 清理旧构建...
if exist dist rmdir /s /q dist
if exist release rmdir /s /q release
echo 清理完成！
echo.

echo [2/4] 构建应用...
call npm run build
if errorlevel 1 (
    echo 构建失败！
    pause
    exit /b 1
)
echo 构建完成！
echo.

echo [3/4] 发布到 GitHub...
call npm run publish
if errorlevel 1 (
    echo 发布失败！
    pause
    exit /b 1
)
echo 发布完成！
echo.

echo [4/4] 打开 GitHub Releases 页面...
start https://github.com/tanzanite2025/TidyDesk/releases
echo.

echo ========================================
echo 发布成功！
echo ========================================
pause
```

使用方法：
```bash
# 双击运行 publish.bat
# 或在命令行运行
publish.bat
```

---

## 📞 获取帮助

如果遇到问题：
1. 查看 electron-builder 文档：https://www.electron.build/
2. 查看 electron-updater 文档：https://www.electron.build/auto-update
3. 查看 GitHub 问题：https://github.com/tanzanite2025/TidyDesk/issues

---

**记住这些命令，轻松发布 TidyDesk！** 🚀
