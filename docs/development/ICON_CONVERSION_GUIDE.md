# 图标转换指南

## 📁 当前状态

✅ **已完成**:
- SVG 图标文件已放置: `build/glyphs-poly--cogwheel.svg`
- 已复制为: `build/icon.svg`
- 已复制为: `build/tray-icon.svg`

⚠️ **待完成**:
- 需要转换为 ICO 格式: `build/icon.ico`
- 需要转换为 ICO 格式: `build/tray-icon.ico`

## 🎯 图标用途

转换后的 `icon.ico` 将用于：
- ✅ **应用程序图标** - 任务栏、窗口标题栏
- ✅ **系统托盘图标** - 任务栏右下角
- ✅ **桌面快捷方式图标** - 桌面和开始菜单
- ✅ **安装程序图标** - 安装向导
- ✅ **文件资源管理器图标** - 程序列表

---

## 🚀 快速转换（推荐）

### 方法 1: 在线转换（最简单）

#### 步骤 1: 访问在线工具
选择以下任一网站：
- 🔗 https://www.icoconverter.com/ （推荐）
- 🔗 https://convertio.co/zh/svg-ico/
- 🔗 https://cloudconvert.com/svg-to-ico

#### 步骤 2: 上传文件
上传文件: `C:\Users\P16V\Desktop\个人开发\TidyDesk\build\icon.svg`

#### 步骤 3: 选择尺寸
勾选以下尺寸：
- ✅ 16x16 (必需 - 托盘图标)
- ✅ 32x32 (必需 - 托盘图标)
- ✅ 48x48 (推荐 - 任务栏)
- ✅ 256x256 (推荐 - 高清显示)

#### 步骤 4: 下载并保存
1. 下载生成的 `icon.ico` 文件
2. 保存到: `C:\Users\P16V\Desktop\个人开发\TidyDesk\build\icon.ico`
3. 复制一份为: `C:\Users\P16V\Desktop\个人开发\TidyDesk\build\tray-icon.ico`

---

## 🔧 方法 2: 使用 ImageMagick

### 安装 ImageMagick

#### Windows 用户:
1. 访问: https://imagemagick.org/script/download.php
2. 下载: `ImageMagick-7.x.x-Q16-HDRI-x64-dll.exe`
3. 安装时勾选 "Add to PATH"
4. 重启命令行

#### 或使用 Chocolatey:
```bash
choco install imagemagick
```

### 转换命令

安装完成后，在项目目录运行：
```bash
node convert-icon.cjs
```

或手动转换：
```bash
magick convert build\icon.svg -define icon:auto-resize=256,128,64,48,32,16 build\icon.ico
```

---

## ✅ 验证转换结果

转换完成后，检查以下文件是否存在：

```
build/
├── icon.svg ✅
├── icon.ico ⚠️ (需要转换)
├── tray-icon.svg ✅
└── tray-icon.ico ⚠️ (需要转换)
```

### 检查命令:
```bash
dir build\*.ico
```

应该看到：
- `icon.ico`
- `tray-icon.ico`

---

## 🧪 测试图标

### 1. 重启应用
```bash
npm run desktop
```

### 2. 检查托盘图标
- 查看任务栏右下角
- 应该能看到齿轮图标
- 鼠标悬停应显示 "TidyDesk - 桌面收纳助手"

### 3. 测试功能
- 右键托盘图标 → 应显示菜单
- 双击托盘图标 → 应切换显示/隐藏
- `Ctrl+Alt+Q` → 应退出应用

---

## 📝 完成后的下一步

图标转换完成后：

1. **测试应用**
   ```bash
   npm run desktop
   ```

2. **测试打包**
   ```bash
   npm run build:electron
   ```

3. **准备发布**
   - 查看 [v3.2.3_SUMMARY.md](./v3.2.3_SUMMARY.md)
   - 完成所有测试清单
   - 发布到 GitHub

---

## 🆘 遇到问题？

### 问题 1: 在线转换后图标不清晰
**解决**: 确保选择了所有推荐的尺寸（16, 32, 48, 256）

### 问题 2: 托盘图标不显示
**解决**: 
1. 确认 `icon.ico` 和 `tray-icon.ico` 都存在
2. 重启应用
3. 检查 Windows 托盘设置

### 问题 3: ImageMagick 安装失败
**解决**: 使用在线转换（方法 1），更简单可靠

---

## 💡 提示

- **推荐使用在线转换** - 最简单、最快速
- **ICO 文件很重要** - 没有 ICO 文件，托盘图标可能不显示
- **两个文件都需要** - `icon.ico` 和 `tray-icon.ico`

---

**当前任务**: 转换 SVG 为 ICO 格式  
**优先级**: 🔴 高  
**预计时间**: 5 分钟

