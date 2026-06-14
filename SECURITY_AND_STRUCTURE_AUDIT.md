# TidyDesk 安全与文件职责审查

审查时间：2026-06-14

审查范围：根项目依赖、Tauri 配置、Rust 命令层、React 前端桥接、Go sidecar、构建/发布脚本与文件职责划分。

本次只做静态审查和依赖审计记录，未修改功能代码。

## 总体结论

TidyDesk 没有发现已提交的私钥、token 或明显的远程后端类漏洞。根项目 `npm audit --prefix . --package-lock-only --audit-level=low` 结果为 0 漏洞。

主要风险集中在 Tauri 桌面应用的本地能力边界：renderer 可以调用的 IPC 命令较多，且部分测试/调试命令、剪贴板、截图、文件/快捷方式、updater 等能力没有进一步按窗口或构建类型收窄。一旦 renderer 侧出现 XSS、依赖污染或被恶意脚本注入，影响会从普通 UI 问题扩大到本机隐私与文件操作风险。

## 安全发现

### 高优先级：生产命令面包含测试 IPC

位置：

- `src-tauri/src/main.rs:209-295`
- `src-tauri/src/main.rs:394-415`
- `src/native/native-client.ts:39-51`

问题：

- `tests_open_files_drawer`
- `tests_collapse_drawer`
- `tests_start_snip`
- `tests_get_window_snapshot`
- `tests_reset_window_state`

这些测试命令被注册进正式 `invoke_handler`。前端也无条件挂载 `window.__TIDYDESK_TEST__`。这些能力对 E2E 有用，但不应出现在 release renderer 可访问面里。

影响：

- 被注入脚本可更容易控制窗口状态、触发截图流程、重置窗口状态。
- 扩大 renderer compromise 后的本地能力面。

建议：

- 用 `#[cfg(debug_assertions)]` 或专门的 test feature 包住测试命令注册。
- 前端 `window.__TIDYDESK_TEST__` 也仅在测试构建或 E2E 环境开启。
- 如 E2E 需要 release-like 构建，使用独立 capability/test build profile，而不是默认暴露。

### 高/中优先级：截图与剪贴板能力边界偏宽

位置：

- `src-tauri/src/main.rs:199-206`
- `src-tauri/src/stickers.rs:90-123`
- `src-tauri/src/stickers.rs:155-162`

问题：

- `clipboard_read_text` 可直接读取系统剪贴板。
- 截图背景和贴纸图片会以 base64 data URL 返回给 renderer。
- 目前没有看到按窗口 label、用户手势、一次性 token 或构建类型做更细粒度限制。

影响：

- renderer 被注入后可能读取剪贴板敏感文本。
- 截图能力可能泄露桌面可见内容。

建议：

- 为剪贴板读取增加明确用户动作来源限制，只允许 capture 相关窗口调用。
- 截图相关命令按窗口 label/capability 限制，只允许 snip/sticker 流程调用。
- 对 `snip_get_background_image` 增加一次性会话 token 或生命周期状态校验。

### 中优先级：updater 允许运行时覆盖 endpoint 和公钥

位置：

- `src-tauri/src/updates.rs:14-17`
- `src-tauri/src/updates.rs:86-126`
- `src-tauri/src/updates.rs:309-325`

问题：

代码允许通过环境变量覆盖：

- `TIDYDESK_UPDATER_ENDPOINTS`
- `TIDYDESK_UPDATER_PUBLIC_KEY`
- `TIDYDESK_UPDATER_PUBLIC_KEY_FILE`

这对测试有便利性，但 release 中允许覆盖公钥会削弱内置公钥校验边界。

影响：

- 如果本机环境被污染，更新检查可能使用非预期 endpoint/pubkey。
- 虽然攻击者通常已需要本机环境控制能力，但 updater 是高信任链路，应尽量固定。

建议：

- release 构建禁用 pubkey override。
- endpoint override 仅允许 debug/test 构建，或限定到受信任域名。
- 保留 channel override 时也建议做白名单，例如 `stable`、`beta`。

### 中优先级：应用导入接受任意 `.lnk` 路径

位置：

- `src-tauri/src/apps.rs:81-90`
- `src-tauri/src/apps_classifier.rs:41-64`

问题：

`apps_add_to_drawer` 直接接收 renderer 传入的 `shortcut_path`，只校验文件存在且扩展名为 `.lnk`，没有限制该路径必须来自上一次扫描结果、开始菜单或桌面目录。

影响：

- renderer 被注入后可让应用复制任意可访问 `.lnk` 到抽屉。
- 风险低于直接任意文件读写，但仍扩大本机文件操作面。

建议：

- 后端保存扫描结果，并让前端传 app ID 或 scan token。
- 后端二次确认路径来自受信扫描范围后再导入。
- 对 `.lnk` 目标也做合理校验，例如必须解析为存在的 `.exe`，且不属于卸载/安装器等过滤范围。

### 中/低优先级：E2E 依赖存在审计告警

位置：

- `e2e-tests/package.json`
- `e2e-tests/package-lock.json`

结果：

`npm audit --prefix e2e-tests --package-lock-only --audit-level=low` 报告：

- 2 high
- 2 moderate

主要链路：

- `esbuild`
- `serialize-javascript`
- `mocha`
- `@wdio/mocha-framework`

影响：

- 当前属于 dev/test 依赖，不直接进入生产运行时。
- 仍会影响 CI/开发机供应链安全。

建议：

- 优先升级 WebdriverIO/Mocha 链路到消除 `serialize-javascript` 告警的版本。
- 升级 `esbuild` 到不受 GHSA 影响的版本。

### 低优先级：构建命令依赖浮动 CLI 版本

位置：

- `package.json:23-29`
- `scripts/run-tauri-build.cjs:91-103`

问题：

构建命令使用 `npx --yes @tauri-apps/cli@2`，会拉取 Tauri CLI major 2 的最新版本。

影响：

- 可复现性弱于精确锁定版本。
- 增加供应链漂移风险。

建议：

- 将 `@tauri-apps/cli` 固定到 devDependency。
- npm scripts 使用本地锁定版本，而不是每次通过 `npx --yes` 拉取。

## 已确认的安全正向点

- 根项目依赖审计为 0 漏洞。
- 未发现提交的私钥、token、API key。
- 生产 CSP 明确限制脚本、对象、frame、frame-ancestors、base-uri、form-action。
- Vite dev server 绑定 `127.0.0.1` 且 strict port。
- 文件抽屉路径有 `safe_drawer_name`、`safe_drawer_entry_name`、`is_path_inside` 等边界校验。
- 托管文件恢复要求目标位于 TidyDesk storage 内。
- Todo、Quick Notes、Stickers 本地状态写入均有互斥锁，降低多窗口并发覆盖风险。
- Go sidecar 使用 stdin/stdout JSON RPC，未开放网络端口。
- sidecar 请求有超时、串行 worker 和自动重启逻辑。
- updater 默认内置 GitHub Releases endpoint 和公钥校验。

## 文件职责评估

### 清晰的部分

- `src/modules/*`：前端按用户功能拆分为 drawer、todos、notes、stickers、capture、handle、rail。
- `src/native/*`：前端 Tauri adapter 与 NativeClient 类型边界较清楚。
- `src-tauri/src/apps.rs`、`files.rs`、`todos.rs`、`quick_notes.rs`、`stickers.rs`、`updates.rs`：Rust 命令层按领域拆分，基本可读。
- `sidecars/apps-cache`：Go sidecar 聚焦应用扫描，不承担 UI 或主进程职责。

### 职责偏宽的部分

#### `src-tauri/src/main.rs`

原先同时承担：

- module 声明与命令导入
- IPC 注册
- 用户事件命令
- 窗口控制命令
- 剪贴板读取
- E2E 测试命令
- 路径工具函数
- Tauri builder/setup

已处理：

- 已拆出 `commands/events.rs`
- 已拆出 `commands/windows.rs`
- 已拆出 `commands/tests.rs`
- 已拆出 `commands/clipboard.rs`
- 已拆出 `paths.rs`
- `main.rs` 主要保留 builder、state 注册、插件和 command wiring

#### `src-tauri/src/tool_windows/*`

原先由单个 `tool_windows.rs` 同时管理：

- Todo window
- App Picker window
- Snip window
- Sticker windows

已处理：

- 已拆为 `tool_windows/todo.rs`
- 已拆为 `tool_windows/app_picker.rs`
- 已拆为 `tool_windows/snip.rs`
- 已拆为 `tool_windows/sticker.rs`
- `tool_windows/mod.rs` 只保留公共导出

#### `src-tauri/src/files_rules/*`

原先由单个 `files_rules.rs` 同时包含：

- 文件分类
- 桌面保护项规则
- 抽屉路径清洗
- 文件移动/复制到 storage
- 系统路径判断
- Windows COM 快捷方式创建/解析
- Shell 打开文件

已处理：

- 已拆为 `files_rules/names.rs`：命名与路径清洗
- 已拆为 `files_rules/storage.rs`：storage 与抽屉快捷方式导入
- 已拆为 `files_rules/classify.rs`：扩展名分类与文件元数据展示 helper
- 已拆为 `files_rules/windows_shortcuts.rs`：COM shortcut 创建/解析
- 已拆为 `files_rules/shell_open.rs`：打开文件
- `files_rules/mod.rs` 只保留公共导出

#### `sidecars/apps-cache/*.go`

原先由单个 `main.go` 同时包含：

- JSON RPC 协议
- cache 读写
- 扫描参数解析
- shortcut 扫描
- shortcut 分类
- 入口函数

已处理：

- 已拆为 `rpc.go`
- 已拆为 `cache.go`
- 已拆为 `scan.go`
- 已拆为 `classify.go`
- 已拆为 `version.go`
- 已拆为 `types.go`
- `main.go` 只保留启动与 stdin/stdout 循环

### 命名问题

以下 App Picker 命名已移除 PoC 语义：

- `open_app_picker`
- `close_app_picker`
- `app-picker`
- `TidyDesk App Picker`

## 建议执行顺序

1. 将测试 IPC 与 `window.__TIDYDESK_TEST__` 限定到 debug/test 构建。
2. 增加 Tauri capability/command/window 级权限边界。
3. release 禁用 updater public key override。
4. 将 `apps_add_to_drawer` 改为扫描结果 ID 导入模式。
5. 升级 E2E 依赖，消除 audit 告警。
6. 固定 `@tauri-apps/cli` 版本。
7. 拆分职责偏宽文件，先 Rust 主进程，再 Go sidecar。（已完成）

## 审查限制

- 当前审查未运行 Rust `cargo audit`，因为本次 Windows 执行环境中没有 `cargo`。
- 本次未运行 Tauri E2E，因为用户要求先写文档、不要修复。
- 本文档结论基于静态代码审查与 npm audit，不等同于完整渗透测试。
