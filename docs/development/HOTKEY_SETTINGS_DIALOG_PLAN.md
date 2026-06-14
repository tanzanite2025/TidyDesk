# 快捷键设置弹窗规划

## 背景

PR #20 已把截图贴纸改成“框选后先保存为待贴截图，按 `Ctrl+Alt+V` 才贴到桌面”。当前问题是快捷键仍然写死在 Rust 侧：

- `src-tauri/src/stickers.rs` 里固定注册 `ctrl+alt+v`。
- 设置页只能控制“截完图立即贴到桌面”，不能改贴图快捷键。
- 如果快捷键被其他软件占用，只能在日志里看到注册失败，用户界面没有提示。

因此可以新增一个“快捷键设置”弹窗，用来配置贴图等全局快捷键，并在保存前做冲突检测。

## 目标

1. 用户可以在设置页打开“快捷键设置”弹窗。
2. 用户可以修改“贴出最近截图”的快捷键，默认值仍为 `Ctrl+Alt+V`。
3. 快捷键录入过程可视化：点击输入框后直接按组合键，界面显示规范化结果。
4. 保存前检测冲突：
   - TidyDesk 内部动作之间重复。
   - 当前快捷键格式不合法或过于危险。
   - 系统/其他应用已占用，导致全局注册失败。
5. 保存成功后无需重启，立即重新注册全局快捷键。
6. 注册失败时不破坏旧快捷键，自动回滚并提示原因。

## 非目标

- 不做复杂的“快捷键市场”或多套配置方案。
- 不做应用内每个按钮的局部快捷键绑定。
- 不强行覆盖其他应用已占用的快捷键。
- 不在首版支持鼠标侧键、手柄按键或多段快捷键序列。

## 建议入口与交互

### 设置页入口

在 `SettingsPanel` 的“截图贴纸”区域增加按钮：

```text
截图贴纸
  截完图立即贴到桌面  [已关闭]
  贴图快捷键：Ctrl+Alt+V       [修改快捷键]
```

点击“修改快捷键”打开弹窗。

### 弹窗结构

```text
┌──────────────────────────────┐
│ 快捷键设置                   │
│ 配置 TidyDesk 的全局快捷键   │
├──────────────────────────────┤
│ 截图贴纸                     │
│ 贴出最近截图  [Ctrl+Alt+V]   │
│ 状态：可用 / 已占用 / 未设置 │
│                              │
│ 常用操作（后续扩展）         │
│ 开始截图      [未设置]       │
│ 快速记录      [未设置]       │
│ 显示/隐藏把手 [未设置]       │
├──────────────────────────────┤
│ [恢复默认] [取消] [保存]     │
└──────────────────────────────┘
```

### 录入规则

- 点击快捷键输入框后进入录入状态，提示“请按新的组合键”。
- `Esc`：取消当前录入。
- `Backspace` / `Delete`：清空该动作快捷键。
- 支持组合：`Ctrl` / `Alt` / `Shift` / `Meta` + 一个主键。
- 默认要求至少包含 `Ctrl` 或 `Alt` 之一，禁止单独字母、数字、方向键等高误触组合。
- 显示层统一为 `Ctrl+Alt+V`，Rust 注册层统一为 `ctrl+alt+v`。

## 首批支持动作

首版建议只把已经有明确需求且链路已存在的动作纳入可配置：

| action id | 默认快捷键 | 行为 | 优先级 |
| --- | --- | --- | --- |
| `paste_pending_sticker` | `Ctrl+Alt+V` | 贴出最近一次待贴截图 | P0 |
| `start_screenshot` | 未设置 | 打开截图框选层 | P1 |
| `quick_capture` | 未设置 | 打开快速记录 | P1 |
| `toggle_handle` | 未设置 | 显示/隐藏桌面把手 | P2 |

原因：先把“贴图快捷键”做稳，再逐步把其他全局快捷键迁进同一个系统，避免一次性改动过大。

## 数据模型

建议新增独立配置文件，而不是继续塞进 `resident_settings.json`：

```text
app_data_dir/
  hotkeys/
    hotkeys.json
```

示例：

```json
{
  "version": 1,
  "bindings": [
    {
      "action": "paste_pending_sticker",
      "accelerator": "ctrl+alt+v",
      "enabled": true,
      "updatedAt": "2026-06-14T19:30:00Z"
    }
  ]
}
```

Rust 类型建议：

```rust
enum HotkeyAction {
    PastePendingSticker,
    StartScreenshot,
    QuickCapture,
    ToggleHandle,
}

struct HotkeyBinding {
    action: HotkeyAction,
    accelerator: Option<String>,
    enabled: bool,
}

struct HotkeySettingsFile {
    version: u32,
    bindings: Vec<HotkeyBinding>,
}
```

写入沿用现有 `persistence::atomic_write_json`；读取损坏时备份为 `.corrupt-<timestamp>.json`，再恢复默认配置。

## 后端模块设计

建议新增 `src-tauri/src/hotkeys.rs`，避免和现有 `shortcuts.rs`（快捷方式健康检查）混淆。

职责：

1. 读取/写入快捷键配置。
2. 校验 accelerator 格式。
3. 注册/注销/重注册全局快捷键。
4. 处理快捷键触发后的动作分发。
5. 输出冲突检测结果给前端。

建议 IPC：

```rust
hotkeys_get_settings() -> HotkeySettingsPayload
hotkeys_validate_binding(action, accelerator) -> HotkeyValidationResult
hotkeys_update_binding(action, accelerator, enabled) -> HotkeyUpdateResult
hotkeys_reset_defaults() -> HotkeySettingsPayload
```

触发分发伪代码：

```rust
match action {
    PastePendingSticker => stickers::paste_pending_sticker(app),
    StartScreenshot => stickers::open_snip_window(app),
    QuickCapture => windows_control(open-capture),
    ToggleHandle => resident::toggle_handle_window(app),
}
```

## 冲突检测策略

### 1. 格式检测

保存前先规范化：

```text
Ctrl + Alt + V -> ctrl+alt+v
Control+Option+V -> ctrl+alt+v
```

拒绝：

- 空字符串但 `enabled=true`。
- 只有单键：`v`、`f1`。
- 只有修饰键：`ctrl+alt`。
- 常见系统保留组合：`Ctrl+Alt+Delete`、`Alt+Tab`、`Win+L`、`Ctrl+Esc`。
- 和浏览器/文本输入高度冲突的组合：`Ctrl+C`、`Ctrl+V`、`Ctrl+S` 等。

### 2. TidyDesk 内部冲突

同一个 accelerator 只能绑定一个启用动作：

```text
paste_pending_sticker = ctrl+alt+v
start_screenshot      = ctrl+alt+v  -> 内部冲突
```

UI 显示：

```text
和“贴出最近截图”冲突
```

### 3. 系统/外部应用冲突

`tauri-plugin-global-shortcut` 无法提前枚举所有外部快捷键，但注册失败可以作为权威检测。

保存流程建议：

```text
1. 暂存旧配置和旧注册表。
2. 注销当前 action 的旧快捷键。
3. 尝试注册新快捷键。
4. 如果注册成功：
   - 写入 hotkeys.json。
   - 更新内存映射。
5. 如果注册失败：
   - 重新注册旧快捷键。
   - 不写入新配置。
   - 返回 externalConflict。
```

返回示例：

```json
{
  "success": false,
  "reason": "externalConflict",
  "message": "Ctrl+Alt+V 已被其他应用占用"
}
```

### 4. 启动期冲突

应用启动时注册所有启用快捷键：

- 成功：状态为 `registered`。
- 失败：状态为 `conflict`，保留配置但禁用运行时绑定，并在设置页显示“需要重新设置”。

这样用户知道不是功能坏了，而是快捷键被占用。

## 前端设计

新增组件：

```text
src/components/HotkeySettingsDialog.tsx
src/components/HotkeyRecorderInput.tsx
```

`HotkeyRecorderInput` 只负责录入和展示，不直接保存。

`HotkeySettingsDialog` 负责：

- 加载 `hotkeys_get_settings()`。
- 本地检测内部重复。
- 调 `hotkeys_validate_binding()` 做后端校验。
- 调 `hotkeys_update_binding()` 保存并即时生效。
- 显示每行动作状态。

`native-client` 增加：

```ts
hotkeys: {
  getSettings(): Promise<HotkeySettings>;
  validateBinding(payload): Promise<HotkeyValidationResult>;
  updateBinding(payload): Promise<HotkeyUpdateResult>;
  resetDefaults(): Promise<HotkeySettings>;
}
```

## 用户提示

推荐文案：

- 可用：`这个快捷键可以使用`
- 内部冲突：`已被“开始截图”使用`
- 外部冲突：`系统或其他应用已占用，无法注册`
- 格式不合法：`请至少使用 Ctrl 或 Alt + 一个主键`
- 保存成功：`快捷键已生效，无需重启`

## 实施阶段

### Phase 1：贴图快捷键可配置

- 新增 `hotkeys.rs`。
- 将 `stickers::register_sticker_shortcuts()` 迁移为通用 hotkey 注册。
- 支持 `paste_pending_sticker` 读取配置并注册。
- 设置页新增“快捷键设置”弹窗。
- 实现格式检测、内部冲突检测、注册失败回滚。

验收：

- 默认 `Ctrl+Alt+V` 可贴出最近截图。
- 改成 `Ctrl+Alt+P` 后立即生效。
- 与自身重复或系统占用时无法保存并有提示。
- 保存失败不会导致旧快捷键失效。

### Phase 2：截图/快速记录/把手动作接入

- 接入 `start_screenshot`。
- 接入 `quick_capture`。
- 接入 `toggle_handle`。
- 设置页显示所有动作。

验收：

- 每个动作都能设置、禁用、恢复默认。
- 同一快捷键不能绑定多个动作。
- 应用重启后配置仍然生效。

### Phase 3：帮助与诊断

- README 增加快捷键说明。
- 设置页增加“快捷键不起作用？”诊断提示。
- 日志中记录每个快捷键注册结果，但不打印敏感路径。

## 风险与兜底

1. **外部占用只能通过注册失败检测**  
   兜底：保存时实际注册，不做纯前端假检测。

2. **用户设置了无法触发的键位**  
   兜底：严格格式白名单 + “恢复默认”按钮。

3. **重注册失败导致旧快捷键丢失**  
   兜底：两阶段提交，失败就重新注册旧 binding。

4. **快捷键模块和快捷方式健康检查命名混淆**  
   兜底：新模块命名为 `hotkeys.rs`，UI 用“快捷键”，文件快捷方式继续叫 shortcut。

## 推荐下一步

先做 Phase 1，一个小 PR 只覆盖“贴出最近截图”的可配置快捷键和冲突检测；通过后再扩展到“开始截图 / 快速记录 / 显示隐藏把手”。
