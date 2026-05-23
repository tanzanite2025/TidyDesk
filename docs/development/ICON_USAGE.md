# TidyDesk 图标使用说明

## 🎨 图标设计

**图标**: 齿轮（Cogwheel）  
**颜色**: 紫色 (#9b51e0) + 白色 (#f2f2f2)  
**风格**: 扁平化、现代

### 设计理念
- **齿轮** - 象征系统工具、整理、优化
- **紫色** - 专业、创新、科技感
- **简洁** - 易于识别，适合小尺寸显示

---

## 📁 图标文件

### 源文件
```
build/
├── glyphs-poly--cogwheel.svg  # 原始 SVG 文件
├── icon.svg                    # 应用图标 SVG
└── tray-icon.svg               # 托盘图标 SVG
```

### 转换后的文件（需要生成）
```
build/
├── icon.ico                    # 应用图标 ICO（多尺寸）
└── tray-icon.ico               # 托盘图标 ICO（多尺寸）
```

---

## 🎯 图标用途

### 1. 应用程序图标 (`icon.ico`)

#### 用于：
- ✅ **窗口标题栏** - 所有窗口左上角
- ✅ **任务栏** - Windows 任务栏
- ✅ **Alt+Tab 切换** - 应用切换界面
- ✅ **桌面快捷方式** - 桌面图标
- ✅ **开始菜单** - 开始菜单快捷方式
- ✅ **程序列表** - 控制面板 → 程序和功能
- ✅ **安装程序** - 安装向导图标

#### 配置位置：
```json
// package.json
{
  "build": {
    "win": {
      "icon": "build/icon.ico"  // ← 这里
    }
  }
}
```

#### 尺寸要求：
- 16x16 - 小图标
- 32x32 - 标准图标
- 48x48 - 大图标
- 256x256 - 高清图标

### 2. 系统托盘图标 (`tray-icon.ico`)

#### 用于：
- ✅ **系统托盘** - 任务栏右下角
- ✅ **托盘菜单** - 右键菜单图标
- ✅ **气球通知** - 通知图标

#### 配置位置：
```javascript
// electron/resident.cjs
const iconPath = path.join(__dirname, '../build/tray-icon.ico');
tray = new Tray(iconPath);
```

#### 尺寸要求：
- 16x16 - 标准托盘图标（必需）
- 32x32 - 高 DPI 托盘图标（必需）

---

## 🔄 图标转换流程

### 步骤 1: 准备 SVG 文件
✅ 已完成 - `build/icon.svg` 已就绪

### 步骤 2: 转换为 ICO 格式

#### 方法 A: 在线转换（推荐）
1. 访问：https://www.icoconverter.com/
2. 上传：`build/icon.svg`
3. 选择尺寸：16, 32, 48, 256
4. 下载：`icon.ico`
5. 保存到：`build/icon.ico`
6. 复制为：`build/tray-icon.ico`

#### 方法 B: ImageMagick
```bash
magick convert build/icon.svg -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
copy build\icon.ico build\tray-icon.ico
```

### 步骤 3: 验证
```bash
# 检查文件是否存在
dir build\*.ico

# 应该看到：
# icon.ico
# tray-icon.ico
```

---

## 🧪 测试图标

### 开发环境测试

```bash
npm run desktop
```

**检查项**:
- [ ] 窗口标题栏显示齿轮图标
- [ ] 任务栏显示齿轮图标
- [ ] 系统托盘显示齿轮图标
- [ ] 托盘图标清晰可见
- [ ] 鼠标悬停显示工具提示

### 打包测试

```bash
npm run build:electron
```

**检查项**:
- [ ] 安装程序显示齿轮图标
- [ ] 安装后桌面快捷方式显示齿轮图标
- [ ] 开始菜单快捷方式显示齿轮图标
- [ ] 程序列表显示齿轮图标
- [ ] 运行后所有窗口显示齿轮图标

---

## 📐 图标尺寸规范

### ICO 文件包含的尺寸

| 尺寸 | 用途 | 优先级 |
|------|------|--------|
| 16x16 | 托盘图标、小图标 | 🔴 必需 |
| 32x32 | 托盘图标（高DPI）、标准图标 | 🔴 必需 |
| 48x48 | 任务栏、文件管理器 | 🟡 推荐 |
| 64x64 | 高DPI 显示 | 🟢 可选 |
| 128x128 | 高DPI 显示 | 🟢 可选 |
| 256x256 | 高清显示、缩放 | 🟡 推荐 |

### 最小配置（必需）
- 16x16
- 32x32

### 推荐配置
- 16x16
- 32x32
- 48x48
- 256x256

### 完整配置
- 16x16
- 32x32
- 48x48
- 64x64
- 128x128
- 256x256

---

## 🎨 图标设计建议

### 当前图标特点
✅ **优点**:
- 简洁明了
- 易于识别
- 适合小尺寸
- 颜色对比度好

### 未来改进建议

#### 短期（v3.3.0）
- 考虑添加品牌色变体
- 优化 16x16 尺寸的清晰度
- 添加浅色/深色主题版本

#### 中期（v3.4.0）
- 设计动画版本（托盘闪烁）
- 设计状态指示版本（忙碌、空闲）
- 设计节日主题版本

#### 长期（v4.0.0+）
- 专业设计师重新设计
- 品牌识别系统
- 完整的视觉规范

---

## 🔧 故障排除

### 问题 1: 托盘图标不显示

**可能原因**:
- ICO 文件不存在
- ICO 文件损坏
- 路径错误

**解决方案**:
1. 检查文件是否存在：`dir build\tray-icon.ico`
2. 重新转换 SVG 为 ICO
3. 重启应用

### 问题 2: 图标模糊不清

**可能原因**:
- 缺少小尺寸（16x16, 32x32）
- 只有大尺寸（256x256）

**解决方案**:
1. 确保 ICO 包含 16x16 和 32x32 尺寸
2. 重新转换，选择所有推荐尺寸

### 问题 3: 安装后图标不正确

**可能原因**:
- 打包时 ICO 文件不存在
- 缓存问题

**解决方案**:
1. 确保打包前 `build/icon.ico` 存在
2. 清理缓存：删除 `release` 目录
3. 重新打包：`npm run build:electron`

### 问题 4: 不同窗口图标不一致

**可能原因**:
- 多个图标文件版本不同
- 缓存问题

**解决方案**:
1. 确保 `icon.ico` 和 `tray-icon.ico` 是同一个文件
2. 重启应用
3. 清理 Windows 图标缓存

---

## 📝 检查清单

### 转换前
- [ ] SVG 文件已放置：`build/icon.svg`
- [ ] SVG 文件已复制：`build/tray-icon.svg`

### 转换后
- [ ] ICO 文件已创建：`build/icon.ico`
- [ ] ICO 文件已复制：`build/tray-icon.ico`
- [ ] ICO 包含所有必需尺寸（16, 32）
- [ ] ICO 包含推荐尺寸（48, 256）

### 测试
- [ ] 开发环境图标正常
- [ ] 托盘图标可见
- [ ] 打包后图标正常
- [ ] 安装后图标正常

---

## 🔗 相关文档

- [ICON_CONVERSION_GUIDE.md](./ICON_CONVERSION_GUIDE.md) - 图标转换指南
- [v3.2.3_SUMMARY.md](./v3.2.3_SUMMARY.md) - 版本总结
- [package.json](./package.json) - 构建配置

---

## 💡 快速参考

### 转换命令
```bash
# 运行转换脚本
node convert-icon.cjs

# 或手动转换（需要 ImageMagick）
magick convert build/icon.svg -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

### 验证命令
```bash
# 检查文件
dir build\*.ico

# 测试应用
npm run desktop

# 打包测试
npm run build:electron
```

### 在线转换
- https://www.icoconverter.com/
- https://convertio.co/zh/svg-ico/
- https://cloudconvert.com/svg-to-ico

---

**图标**: 齿轮（Cogwheel）  
**状态**: ⚠️ 待转换为 ICO 格式  
**优先级**: 🔴 高

