# TidyDesk Git 配置指南

## 📋 .gitignore 配置说明

### ✅ 已配置忽略的文件类型

#### 1. 依赖和包管理
```
node_modules/          # npm 依赖包
package-lock.json      # 锁文件（团队协作时可选择保留）
```

#### 2. 构建输出
```
dist/                  # Vite 构建输出
dist-electron/         # Electron 构建输出
out/                   # 其他构建输出
build/                 # 构建目录
```

#### 3. 开发日志
```
*.log                  # 所有日志文件
vite-dev.log          # Vite 开发日志
vite-dev.err.log      # Vite 错误日志
npm-debug.log*        # npm 调试日志
```

#### 4. 编辑器配置
```
.vscode/*             # VSCode 配置（除了扩展推荐）
.idea                 # JetBrains IDE 配置
.DS_Store             # macOS 文件
```

#### 5. 环境变量
```
.env                  # 环境变量文件
.env.local            # 本地环境变量
.env.*.local          # 各环境的本地配置
```

#### 6. Electron 打包产物
```
*.exe                 # Windows 可执行文件
*.dmg                 # macOS 安装包
*.AppImage            # Linux 安装包
*.asar                # Electron 打包文件
```

#### 7. 临时文件
```
*.tmp                 # 临时文件
*.temp                # 临时文件
*.swp                 # Vim 交换文件
*~                    # 备份文件
.cache/               # 缓存目录
```

---

## 🗑️ 当前需要删除的文件

### 日志文件（不应提交到 Git）
```bash
# 这些文件已在项目中，但不应提交
vite-dev.log
vite-dev.err.log
```

**删除命令**:
```bash
# 如果已经提交到 Git，需要从 Git 中移除
git rm --cached vite-dev.log vite-dev.err.log

# 如果还未提交，直接删除即可
rm vite-dev.log vite-dev.err.log
```

---

## 📝 应该提交到 Git 的文件

### ✅ 源代码
- `src/**/*` - 所有源代码
- `electron/**/*` - Electron 主进程代码

### ✅ 配置文件
- `package.json` - 项目依赖配置
- `tsconfig.json` - TypeScript 配置
- `tsconfig.node.json` - Node.js TypeScript 配置
- `vite.config.ts` - Vite 配置
- `tailwind.config.js` - Tailwind CSS 配置
- `postcss.config.js` - PostCSS 配置

### ✅ 入口文件
- `index.html` - HTML 入口
- `server.js` - 开发服务器（如果需要）

### ✅ 文档
- `README.md` - 项目说明
- `CHANGELOG.md` - 版本历史
- `*.md` - 所有 Markdown 文档

### ✅ Git 配置
- `.gitignore` - Git 忽略规则

---

## 🤔 可选提交的文件

### package-lock.json
**建议**: 
- ✅ **提交** - 如果是团队协作项目，确保依赖版本一致
- ❌ **不提交** - 如果是个人项目或库项目

**当前建议**: ❌ 不提交（已在 .gitignore 中）

### .vscode/extensions.json
**建议**: ✅ 提交 - 推荐的 VSCode 扩展列表

**示例**:
```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss"
  ]
}
```

---

## 🚀 初始化 Git 仓库

### 1. 初始化（如果还未初始化）
```bash
git init
```

### 2. 添加远程仓库
```bash
git remote add origin https://github.com/yourusername/tidydesk.git
```

### 3. 配置用户信息
```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

### 4. 首次提交
```bash
# 添加所有文件（.gitignore 会自动过滤）
git add .

# 查看将要提交的文件
git status

# 提交
git commit -m "Initial commit: TidyDesk v3.0.0

- Electron + React + TypeScript 桌面应用
- 智能文件整理功能
- 快捷方式抽屉系统
- 桌面健康度评分
- 完整的文档和测试"

# 推送到远程仓库
git push -u origin main
```

---

## 📦 .gitattributes 配置（可选）

创建 `.gitattributes` 文件来规范化行尾：

```gitattributes
# Auto detect text files and perform LF normalization
* text=auto

# Source code
*.js text eol=lf
*.ts text eol=lf
*.tsx text eol=lf
*.jsx text eol=lf
*.json text eol=lf
*.css text eol=lf
*.html text eol=lf
*.md text eol=lf

# Windows scripts
*.bat text eol=crlf
*.cmd text eol=crlf
*.ps1 text eol=crlf

# Binary files
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.mov binary
*.mp4 binary
*.mp3 binary
*.flv binary
*.fla binary
*.swf binary
*.gz binary
*.zip binary
*.7z binary
*.ttf binary
*.eot binary
*.woff binary
*.woff2 binary
*.asar binary
*.exe binary
*.dmg binary
```

---

## 🔍 检查 Git 状态

### 查看当前状态
```bash
git status
```

### 查看忽略的文件
```bash
git status --ignored
```

### 查看将要提交的文件
```bash
git diff --cached --name-only
```

### 检查是否有大文件
```bash
# Windows PowerShell
Get-ChildItem -Recurse -File | Where-Object { $_.Length -gt 1MB } | Select-Object FullName, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}}
```

---

## ⚠️ 常见问题

### 1. 已经提交了不该提交的文件
```bash
# 从 Git 中移除但保留本地文件
git rm --cached <file>

# 从 Git 和本地都删除
git rm <file>

# 提交更改
git commit -m "Remove ignored files"
```

### 2. .gitignore 不生效
```bash
# 清除 Git 缓存
git rm -r --cached .
git add .
git commit -m "Update .gitignore"
```

### 3. 查看某个文件是否被忽略
```bash
git check-ignore -v <file>
```

### 4. 强制添加被忽略的文件
```bash
git add -f <file>
```

---

## 📊 Git 最佳实践

### 提交信息规范
```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型（type）**:
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具相关

**示例**:
```bash
git commit -m "feat(drawer): add smooth slide animation

- Implement 60fps window animation
- Add easing functions
- Support Windows 10/11

Closes #123"
```

### 分支策略
```
main          # 生产分支
├── develop   # 开发分支
├── feature/* # 功能分支
├── bugfix/*  # Bug 修复分支
└── hotfix/*  # 紧急修复分支
```

### 提交频率
- ✅ 每完成一个小功能就提交
- ✅ 每修复一个 Bug 就提交
- ❌ 不要积累太多更改再提交
- ❌ 不要提交未完成的功能

---

## 🔒 敏感信息保护

### 永远不要提交
- ❌ API 密钥
- ❌ 数据库密码
- ❌ 私钥文件
- ❌ 用户数据
- ❌ 日志文件

### 如果不小心提交了敏感信息
```bash
# 使用 git-filter-repo 清理历史
pip install git-filter-repo
git filter-repo --path <sensitive-file> --invert-paths

# 或使用 BFG Repo-Cleaner
java -jar bfg.jar --delete-files <sensitive-file>
```

---

## ✅ 检查清单

在首次提交前，确认：

- [ ] `.gitignore` 已配置
- [ ] 删除了所有 `.log` 文件
- [ ] 删除了 `node_modules/`（如果存在）
- [ ] 删除了 `dist/` 目录（如果存在）
- [ ] 检查了没有敏感信息
- [ ] 配置了用户名和邮箱
- [ ] 测试了 `.gitignore` 是否生效
- [ ] 查看了 `git status` 确认文件列表正确

---

**最后更新**: 2026-05-23  
**版本**: v1.0.0
