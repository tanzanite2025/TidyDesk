# 上传 TidyDesk v3.0.1 到 GitHub Release

**快速指南** - 5 分钟完成

---

## 📦 安装包信息

- **文件**: `release/TidyDesk-3.0.1-Setup.exe`
- **大小**: ~78 MB
- **状态**: ✅ 已生成

---

## 🚀 上传步骤

### 方法 1: 网页上传（推荐）⭐

1. **打开 Release 页面**
   ```
   https://github.com/tanzanite2025/TidyDesk/releases/tag/v3.0.1
   ```

2. **点击 "Edit release"**

3. **上传文件**
   - 拖拽 `release/TidyDesk-3.0.1-Setup.exe` 到上传区域
   - 或点击 "Attach binaries" 选择文件

4. **填写信息**
   - **Title**: `v3.0.1 - 应用扫描稳定性与 Sidecar 打包验证`
   - **Description**: 复制下面的发布说明

5. **发布**
   - 点击 "Update release"
   - ✅ 完成！

---

## 📝 发布说明（复制到 Release）

```markdown
# TidyDesk v3.0.1 - 应用扫描稳定性与 Sidecar 打包验证

## � 本次更新

### 应用扫描链路升级

- 应用扫描统一走 Go sidecar `tidydesk-apps-cache`
- Electron 端启动时校验 sidecar 的 `ping` / `version` / `health`
- AppPicker 继续支持扫描已安装应用并添加到抽屉
- 移除旧的 JS 扫描回退路径，减少不同扫描实现带来的不一致

### 打包版本验证

- Windows 安装包已内置 Go sidecar
- sidecar 已打包到：
  ```text
  resources/sidecars/apps-cache/tidydesk-apps-cache.exe
  ```
- 已验证 packaged sidecar 可正常返回：
  ```text
  ping: tidydesk-apps-cache-sidecar
  version: 0.1.0
  protocolVersion: 1
  health: ok
  ```

### 自动更新测试准备

- 生成 `latest.yml`
- 生成 `TidyDesk-3.0.1-Setup.exe.blockmap`
- 可用于从 `v3.0.0` 自动更新到 `v3.0.1`

### 内部迁移准备

- 保留现有 Electron 正式入口
- 新增 Tauri PoC 相关代码用于后续迁移验证
- 当前正式安装包仍以 Electron 版本为准

---

## 📦 安装说明

### 新用户
1. 下载 `TidyDesk-3.0.1-Setup.exe`
2. 运行安装程序
3. 启动应用

### 从 v3.0.0 升级
1. 下载 `TidyDesk-3.0.1-Setup.exe`
2. 运行安装程序（自动覆盖）
3. 重启应用

### 从 v3.0.0 自动更新
1. 确保本机安装的是 `v3.0.0`
2. 发布本次 `v3.0.1` Release
3. 启动旧版本应用并触发更新检查
4. 下载并安装更新
5. 重启后确认版本为 `v3.0.1`

---

## 🧪 测试验证

### 测试应用扫描
1. 打开 TidyDesk
2. 打开应用选择器
3. 验证已安装应用列表可以正常加载
4. 选择一个应用添加到抽屉
5. 验证快捷方式可以正常打开目标应用

### 测试 packaged sidecar
1. 安装 `TidyDesk-3.0.1-Setup.exe`
2. 启动应用
3. 验证应用扫描功能可用
4. 确认没有 sidecar 缺失或启动失败提示

---

## ⚠️ 注意事项

- 当前安装包仍是 Electron 正式版本
- Tauri 相关内容仍是 PoC，不替代 Electron 正式入口
- 如果本机已经安装 `v3.0.1`，自动更新不会触发
- 某些绿色软件或非标准快捷方式可能不会被扫描到

---

## 📝 完整更新日志

查看 [CHANGELOG.md](https://github.com/tanzanite2025/TidyDesk/blob/main/CHANGELOG.md)

---

## 🙏 致谢

感谢持续测试应用扫描、打包和自动更新链路。

---

**建议从 v3.0.0 升级到 v3.0.1，验证应用扫描与自动更新链路。** 🚀
```

---

## ✅ 上传后验证

1. **检查文件**
   - ✅ 安装包已显示
   - ✅ 文件大小正确（~78 MB）
   - ✅ 下载链接可用

2. **检查信息**
   - ✅ Release 标题正确
   - ✅ Release 说明完整
   - ✅ 发布状态为 "Latest"

3. **测试下载**
   - ✅ 下载安装包
   - ✅ 运行安装程序
   - ✅ 测试应用扫描和添加到抽屉

---

## 🎉 完成！

上传完成后，删除本文件：
```bash
rm UPLOAD_GUIDE.md
rm RELEASE_v3.0.1_FINAL.md
rm AUDIT_SUMMARY.md
```

---

**创建时间**: 2026-05-24  
**状态**: 待上传
