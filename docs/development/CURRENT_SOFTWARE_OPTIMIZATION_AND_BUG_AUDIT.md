# 当前软件可优化空间与深度 BUG 审计

## 范围

本轮审计基于当前 `main`，重点查看：

- Rust/Tauri 后端：抽屉文件、快捷方式体检、应用扫描、截图贴纸、驻留/托盘、自动更新、窗口生命周期。
- React 前端：抽屉、Todo、Quick Notes、截图 overlay、设置页、更新状态管理。
- 发布与测试：README、release workflow、e2e-tests、已有开发文档。

本文不是修复 PR，而是下一阶段升级规划。下面列出的“风险”分三类：

- **确定缺口**：代码路径明确存在体验或健壮性问题。
- **高概率风险**：静态审计能看到问题边界，但需要桌面端复现确认。
- **升级空间**：不是 BUG，但会明显影响可维护性、可测试性或长期扩展。

## 总体结论

TidyDesk 目前已经从早期“功能堆叠”进入可持续维护阶段：Go sidecar 已删除，扫描/cache/分类迁入 Rust；数据写入已经部分原子化；驻留、后台 watcher、自动更新和截图贴纸主链路都有了基础闭环。

下一阶段最值得做的不是再补单点功能，而是把“可恢复、可诊断、可取消、可回滚”的工程能力补齐。否则随着抽屉数量、贴纸数量、快捷键数量、更新链路和数据文件增多，用户遇到问题时仍然会出现“看起来没反应 / 成功但实际没完成 / 只能看日志”的体验。

推荐优先级：

1. **P0：用户数据与操作闭环**
   - 导入/整理/还原需要返回逐项结果，而不是静默跳过。
   - resident/update 等剩余设置文件也要损坏备份恢复。
   - 关键删除/还原/更新流程需要应用内确认弹窗和可恢复说明。
2. **P1：卡顿与后台资源**
   - 抽屉扫描、图标提取、截图全屏冻结、贴纸拖动持久化都需要继续异步化/节流。
   - 所有长耗时操作都要有进度、取消和错误明细。
3. **P2：架构和测试**
   - 新增 `hotkeys.rs`、`diagnostics.rs`、`storage_health.rs` 等小模块，避免逻辑继续堆到大文件里。
   - 补 e2e 覆盖真实桌面核心路径，而不是只保留测试依赖。

## 快速风险总表

| 优先级 | 模块 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| P0 | 抽屉导入 | `files_import_external_files` 对不存在、受保护、已在 drawer 内的路径直接 `continue` | 用户看到“成功”，但部分文件没导入且没有原因 | 返回 `added / skipped / failed` 明细 |
| P0 | 整理/还原 | 批量整理、还原缺少事务语义 | 中途失败后 UI 和磁盘可能处于半完成状态 | 引入操作日志和逐项 rollback/恢复提示 |
| P0 | Resident 设置 | `resident.json` 解析失败时 `unwrap_or_default`，不会备份损坏文件 | 用户设置突然恢复默认，原因不可见 | 按 Todo/Quick Notes 模式备份 `.corrupt-*` |
| P0 | 快捷键 | 贴图快捷键仍固定注册，冲突只写日志 | 被其他软件占用时用户不知道为什么不能贴图 | 落地快捷键设置弹窗和冲突检测 |
| P1 | 抽屉读取 | `files_read_desktop_files` 同步枚举并同步提取图标 | 文件多时打开抽屉卡顿 | 先返回列表，图标渐进更新 |
| P1 | 贴纸窗口 | 贴纸移动/缩放每个事件都写 `stickers.json` | 拖动时高频 IO，贴纸多时卡顿 | 300-500ms debounce + close/blur flush |
| P1 | 截图 | 打开截图前同步整屏截图并 PNG 编码 | 4K/多屏时启动截图遮罩慢 | 先显示 overlay，再后台加载 frozen background |
| P1 | 窗口动画 | `animate_window_bounds` 每次开关抽屉都 spawn thread | 快速点击时线程和主线程调度噪声 | 合并到单个动画调度器 |
| P1 | 自动更新 | debug 环境禁用自动检查；用户看不到发布端到端诊断 | “更新不可用”时定位困难 | 设置页增加 updater 诊断卡片 |
| P2 | 测试 | e2e 依赖存在，但没有核心 spec | 回归只能靠人工 | 补桌面 smoke tests |
| P2 | UI | 多处 `confirm/alert` 系统弹窗 | 视觉割裂，且难测试 | 统一应用内 Modal/Toast |
| P2 | 文档 | README 描述能力，但缺少“故障诊断/数据目录/恢复方式” | 用户遇到问题难自救 | 增加 Troubleshooting 和数据恢复文档 |

## 已处理进展（2026-06）

本审计中的一批高优先级问题已拆分小 PR 处理，后续继续审计时应避免重复排查这些已闭环路径：

| PR | 范围 | 结果 |
| --- | --- | --- |
| #23 | 抽屉导入结果 | 导入返回 `added / skipped / failed` 明细，前端展示成功、跳过、失败原因 |
| #24 | Resident / update 设置容灾 | 设置 JSON 解析失败时备份 `.corrupt-*` 并恢复默认 |
| #25 | 快捷键 Phase 1 | “贴出最近截图”快捷键可配置，保存失败可回滚并展示冲突状态 |
| #26 | Tauri 图标 | 提交内置白色占位 `.ico`，修复 `build/icon.ico` 缺失导致的构建阻塞 |
| #27 | 截图贴纸恢复 | 截图失败路径执行窗口恢复；贴图失败时保留 pending 截图 |
| #28 / #36 / #37 | 抽屉文件移动 | 收纳/还原/重命名使用 copy+verify fallback，并清理失败时的空 storage 目录 |
| #29 | Todo 规范化 | 移除 `String::leak()` 写法；清理 drawer 窗口重复配置 |
| #30 | 文档入口 | 修复 README/docs 断链与过期入口 |
| #31 | 性能热点 | 贴纸移动/缩放写入 debounce；截图 overlay pointer 更新 RAF 节流 |
| #32 | 冗余代码 | 删除未使用的旧 `AppPicker` 组件 |
| #33 | 贴纸关闭 | 贴纸关闭改为 staging + 状态写入失败恢复，避免状态/文件/窗口不一致 |
| #34 / #35 | 依赖与质量门禁 | 移除未直接使用的 `chokidar` 依赖；新增 Rust fmt 检查脚本并接入 `npm run check` |
| #38 | Resident 设置读取 | 设置页读取/更新时传播读取错误，避免静默默认化后覆盖用户设置 |
| #39 / #40 / #41 / #42 | Todo 内容一致性 | 内容读取错误不再静默变空；创建、更新、删除内容文件均补回滚/清理 |

## 详细问题与升级建议

### 1. 抽屉导入静默跳过，数据闭环不完整

**位置**

- `src-tauri/src/files.rs:426-479`
- `src/context/WorkspaceContext.tsx:242-255`
- `src/context/WorkspaceContext.tsx:295-315`

**现状**

导入逻辑会直接跳过多种情况：

- 文件不存在。
- 文件已在 drawer root 内。
- 是受保护桌面项目。
- 创建 shortcut 前的某些校验失败。

后端返回值只有：

```json
{
  "success": true,
  "added": [...]
}
```

普通拖拽导入没有检查 `added.length`；智能整理虽然会统计 `addedCount < batch.length`，但不能告诉用户哪些文件失败、为什么失败。

**风险**

用户执行“拖入/智能整理”后，UI 刷新了，但部分文件没有进入抽屉；用户只能自己猜是权限、路径长度、受保护项还是文件已经不存在。

**建议**

把导入返回结构升级为：

```ts
type ImportExternalFilesResult = {
  success: boolean;
  added: ImportedFileResult[];
  skipped: Array<{ source: string; reason: 'alreadyInDrawer' | 'protected' | 'missing' }>;
  failed: Array<{ source: string; error: string }>;
};
```

前端：

- 普通拖拽：如果 `skipped/failed` 非空，显示“导入完成：成功 N，跳过 M，失败 K”，可展开明细。
- 智能整理：把失败原因合并到结果面板，不只显示数量。

### 2. 抽屉读取仍是同步大任务，文件多时会卡顿

**位置**

- `src-tauri/src/files.rs:161-307`
- `src/context/WorkspaceContext.tsx:84-106`

**现状**

读取抽屉时会一次性做：

1. 枚举桌面文件。
2. 枚举所有 drawer。
3. 对每个 `.lnk` 解析 target。
4. 对每个文件/target 提取 icon data URL。
5. 一次性返回完整数组。

App Picker 已经做了“先列表、后 icon 渐进补齐”，但抽屉主列表还没有同样处理。

**风险**

抽屉文件多、快捷方式多、网络盘/失效快捷方式多时，打开抽屉可能明显卡顿。由于这是用户每天最高频入口，比 App Picker 更敏感。

**建议**

拆成两步：

```text
files_read_desktop_files()
  -> 返回文件/抽屉/shortcut validity 的轻量列表，icon = null

files_icon_batch(paths[])
  -> 后台分批 emit files-icons-updated
```

同时为 `.lnk target resolve` 增加短期 cache：`shortcut path + modified time -> target/is_valid`。

### 3. 文件还原跨盘失败时没有 fallback

**位置**

- `src-tauri/src/files.rs:481-544`

**现状**

`files_restore_to_desktop` 使用：

```rust
fs::rename(&target_path, &destination)
```

如果 TidyDesk storage 和桌面不在同一卷、或被安全软件/同步软件临时锁定，`rename` 可能失败。当前失败后 shortcut 仍在 drawer，target 仍在 storage，但用户只会看到“还原失败”。

**建议**

实现安全 fallback：

```text
try rename
  ok -> remove shortcut
  fail with cross-device/permission-like error:
    copy target -> destination.tmp
    fsync
    rename tmp -> destination
    verify size/hash
    remove original
    remove shortcut
```

同时在失败时显示“已保持原状态，未删除抽屉入口”，降低用户焦虑。

### 4. 关键文件仍有“损坏即默认”的隐性重置

**位置**

- `src-tauri/src/resident.rs:69-71`
- `src-tauri/src/resident.rs:224-237`
- `src-tauri/src/updates.rs:193-201`

**现状**

Todo、Quick Notes、Sticker state 已经做了损坏文件备份；但 resident 设置和 updater 自动检查状态还没有完全一致：

- `read_resident_settings()` 对 `load_resident_settings()` 失败直接 `unwrap_or_default()`。
- `read_auto_update_check_state()` 解析失败直接 default。

**风险**

`resident.json` 损坏后，开机启动、启动后隐藏、后台监控、自动更新、截图自动贴等设置会突然回到默认值，且没有备份/提示。

**建议**

- `resident.json` 解析失败：备份 `.corrupt-<timestamp>.json`，写入默认设置。
- `updates.json` 解析失败：备份后重建。
- 设置页显示一次性提示：“检测到设置文件损坏，已备份并恢复默认”。

### 5. 快捷键系统需要独立模块，不能继续写死在贴纸模块

**位置**

- `src-tauri/src/stickers.rs:22-78`
- `docs/development/HOTKEY_SETTINGS_DIALOG_PLAN.md`

**现状**

贴图快捷键固定为 `ctrl+alt+v`，注册失败只 `eprintln!`，前端没有状态。后续如果继续加“开始截图 / 快速记录 / 显示隐藏把手”快捷键，会把全局快捷键逻辑散落到多个 domain 模块。

**建议**

按已写好的快捷键弹窗规划落地：

- 新增 `src-tauri/src/hotkeys.rs`。
- 独立 `hotkeys.json`。
- IPC：`hotkeys_get_settings / hotkeys_validate_binding / hotkeys_update_binding / hotkeys_reset_defaults`。
- 保存时实际注册探测冲突；失败则回滚旧快捷键。

这项建议作为下一阶段首个功能 PR，收益很高。

### 6. 截图启动链路仍可能在高 DPI / 多屏上卡顿

**位置**

- `src-tauri/src/stickers.rs:125-176`
- `src/modules/stickers/SnipOverlayApp.tsx:88-147`

**现状**

打开截图前，后端先对当前 monitor 截整屏并 PNG 编码，再打开 overlay。这样能避免截到 overlay 自己，但会把“截屏 + 编码 + 写 cache”放在用户按下截图后的等待路径里。

**风险**

4K、高 DPI 或多屏环境下，截图遮罩出现慢；用户会以为快捷键没生效。

**建议**

改为两阶段：

1. 立即打开 overlay，先显示半透明遮罩和 loading。
2. 后台 `spawn_blocking` 捕获 frozen background。
3. 完成后 emit `snip-background-ready`，前端替换背景。
4. 如果背景失败，仍允许选择区域并走 live capture fallback。

### 7. Snip overlay 鼠标移动未节流

**位置**

- `src/modules/stickers/SnipOverlayApp.tsx:238-244`

**现状**

`onMouseMove` 每个鼠标事件都 `setCursorPoint/setEndPoint`，快速拖动时 React 可能在一帧内处理多次 state 更新。

**风险**

低配机器或高刷新率鼠标下，框选边框和提示可能掉帧。

**建议**

用 `requestAnimationFrame` 合并鼠标事件：

```ts
pendingPointRef.current = { x, y };
if (!frameRef.current) {
  frameRef.current = requestAnimationFrame(() => {
    setCursorPoint(pendingPointRef.current);
    if (isDragging) setEndPoint(pendingPointRef.current);
  });
}
```

### 8. 贴纸移动/缩放持久化高频写盘

**位置**

- `src-tauri/src/tool_windows/sticker.rs:61-90`

**现状**

每个 `WindowEvent::Moved` / `Resized` 都调用 `persist_sticker_window_bounds()`，里面会 mutate sticker state 并写 JSON。

**风险**

用户拖动贴纸窗口时会产生大量磁盘写入；贴纸多或磁盘慢时，窗口移动可能发涩。

**建议**

- 每个 sticker id 做 300-500ms debounce。
- 移动/缩放中只保存最新 bounds 到内存。
- `CloseRequested`、`Destroyed`、`Focus(false)` 或 debounce 到期时 flush。

### 9. 启动时恢复所有贴纸窗口，贴纸多时首屏压力大

**位置**

- `src-tauri/src/main.rs:270-282`
- `src-tauri/src/stickers.rs:111-122`

**现状**

Tauri setup 时会：

1. 注册快捷键。
2. ensure handle window。
3. restore all stickers。
4. start shortcut watcher。

`restore_stickers` 会同步遍历所有 sticker record 并创建 WebView。

**风险**

如果用户长期使用积累很多贴纸，开机自启时会一次性创建大量窗口，影响登录后的系统响应。

**建议**

- 启动后先恢复 handle/tray。
- 延迟 1-3 秒后分批恢复贴纸，每批 3-5 个。
- 设置中增加“启动时恢复贴纸：立即 / 延迟 / 不自动恢复”。

### 10. 窗口动画每次都新建线程

**位置**

- `src-tauri/src/shell.rs:403-448`

**现状**

抽屉展开/收起时，对 drawer 和 handle 分别 spawn animation thread；每帧再 `run_on_main_thread`。

代码已有 `animation_generation` 防止旧动画继续生效，这是好的。但频繁点击手柄时仍会产生短生命周期线程和主线程调度噪声。

**建议**

后续升级为单一动画调度器：

- `ShellAnimationState` 保存当前目标 bounds。
- 一个后台 loop 或 Tauri async task 负责 tick。
- 新动画只更新 generation/target，不再无限 spawn thread。

### 11. 系统 `confirm/alert` 弹窗破坏体验，也难自动化测试

**位置**

- `src/components/SettingsPanel.tsx:75-78`
- `src/modules/drawer/DrawerApp.tsx`
- `src/modules/stickers/StickerApp.tsx:35-39`
- `src/modules/todos/TodoPanel.tsx`
- `src/modules/drawer/useDrawerOperations.ts`

**现状**

删除抽屉、删除贴纸、安装更新、还原文件等操作依赖浏览器原生 `confirm/alert`。

**风险**

- 和 TidyDesk 自身 UI 风格割裂。
- 难以加“查看详情 / 不再提醒 / 输入名称确认”等高级交互。
- e2e 自动化需要额外处理系统弹窗。

**建议**

新增统一组件：

```text
ConfirmDialog
DangerConfirmDialog
OperationResultDialog
ToastCenter
```

先替换 P0 操作：删除抽屉、删除贴纸、安装更新、还原到桌面。

### 12. 自动更新缺少“发布链路诊断视图”

**位置**

- `src-tauri/src/updates.rs`
- `src/services/updates/use-update-manager.ts`
- `.github/workflows/release.yml`

**现状**

自动更新主链路已经比之前完整：每日自动检查、签名包、release workflow、安装后重启提示。但对普通用户和开发者而言，更新失败时仍需要看日志：

- endpoint 是否 404。
- 当前是否 debug 模式。
- channel 是否 stable/beta。
- 签名 key 是否配置。
- 最新 release 的 `latest.json` 是否版本递增。

**建议**

设置页增加“更新诊断”折叠面板：

```text
当前版本：3.0.1
运行模式：生产/开发
更新通道：stable
Endpoint：GitHub Releases latest.json
最近自动检查：2026-xx-xx
最近错误：...
签名校验：由 Tauri updater 执行
```

对开发模式明确显示“开发模式不会自动检查更新”。

### 13. 应用扫描信任集合只存在内存，窗口刷新后语义不明显

**位置**

- `src-tauri/src/apps.rs:42-96`
- `src-tauri/src/apps.rs:132-143`

**现状**

App Picker 会把最近扫描到的 shortcut path 放入 `TrustedShortcutState`，导入应用时要求 shortcut 来自最近可信扫描。这对安全是好的，但状态只在内存里。

**风险**

如果 App Picker 打开后较久、扫描被刷新、或窗口状态变化，用户可能点击一个看起来还在列表中的应用，但后端拒绝“不是最新 trusted scan”。目前 UI 很难解释。

**建议**

- 给 scan result 加 `scanId`。
- `apps_add_to_drawer` payload 带 `scanId`。
- 后端错误信息改为中文可理解：“应用列表已过期，请刷新后重试”。
- 前端收到该错误时自动刷新 App Picker。

### 14. Shortcut watcher 有低频策略，但缺少用户可见状态

**位置**

- `src-tauri/src/shortcuts.rs`
- `src-tauri/src/resident.rs:100-108`

**现状**

后台 watcher 已支持开关、暂停唤醒、空闲低频轮询。但设置页只显示“后台快捷方式监控”开关，不显示：

- 当前是否 paused/active。
- 正在监控多少 target。
- 最近一次检测时间。
- 最近一次修复/失效事件。

**建议**

新增 `shortcuts_watcher_status()` IPC：

```ts
{
  enabled: boolean;
  watchedTargetCount: number;
  lastScanAt: string | null;
  lastResult: { changed: boolean; invalid: number; repaired: number } | null;
}
```

设置页可显示“后台监控正常 / 空闲低频 / 已暂停”。

### 15. Markdown/Todo 仍缺少冲突解决和版本号

**位置**

- `src-tauri/src/todos_rules.rs`
- `src/modules/todos/TodoPanel.tsx`
- `src/context/TodoContext.tsx`

**现状**

Todo 的保存可靠性已经提升，但卡片内容没有 revision/version。多个窗口、快速操作、未来云同步/导入导出都可能需要冲突检测。

**建议**

- Todo card 增加 `revision` 或 `updatedAt` 乐观锁。
- `updateCard` payload 带 `baseRevision`。
- 后端发现 base 过期时返回 conflict，前端提示“内容已在其他窗口更新”。

### 16. 数据目录缺少健康检查和恢复入口

**位置**

- `src-tauri/src/persistence.rs`
- `src-tauri/src/files.rs`
- `src-tauri/src/todos_rules.rs`
- `src-tauri/src/quick_notes.rs`
- `src-tauri/src/stickers_rules.rs`

**现状**

多处已经能备份 corrupt 文件，但没有统一入口告诉用户：

- 数据目录在哪里。
- 哪些文件最近被备份。
- storage 是否有 orphan 文件。
- sticker 图片是否缺失。
- Todo card markdown 是否有孤儿文件。

**建议**

新增 `diagnostics.rs` 或 `storage_health.rs`：

```text
diagnostics_scan()
  -> dataDir
  -> corruptBackups[]
  -> orphanStorageFiles[]
  -> missingStickerImages[]
  -> orphanTodoCards[]
```

设置页增加“数据健康检查”按钮。

### 17. E2E 测试依赖存在，但核心路径没有 spec

**位置**

- `e2e-tests/package.json`
- `src/native/native-client.ts`

**现状**

项目已经有 WebDriverIO/Tauri driver 依赖，也有 `window.__TIDYDESK_TEST__` bridge，但当前 e2e-tests 目录未看到覆盖核心用户路径的 spec。

**建议**

先补 4 条 smoke tests：

1. 打开/收起抽屉，窗口状态正确。
2. 创建抽屉，拖入/导入一个临时文件，刷新后可见。
3. Todo 新建卡片、编辑内容、快速切换后内容不丢。
4. 截图 overlay 打开、取消后 handle/drawer 恢复。

这能显著降低后续改窗口、快捷键、截图时的回归风险。

### 18. README 还需要“故障诊断”和“数据恢复”章节

**位置**

- `README.md`
- `docs/development/*`

**现状**

README 已说明开发命令、发布命令和功能，但用户遇到真实问题时还缺：

- 数据目录在哪里。
- 如何备份/恢复。
- 快捷键不生效怎么办。
- 更新不出现怎么办。
- 截图贴纸不出现怎么办。

**建议**

新增用户向文档：

```text
docs/TROUBLESHOOTING.md
docs/DATA_RECOVERY.md
```

README 只保留入口链接。

## 建议实施路线

### Sprint 1：数据闭环与可诊断

目标：解决“看起来成功但实际不完整”和“出问题只能看日志”。

1. 导入返回 `added/skipped/failed` 明细。
2. resident/update state 损坏备份恢复。
3. 设置页增加 updater 诊断和数据目录入口。
4. README 增加 Troubleshooting 链接。

### Sprint 2：快捷键系统

目标：让用户能配置贴图快捷键，并知道冲突原因。

1. 落地 `HOTKEY_SETTINGS_DIALOG_PLAN.md` 的 Phase 1。
2. 新增 `hotkeys.rs`、`hotkeys.json`。
3. 支持保存时注册探测和失败回滚。
4. 设置页弹窗显示快捷键状态。

### Sprint 3：高频性能优化

目标：优化每天都会触发的卡顿点。

1. 抽屉图标渐进加载。
2. 贴纸移动/缩放 debounce 写入。
3. Snip overlay mousemove RAF 节流。
4. 截图 frozen background 后台加载。

### Sprint 4：窗口与启动体验

目标：让开机自启/驻留更轻、更稳定。

1. 贴纸分批恢复。
2. 单一窗口动画调度器。
3. shortcut watcher 状态 IPC。
4. 设置页显示后台监控状态。

### Sprint 5：自动化测试和长期维护

目标：让后续改动更敢动。

1. 补 4 条 e2e smoke tests。
2. 为导入/还原/快捷键/贴纸持久化补 Rust unit tests。
3. CI 增加普通 PR check workflow，不只在 release tag 运行。
4. 建立“每次新功能必须有诊断状态”的约定。

## 推荐优先 PR 拆分

1. **PR A：导入结果明细 + 前端提示**
   - 小而直接，能马上改善数据闭环。
2. **PR B：resident/update settings 损坏备份恢复**
   - 和已有 persistence 风格一致，风险低。
3. **PR C：快捷键设置弹窗 Phase 1**
   - 用户明确提出，产品价值高。
4. **PR D：贴纸拖动 debounce + Snip mousemove 节流**
   - 性能收益明显，改动范围可控。
5. **PR E：抽屉图标渐进加载**
   - 性能收益高，但涉及前后端事件和状态合并，单独做更安全。

## 当前不建议马上做的事

- 不建议一次性重写窗口系统；应先用调度器替换动画线程。
- 不建议马上引入数据库；当前 JSON 文件可继续用，先补健康检查和恢复入口。
- 不建议把所有设置都塞进 `resident.json`；快捷键、诊断、缓存应分文件分域管理。
- 不建议把所有性能问题合在一个 PR；截图、贴纸、抽屉、窗口动画应分开验证。

## 结论

当前软件的主功能已经具备可用基础，下一阶段要重点提升“出错可解释、操作可恢复、耗时可感知、状态可诊断”。最优先的产品路线是：

```text
导入/设置/更新数据闭环
  -> 快捷键配置和冲突检测
  -> 高频交互性能优化
  -> 窗口/驻留状态诊断
  -> e2e 自动化兜底
```

这样可以在不大改现有架构的前提下，把 TidyDesk 从“能用”推进到“稳定、可维护、用户遇到问题能自救”。
