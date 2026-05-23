# 立即发布 v3.2.4

## ✅ 当前状态

- ✅ 代码已推送到 GitHub
- ✅ Tag `v3.2.4` 已创建
- ✅ 安装包已生成
- ⏳ 待发布到 GitHub Releases

---

## 🚀 发布命令（推荐）

```powershell
# 1. 进入项目目录
cd "C:\Users\P16V\Desktop\个人开发\TidyDesk"

# 2. 读取 GitHub Token
$env:GH_TOKEN = (Get-Content .env | Select-String "GH_TOKEN" | ForEach-Object { $_ -replace "GH_TOKEN=", "" })

# 3. 构建并发布
npm run build:publish
```

**说明**: 
- 这会自动构建应用并发布到 GitHub Releases
- 包括上传安装包和更新配置文件
- 用户可以通过应用内自动更新获取

---

## 📋 或者手动发布

如果自动发布失败，可以手动操作：

### 1. 访问 GitHub Releases
```
https://github.com/tanzanite2025/TidyDesk/releases/new
```

### 2. 填写信息
- **Tag**: 选择 `v3.2.4`
- **标题**: `v3.2.4 - 应用扫描性能优化 & 删除功能修复`
- **描述**: 复制 `v3.2.4_PUBLISHED.md` 中的 Release Notes

### 3. 上传文件
拖入以下文件：
- `release/TidyDesk-3.2.4-Setup.exe`
- `release/TidyDesk-3.2.4-Setup.exe.blockmap`
- `release/latest.yml`

### 4. 发布
点击 "Publish release" 按钮

---

## 🎉 发布后

### 验证
1. 访问：https://github.com/tanzanite2025/TidyDesk/releases
2. 确认 v3.2.4 已发布
3. 下载安装包测试

### 测试自动更新
1. 安装旧版本（v3.2.3）
2. 启动应用
3. 检查是否提示更新
4. 测试更新流程

---

**准备好了吗？执行上面的命令开始发布！** 🚀
