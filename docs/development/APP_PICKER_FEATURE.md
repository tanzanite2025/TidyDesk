# 智能应用选择器功能

## 功能概述
在抽屉卡片上添加"+"按钮，点击后弹出智能应用选择器，自动扫描系统已安装的应用程序，提供搜索和分类功能，一键添加到抽屉。

## 用户痛点
- ❌ 需要去开始菜单或各种文件夹翻找应用快捷方式
- ❌ 不知道应用的 .exe 文件在哪里
- ❌ 手动拖拽繁琐，效率低

## 解决方案
- ✅ 自动扫描系统已安装的应用
- ✅ 智能分类（浏览器、开发工具、办公软件等）
- ✅ 实时搜索过滤
- ✅ 显示应用图标和路径
- ✅ 一键添加到抽屉

## 功能特性

### 1. 智能扫描
**扫描位置**:
- 开始菜单快捷方式
  - `C:\ProgramData\Microsoft\Windows\Start Menu\Programs`
  - `C:\Users\{用户}\AppData\Roaming\Microsoft\Windows\Start Menu\Programs`
- 桌面快捷方式
  - `C:\Users\{用户}\Desktop`

**扫描逻辑**:
- 递归扫描目录（最大深度 3 层）
- 只包含 .lnk 快捷方式
- 目标必须是 .exe 文件
- 自动去重（相同目标路径）
- 过滤卸载程序和安装程序

### 2. 智能分类
**分类系统**:
- 🌐 **浏览器**: Chrome, Firefox, Edge 等
- 💻 **开发工具**: VS Code, Visual Studio, Git 等
- 📄 **办公软件**: Word, Excel, PowerPoint, WPS 等
- 💬 **通讯工具**: 微信, QQ, 钉钉, Teams 等
- 🎬 **媒体工具**: 播放器, 音乐, 视频, Photoshop 等
- 📦 **其他**: 未分类的应用

**分类规则**:
- 基于应用名称关键词匹配
- 基于安装路径识别
- 中英文关键词支持

### 3. 搜索功能
- 实时搜索过滤
- 支持应用名称搜索
- 支持路径搜索
- 不区分大小写

### 4. 用户界面
**布局**:
- 模态对话框，居中显示
- 600px 宽度，最大 80vh 高度
- 半透明背景，毛玻璃效果

**组件**:
- 头部：标题 + 目标抽屉名称 + 关闭按钮
- 搜索栏：实时搜索输入框
- 分类标签：快速筛选分类
- 应用列表：网格布局，显示图标、名称、路径、分类
- 底部统计：显示找到的应用数量

**交互**:
- 点击应用卡片 → 添加到抽屉
- 点击分类标签 → 筛选应用
- 输入搜索词 → 实时过滤
- 点击关闭按钮 → 关闭选择器

## 技术实现

### 后端实现

#### 1. 扫描函数: `scanInstalledApps()`
```javascript
async function scanInstalledApps() {
  const apps = [];
  const seenPaths = new Set();
  
  // 扫描开始菜单
  // 扫描桌面
  // 去重和排序
  
  return apps;
}
```

**返回数据结构**:
```javascript
{
  name: "Google Chrome",
  shortcutPath: "C:\\ProgramData\\...\\Chrome.lnk",
  targetPath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  icon: "data:image/png;base64,...",
  category: "browser"
}
```

#### 2. 递归扫描: `scanDirectoryForApps()`
```javascript
async function scanDirectoryForApps(dirPath, apps, seenPaths, recursive, depth) {
  // 限制递归深度
  // 读取目录内容
  // 处理快捷方式
  // 验证目标文件
  // 获取应用图标
  // 添加到列表
}
```

#### 3. 分类函数: `categorizeApp()`
```javascript
function categorizeApp(name, targetPath) {
  // 基于名称和路径的关键词匹配
  // 返回分类标签
}
```

#### 4. IPC 处理器
```javascript
// 扫描已安装的应用
ipcMain.handle('scan-installed-apps', async () => {
  const apps = await scanInstalledApps();
  return { success: true, apps };
});

// 添加应用到抽屉
ipcMain.handle('add-app-to-drawer', async (_event, { shortcutPath, targetFolder }) => {
  // 复制快捷方式到抽屉
  return { success: true, path: destPath };
});
```

### 前端实现

#### 1. AppPicker 组件
**Props**:
```typescript
interface AppPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectApp: (app: InstalledApp) => void;
  targetFolder: string;
}
```

**状态**:
```typescript
const [apps, setApps] = useState<InstalledApp[]>([]);
const [filteredApps, setFilteredApps] = useState<InstalledApp[]>([]);
const [searchQuery, setSearchQuery] = useState('');
const [isLoading, setIsLoading] = useState(false);
const [selectedCategory, setSelectedCategory] = useState<string>('all');
```

**生命周期**:
1. `isOpen` 变化 → 加载应用列表
2. `searchQuery` 或 `selectedCategory` 变化 → 过滤应用
3. 点击应用 → 调用 `onSelectApp` 回调

#### 2. App.tsx 集成
**状态**:
```typescript
const [showAppPicker, setShowAppPicker] = useState(false);
const [appPickerTargetFolder, setAppPickerTargetFolder] = useState<string>('');
```

**函数**:
```typescript
function openAppPicker(folderName: string) {
  setAppPickerTargetFolder(folderName);
  setShowAppPicker(true);
}

async function handleSelectApp(app: any) {
  // 调用 API 添加应用
  // 刷新文件列表
  // 显示成功通知
}
```

**UI 集成**:
- 抽屉卡片头部添加"+"按钮
- 点击按钮 → 打开应用选择器
- 选择应用 → 添加到抽屉

## 用户体验流程

### 添加应用流程
```
1. 用户点击抽屉卡片上的"+"按钮
   ↓
2. 弹出应用选择器对话框
   ↓
3. 后台扫描系统已安装的应用（首次加载）
   ↓
4. 显示应用列表（带图标、名称、路径）
   ↓
5. 用户可以：
   - 搜索应用名称
   - 点击分类标签筛选
   - 浏览应用列表
   ↓
6. 用户点击应用卡片
   ↓
7. 应用快捷方式复制到抽屉
   ↓
8. 关闭选择器，刷新抽屉
   ↓
9. 显示成功通知
```

### 搜索流程
```
1. 用户在搜索框输入关键词
   ↓
2. 实时过滤应用列表
   ↓
3. 显示匹配的应用
   ↓
4. 显示匹配数量统计
```

### 分类筛选流程
```
1. 用户点击分类标签（如"浏览器"）
   ↓
2. 过滤显示该分类的应用
   ↓
3. 标签高亮显示当前选中状态
   ↓
4. 显示该分类的应用数量
```

## 性能优化

### 扫描性能
- 限制递归深度（最大 3 层）
- 跳过无用目录（Accessories, Administrative Tools 等）
- 异步扫描，不阻塞 UI
- 使用 Set 去重，避免重复处理

### 图标加载
- 使用 `app.getFileIcon()` 获取系统图标
- 转换为 Base64 Data URL
- 失败时显示默认图标
- 不阻塞应用列表显示

### 搜索性能
- 客户端过滤，无需请求后端
- 使用 `toLowerCase()` 不区分大小写
- 实时响应，无延迟

## 安全性

### 路径验证
- 只扫描系统标准目录
- 验证快捷方式目标存在
- 过滤卸载程序和安装程序

### 权限控制
- 只读取快捷方式信息
- 不修改系统文件
- 复制快捷方式到抽屉（不移动）

## 测试场景

### 功能测试
1. ✅ 点击"+"按钮 → 打开应用选择器
2. ✅ 扫描应用 → 显示应用列表
3. ✅ 搜索应用 → 实时过滤
4. ✅ 点击分类 → 筛选应用
5. ✅ 点击应用 → 添加到抽屉
6. ✅ 关闭选择器 → 返回抽屉

### 边界测试
1. ✅ 没有已安装应用 → 显示空状态
2. ✅ 搜索无结果 → 显示"未找到"
3. ✅ 图标加载失败 → 显示默认图标
4. ✅ 快捷方式目标不存在 → 跳过该应用
5. ✅ 重复添加应用 → 自动重命名

### 性能测试
1. ✅ 扫描 100+ 应用 → 3 秒内完成
2. ✅ 搜索过滤 → 实时响应
3. ✅ 分类切换 → 即时显示
4. ✅ 图标加载 → 不阻塞列表

## 用户指南

### 如何使用
1. **打开应用选择器**: 点击抽屉卡片右上角的"+"按钮
2. **浏览应用**: 滚动查看所有已安装的应用
3. **搜索应用**: 在搜索框输入应用名称
4. **筛选分类**: 点击分类标签（浏览器、开发工具等）
5. **添加应用**: 点击应用卡片，自动添加到抽屉

### 注意事项
- ⚠️ 首次打开需要扫描系统，可能需要几秒钟
- ⚠️ 只显示开始菜单和桌面的快捷方式
- ⚠️ 不包含 Windows 应用商店应用（UWP）
- ⚠️ 添加的是快捷方式副本，不影响原快捷方式

### 常见问题

**Q: 为什么找不到某个应用？**
A: 应用选择器只扫描开始菜单和桌面的快捷方式。如果应用没有创建快捷方式，需要手动拖拽 .exe 文件到抽屉。

**Q: 可以添加 Windows 应用商店的应用吗？**
A: 目前不支持 UWP 应用，只支持传统的 .exe 应用程序。

**Q: 添加应用后可以删除原快捷方式吗？**
A: 可以。添加的是快捷方式副本，删除原快捷方式不影响抽屉中的应用。

**Q: 扫描需要多长时间？**
A: 通常 2-5 秒，取决于系统中安装的应用数量。

## 未来改进

### v3.2.0 计划
1. **缓存机制**: 缓存扫描结果，加快后续打开速度
2. **增量更新**: 只扫描新安装的应用
3. **自定义分类**: 允许用户自定义分类规则
4. **批量添加**: 支持一次选择多个应用

### v3.3.0 计划
1. **UWP 应用支持**: 支持 Windows 应用商店应用
2. **应用推荐**: 基于使用频率推荐常用应用
3. **快捷键支持**: 键盘导航和快捷键
4. **应用详情**: 显示应用版本、大小、安装日期等

## 修改的文件

### 后端
- `electron/main.cjs`
  - 新增 `scanInstalledApps()` - 扫描已安装应用
  - 新增 `scanDirectoryForApps()` - 递归扫描目录
  - 新增 `categorizeApp()` - 应用分类
  - 新增 `scan-installed-apps` IPC 处理器
  - 新增 `add-app-to-drawer` IPC 处理器

### 前端
- `electron/preload.cjs`
  - 新增 `scanInstalledApps` API
  - 新增 `addAppToDrawer` API

- `src/components/AppPicker.tsx`
  - 新建应用选择器组件
  - 实现搜索和分类功能
  - 实现应用列表显示

- `src/App.tsx`
  - 导入 `AppPicker` 组件
  - 导入 `Plus` 图标
  - 新增 `showAppPicker` 状态
  - 新增 `appPickerTargetFolder` 状态
  - 新增 `openAppPicker()` 函数
  - 新增 `handleSelectApp()` 函数
  - 在抽屉卡片添加"+"按钮
  - 渲染 `AppPicker` 组件

## 发布信息
- **版本号**: v3.1.0
- **功能类型**: 新功能
- **优先级**: 高
- **用户价值**: 极大提升添加应用的便利性

## 相关文档
- `FILE_MANAGEMENT_UPGRADE.md` - 文件管理升级
- `v3.1.0_UPGRADE_SUMMARY.md` - v3.1.0 升级总结
