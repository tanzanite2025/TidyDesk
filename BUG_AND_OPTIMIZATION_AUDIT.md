# TidyDesk 潜在 BUG 与优化方向排查

> 状态：只读排查文档，尚未实施修复。
> 范围：当前 `main` 代码、README、`SECURITY_AND_STRUCTURE_AUDIT.md`、Tauri/Rust 主进程、React 前端、Go sidecar。
> 说明：PR #4-#9 已处理的测试 IPC 暴露、updater override、App Picker PoC 命名、职责拆分和 README 过期内容，本次不重复列为待修复项。

## 总体结论

当前项目职责边界已经比早期清晰：前端模块、Tauri IPC、Rust domain logic、Go sidecar 基本分层明确。当前更值得优先关注的是数据持久化可靠性、桌面文件移动/删除语义、截图/应用扫描性能、以及部分 UI 状态同步边界。

建议优先级：

1. **先修数据安全类问题**：避免 JSON 损坏后被静默清空、避免直接 `fs::write` 导致半写入、明确“删除快捷入口”是否会处理 storage 原文件。
2. **再修高频交互 BUG**：Todo 自动保存、快捷记录自动读取剪贴板、桌面文件导入提示与实际行为不一致。
3. **最后做性能/维护性优化**：App Picker 缓存真正接入、快捷方式 watcher 从轮询改事件/节流、截图/base64 内存优化、分类规则去重。

## 严重级别定义

- **高**：可能导致用户数据丢失、误删、不可恢复、或和用户预期明显相反。
- **中**：常见路径中可能出现失败、卡顿、误导或状态不同步。
- **低**：维护成本、边界兼容性或体验细节问题。

## 1. 数据持久化：损坏 JSON 会被静默重置

**级别：高**

### 位置

- `src-tauri/src/todos_rules.rs:97-115`
- `src-tauri/src/quick_notes.rs:162-189`

### 现象

Todo index 读取失败或 JSON 解析失败时，会退回默认结构并立即写回；Quick Notes 解析失败时也会退回空列表并写回。

风险是：如果 `boards.json` 或 `quick-notes.json` 因半写入、磁盘异常、手动编辑错误而损坏，应用启动或读取时可能直接覆盖原文件，造成用户看起来“待办/快捷记录被清空”。

### 建议

- 读取失败时不要直接写默认文件。
- 将损坏文件重命名为 `.corrupt-<timestamp>.json`，再创建新默认文件。
- UI 显示“检测到数据文件损坏，已备份，可尝试恢复”。
- 对 Todo card markdown 内容缺失也建议区别“文件不存在”和“读取失败”，避免把读取失败误认为空内容。

## 2. 数据持久化：多处直接写文件，缺少原子写

**级别：高**

### 位置

- `src-tauri/src/todos_rules.rs:108-115`
- `src-tauri/src/todos_rules.rs:350-358`
- `src-tauri/src/quick_notes.rs:181-190`
- `src-tauri/src/stickers_rules.rs:197-205`

### 现象

Todo、Quick Notes、Sticker state 都使用 `fs::write` 直接覆盖目标文件。崩溃、断电、杀进程、杀毒软件锁文件时，可能留下空文件或半截 JSON。

### 建议

- 统一封装 `atomic_write_json(path, value)` / `atomic_write_text(path, content)`：
  1. 写入同目录临时文件。
  2. flush + sync。
  3. 原子 rename 替换目标文件。
- 关键用户数据保留最近 N 个 `.bak` 快照。
- 将 Todo、Quick Notes、Sticker state 的写入全部收敛到该工具函数。

## 3. 桌面文件导入提示与实际行为不一致

**级别：高**

### 位置

- `src/modules/drawer/useDrawerOperations.ts:168-192`
- `src-tauri/src/files_rules/storage.rs:31-91`

### 现象

前端拖入文件后提示：

> 已加入抽屉。这里只创建快捷入口，原桌面文件没有移动。

但 Rust 后端对来自桌面的非 `.lnk/.url` 文件执行的是 `fs::rename(source_path, storage_path)`，即从桌面移动到 TidyDesk storage，再创建快捷方式。

这会造成用户误解：用户以为原桌面文件还在原地，实际已经被移入应用数据目录。

### 建议

- 如果当前设计就是“桌面文件收纳到 storage”，更新 UI 文案：
  - “已收纳到 TidyDesk storage，并在抽屉中创建快捷入口。”
- 如果产品目标是“只创建快捷入口，不移动原文件”，则后端应改为 copy/link 策略，并重新设计 restore/delete 行为。
- 文档中明确区分：
  - 外部非桌面文件：复制到 storage。
  - 桌面普通文件：移动到 storage。
  - `.lnk/.url`：复制快捷方式，桌面来源会移除原快捷方式。

## 4. 删除抽屉快捷入口可能留下不可见 storage 原文件

**级别：高**

### 位置

- `src-tauri/src/files.rs:311-344`
- `src-tauri/src/files.rs:423-485`
- `src/modules/drawer/FileTile.tsx:104-127`

### 现象

普通桌面文件被收纳后，真实文件移动到 `app_data_dir()/storage/...`，抽屉中只有 `.lnk`。如果用户点击删除，后端只删除抽屉 entry；不会判断 `.lnk` target 是否位于 TidyDesk storage，也不会删除或回收 storage 中的原文件。

结果可能是：

- UI 中入口消失。
- 原文件仍留在 storage。
- 用户很难再从 UI 找回或清理，形成“隐藏孤儿文件”。

### 建议

- 删除前识别 `.lnk` target 是否在 TidyDesk storage。
- 提供三种语义之一：
  1. “仅删除快捷入口”并保留可恢复列表。
  2. “删除入口并移到回收站/Trash”。
  3. “还原到桌面后删除快捷入口”。
- 至少增加 storage orphan 扫描/恢复/清理工具。

## 5. Todo 自动保存存在快速切换丢编辑风险

**级别：中**

### 位置

- `src/modules/todos/TodoPanel.tsx:103-112`
- `src/context/TodoContext.tsx:158-166`

### 现象

Todo 编辑器使用 700ms debounce 自动保存。用户输入后如果很快切换卡片，effect cleanup 会取消当前 timer；同时保存触发后没有 `await`，立即 `setIsDirty(false)`，如果 IPC 保存失败，UI 也可能已经认为不再 dirty。

### 建议

- 切换卡片、关闭窗口、失焦前先 flush 当前 draft。
- debounce 回调中 `await updateCard(...)`，失败时保留 dirty 状态并提示重试。
- 给每个 selected card 维护独立 draft 或保存队列，避免快速切换互相覆盖。
- 增加 E2E：输入内容后 700ms 内切换卡片，验证内容不丢。

## 6. Quick Notes 自动读取剪贴板可能覆盖草稿且有隐私/体验风险

**级别：中**

### 位置

- `src/modules/notes/useQuickNotes.ts:74-90`
- `src/modules/notes/useQuickNotes.ts:101-112`
- `src-tauri/src/commands/windows.rs:107-121`

### 现象

快捷记录面板加载时会读取系统剪贴板，并自动把文本放入新建草稿；打开 capture 也会把 clipboard text 作为事件 payload 发送给 `capture` 和 `main`。

风险：

- 用户只是打开快捷记录查看历史，草稿被剪贴板内容替换。
- 如果用户已有未保存草稿，可能被剪贴板导入覆盖。
- 剪贴板可能包含敏感内容，自动读取/展示会造成体验和隐私争议。

### 建议

- 默认不自动读取剪贴板，只在用户点击“剪贴板”按钮时导入。
- 如果保留自动导入，需要满足：
  - 当前没有 dirty draft。
  - 剪贴板内容未在本次 session 导入过。
  - UI 明确显示“从剪贴板带入，可清除”。
- `capture-opened` 事件只发送给真正需要的窗口，并考虑只发送“有文本”状态，不直接带内容。

## 7. App Picker 缓存接口未真正使用缓存，且可能重复全量扫描

**级别：中**

### 位置

- `src/AppPickerApp.tsx:31-86`
- `src/native/tauri-adapter.ts:181-208`
- `sidecars/apps-cache/cache.go:41-80`
- `sidecars/apps-cache/rpc.go:21-38`

### 现象

Go sidecar 已实现 `apps.cacheInfo` / `apps.readCache`，但 Tauri adapter 的 `getCacheInfo` 实际调用的是 `apps_scan_installed`，也就是再次扫描。

影响：

- 打开 App Picker 时可能先 scan，再为了 cacheInfo 又 scan。
- UI 的 cache 状态并非真实缓存状态。
- `cache.go` 目前更像死代码，维护成本上升。

### 建议

- Rust 增加 `apps_cache_info` / `apps_read_cache` 命令，直接走 sidecar cache RPC。
- `scanInstalled` 优先读 valid cache；用户点击刷新时才强制 scan。
- 扫描完成后写入 cache，否则移除 sidecar cache API，避免误导。
- App Picker UI 区分“缓存读取”和“正在扫描”。

## 8. 快捷方式 watcher 采用固定轮询，抽屉多时可能产生持续 IO

**级别：中**

### 位置

- `src-tauri/src/shortcuts.rs:12-13`
- `src-tauri/src/shortcuts.rs:268-328`
- `src-tauri/src/shortcuts.rs:365-400`

### 现象

后台线程每 10 秒扫描所有 drawer shortcut，并解析 target 是否存在；每 30 分钟做全量验证和自动修复。抽屉/快捷方式较多时，会持续产生文件系统 IO 和 COM shortcut 解析开销。

### 建议

- 优先改成事件驱动：监听 drawer root 和 storage root 的变化。
- 轮询作为 fallback，并增加退避策略。
- 仅对上次异常/变化过的 shortcut 做增量检查。
- UI 手动“验证所有快捷方式”保留全量检查。

## 9. 截图和贴纸图片通过 base64 data URL 传输，内存占用偏高

**级别：中**

### 位置

- `src-tauri/src/stickers.rs:51-70`
- `src-tauri/src/stickers.rs:99-109`
- `src-tauri/src/stickers.rs:167-172`
- `src-tauri/src/stickers_rules.rs:457-488`

### 现象

截图流程会：

1. 截取整块 monitor。
2. 在内存中保存 PNG。
3. 转 base64 data URL 传给前端。
4. Sticker 窗口再次读取图片文件并转 base64。

大屏幕、多显示器、高 DPI 下，内存峰值会显著放大。

### 建议

- 背景图和 sticker 图改为文件 URL / Tauri asset protocol，而不是 data URL。
- 对 snip 选择区域设最大尺寸或缩放预览图。
- 完成选择、取消、窗口关闭时确保清理 frozen background。
- 对超大截图增加错误提示，例如超过阈值时建议缩小选择区域。

## 10. 抽屉刷新会顺序枚举并提取图标，文件多时 UI 可能卡顿

**级别：中**

### 位置

- `src-tauri/src/files.rs:105-149`
- `src-tauri/src/files.rs:181-240`
- `src-tauri/src/icons.rs:31-48`

### 现象

`files_read_desktop_files` 顺序读取 desktop/drawer entries，并对每个文件/shortcut target 进行 metadata、shortcut resolve、icon extraction。图标提取走 Win32 API，文件多或网络路径/慢磁盘时可能拖慢刷新。

### 建议

- 列表扫描和 icon 加载分两阶段：
  - 首屏先返回 name/path/category。
  - 图标异步批量加载并缓存。
- 缓存 icon：key 可用 target path + modified time。
- 对异常/慢路径设置单项超时，避免一个文件拖慢整个列表。

## 11. Shortcut COM 初始化方式在复杂线程环境下可能不稳

**级别：低-中**

### 位置

- `src-tauri/src/files_rules/windows_shortcuts.rs:33-45`
- `src-tauri/src/files_rules/windows_shortcuts.rs:112-120`

### 现象

创建/解析 shortcut 每次调用 `CoInitializeEx(..., COINIT_APARTMENTTHREADED)`，结束后固定 `CoUninitialize()`。如果当前线程已经用不同 apartment 初始化过 COM，`CoInitializeEx` 可能失败；如果初始化状态复杂，固定 uninitialize 也容易产生边界问题。

### 建议

- 封装 COM guard，区分 `S_OK`、`S_FALSE`、`RPC_E_CHANGED_MODE`。
- 只在本次调用确实初始化成功时执行 `CoUninitialize()`。
- 或将 shortcut 操作集中到专用 STA worker thread。

## 12. Go 与 Rust 的应用分类规则重复，后续容易漂移

**级别：低**

### 位置

- `sidecars/apps-cache/classify.go:5-57`
- `src-tauri/src/apps_classifier.rs:194-251`

### 现象

shortcut skip/category 规则在 Go sidecar 和 Rust 主进程各维护一份。现在内容相近，但后续新增规则时容易只改一边，导致 metadata category 与最终 installed app category 不一致。

### 建议

- 选择单一权威分类位置：
  - sidecar 输出最终 category，Rust 不再二次分类；或
  - sidecar 只输出原始 metadata，Rust 统一分类。
- 若必须双端存在，抽出共享 JSON 规则文件并加测试验证两边一致。

## 13. Updater 安装成功后状态没有显式 success/重启引导

**级别：低**

### 位置

- `src-tauri/src/updates.rs:609-671`
- `src/services/updates/use-update-manager.ts:74-124`

### 现象

`updates_install` 调用成功后返回的仍是 installing snapshot，没有明确的 success/needs-restart 状态。对于用户来说，安装后下一步是等待、重启还是已完成可能不够清晰。

### 建议

- 安装成功后写入并 emit `success` 或 `ready-to-restart` snapshot。
- UI 明确展示“更新已安装，重启后生效”。
- 增加失败重试按钮与 release notes 保留。

## 14. 非 Windows fallback 文案仍残留 PoC 表述

**级别：低**

### 位置

- `src-tauri/src/files_rules/shell_open.rs:13-16`
- `src-tauri/src/files_rules/windows_shortcuts.rs:27-30`
- `src-tauri/src/files_rules/windows_shortcuts.rs:102-109`

### 现象

非 Windows fallback 文案仍写着 “in this PoC”。虽然当前产品主要面向 Windows，但 README 已将 App Picker PoC 等历史命名正式化，错误文案也应保持一致。

### 建议

- 改为 “only implemented on Windows”。
- 若计划跨平台，补充 macOS/Linux 打开文件和 shortcut/bookmark 的实现方案。

## 15. `main.rs` 末尾仍有顶层 `expect`

**级别：低**

### 位置

- `src-tauri/src/main.rs:220`

### 现象

`run(...).expect("failed to run TidyDesk")` 在 Tauri 启动失败时会 panic。桌面应用入口常见写法可以接受，但如果想改善错误可观测性，可在入口层记录更明确的错误信息。

### 建议

- 短期可保持不动。
- 后续若引入日志文件，可改为记录启动失败原因并退出。

## 推荐修复顺序

### 第一批：数据安全

1. 为 Todo / Quick Notes / Sticker state 增加 atomic write。
2. JSON 解析失败时备份损坏文件，不静默覆盖。
3. 明确 drawer delete 对 managed storage 文件的行为，并增加 orphan 恢复/清理。

### 第二批：交互一致性

1. 修正拖拽导入后的提示文案，或调整后端行为到“只创建快捷入口”。
2. Todo 自动保存改为可 flush、可重试、不丢 dirty。
3. Quick Notes 剪贴板导入改为显式触发或加 dirty guard。

### 第三批：性能

1. App Picker 接入真实 cache，避免打开窗口重复扫描。
2. Shortcut watcher 改事件驱动或增量扫描。
3. 抽屉 icon 异步缓存。
4. 截图/贴纸图片避免 base64 大对象传输。

### 第四批：维护性

1. 应用分类规则单一来源。
2. Shortcut COM guard / 专用 STA worker。
3. Updater 安装状态补 success/restart。
4. 清理非 Windows fallback 的 PoC 文案。

## 建议新增测试

- Todo：输入后 700ms 内切换卡片，不应丢内容。
- Todo/Quick Notes：损坏 JSON 时应备份并提示，不应静默清空。
- Drawer：桌面文件导入后，UI 文案和真实文件位置一致。
- Drawer：删除 managed shortcut 后 storage 文件处理符合产品语义。
- App Picker：打开 picker 不应触发重复全量扫描；刷新才强制扫描。
- Sticker：大截图完成/取消后内存状态被释放。
- Shortcut watcher：大量 shortcut 下轮询不会阻塞 UI。
