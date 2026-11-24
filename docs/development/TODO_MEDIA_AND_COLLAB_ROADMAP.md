# TidyDesk TODO 富媒体与多账号服务端协同演进路线图

> **定位**：作为 TidyDesk 从“单机整理工具（v3.5.0）”向“Trello 式拍照/附件看板 + 服务端多账号 + 移动端协同”演进的长期施工清单。每完成一个阶段，请同步勾选对应检查项并更新阶段状态与关联提交记录。
> - 技术架构、端到端数据链路图与移动端/同步断层规范见：[TODO 数据链路与桌面/移动端协同架构指南](./TODO_SYNC_AND_MOBILE_ARCHITECTURE.md)
> - 文档总入口见：[TidyDesk 文档中心](../README.md)
>
> **最后更新**：2026-11-23（对齐单机多维加固 `40/40` 单测与跨端架构规范）

---

## 一、全局架构边界与不可妥协红线

在进入任何阶段编码前，所有实现必须遵守以下约束：

1. **本地桌面能力与云协同能力物理分层**
   - **纯本机能力**（不上云）：桌面抽屉路径、`.lnk` 快捷方式管理与修复（`files/`、`shortcuts/`）、已安装应用扫描（`apps_classifier/`）、屏幕 GDI 截图与 Win32 分层贴纸（`capture/`、`stickers/`）、系统热键（`hotkeys/`）。
   - **云协同数据域**：待办看板、卡片、检查清单、拍照与图片附件（`todos/`）、快捷便签（`quick_notes.rs`）。
2. **禁止大图片 Base64 内联存储或 IPC 搬运**
   - 图片/照片原图与缩略图必须独立落盘到附件目录并通过 `tidydesk-asset://` 协议读取；严禁将 `data:image/...;base64,...` 写入 `boards.json`、`cards/*.md` 或通过列表 JSON 批量传输。
3. **详情懒加载与列表缩略图隔离**
   - 看板列表页只加载卡片标题、封面**缩略图** URL、附件数量与状态徽标；原图预览与完整正文/清单在打开卡片详情时按需加载。
4. **登录与底层模块解耦**
   - 登录认证流程只负责校验 Token 与 User ID，不得在登录环节阻塞或耦合其它本地桌面模块的数据拉取与运行；多账号权限完全由服务端及统一权限矩阵决定。
5. **服务端大文件对象存储直传**
   - 客户端拍照与附件上传应通过服务端签发的预签名 URL 直传对象存储（S3 / MinIO / OSS），业务 API 服务器只维护元数据与索引，不中转大体积图片流。

---

## 二、总进度概览

| 阶段 | 主题 | 状态 | 目标版本参考 |
| --- | --- | --- | --- |
| **Phase 0** | 单机底层架构底座与扩展字段兼容性 | ✅ 已完成 | `v3.5.0` |
| **Phase 1** | 单机 Trello 式拍照 / 图片附件 TODO 看板（含子任务多媒体与多维边界加固） | 🚧 代码已完成（待实机验收） | 下一发布版本 |
| **Phase 2** | 多账号本地隔离与协同数据模型补齐 | 🚧 代码已完成（待实机验收） | 联网前置准备 |
| **Phase 2.5** | 同步前置断层补齐与跨平台内核解耦（详设见[架构指南](./TODO_SYNC_AND_MOBILE_ARCHITECTURE.md)） | ✅ 代码已完成 | 服务端上线前置 |
| **Phase 3** | 最小可用服务端与离线优先增量同步 | 🚧 代码已完成（待双端联调验收，`50/50` + `3/3` 单测） | 服务端上线 MVP |
| **Phase 4** | 实时协同推送与桌面 / 移动端协同扩展 | 🚧 代码已完成（待双端真机联调，`52/52` + `4/4` 单测） | 多端实时协同 |

---

## 三、分阶段实施清单（先做什么 → 后做什么）

### Phase 0：已就绪底层底座（✅ 已完成，`v3.5.0`）

- [x] **自定义受控资产协议**：落地 `src-tauri/src/asset_protocol.rs` 与 `tidydesk-asset://` 路由白名单，并在 `src-tauri/tauri.conf.json` CSP 放行。
- [x] **TODO 索引与正文隔离**：`src-tauri/src/todos/store.rs` 将 `boards.json` 与 `cards/<id>.md` 分文件存储，并由 `spawn_blocking` + `atomic_write_text_fast` 串行化写入。
- [x] **TODO 扩展字段向前兼容**：`src-tauri/src/todos/model.rs` 的 `normalize_todo_index` 改为原位校验，完整保留 `version > 1`、多看板字段与卡片未知扩展字段（已通过单元测试）。
- [x] **截屏与贴纸解耦**：`capture/` 负责 GDI 截屏与遮罩选区（内存直出背景），`stickers/` 负责 Win32 `WS_EX_LAYERED` 原生贴纸渲染。
- [x] **工具链与 CI 对齐**：`package.json` 与 `.github/workflows/release.yml` 统一默认 Windows MSVC 工具链与发布产物路径校验。

---

### Phase 1：单机 Trello 式拍照 / 图片附件 TODO 看板（代码已落地，待实机验收）

> **核心目标**：在不引入服务器的情况下，让本地 TODO 窗口完整支持卡片封面图、拍照上传、截屏直接入卡、多图片附件管理与缩略图流畅渲染。

#### 1.1 数据结构与存储布局扩展
- [x] 在 `src/types/todo.ts` 与 `src-tauri/src/todos/model.rs` 扩展卡片与附件模型（保持与 `boards.json` 既有字段及扩展字段兼容）：
  - `attachments`: `Array<{ id, kind: 'image' | 'video', originalName, fileName, thumbFileName, width, height, aspectRatio, orientation, exifOrientation, focalPoint, previewMode, sha256, syncState, sizeBytes, mimeType, createdAt }>`（当前已落地 `image`，`video` 类型与分层页签已预留）
  - `coverAttachmentId`: `string | null`（看板列表封面图引用）
  - `subtasks`: `Array<{ id, title, completed, position, attachments, attachmentCount, createdAt, updatedAt }>`（独立结构化子任务清单，通过统一 `cardId + optional subtaskId` 归属抽象共用主卡三层图片管线与相机/截屏/拖拽/灯箱；删子任务自动清理孤儿文件并修正悬空封面；看板卡片瓷砖统一聚合进度条与双格预览）
- [x] 在 `src-tauri/src/todos/attachments.rs` 建立卡片附件目录：`app_data_dir()/todos/attachments/<card_id>/`（原图无损保留 + EXIF 朝向自动校正后最大边 `480px` 等比缩略图 `thumb_<att_id>.png`，基于 Windows CNG 计算 SHA-256 指纹）。
- [x] 更新 `todos_delete_card`（`src-tauri/src/todos/card_commands.rs`）：采用“隔离重命名附件目录 → 更新 `boards.json` → 物理清理”两阶段删除，杜绝孤儿图片残留在磁盘。

#### 1.2 协议扩展与按需加载
- [x] 在 `src-tauri/src/asset_protocol.rs` 新增 `TodoAttachment` 安全路由（严格校验 `<card_id>` 与文件名白名单，拒绝 `..` 路径穿越），通过 `tidydesk-asset://localhost/todos/<card_id>/<file>` 输出。
- [x] 彻底分离看板摘要（Summary）与卡片详情（Detail）：`todos_read_state` 仅下发 `summaryText`、封面优先的 `previewAttachments`（最多 2 项，聚合主卡与子任务附件）与 `extraAttachmentCount`，剔除长正文与全量附件数组；`todos_get_card_detail` 按卡号与 `revision` 版本号按需水合详情；卡片预览改用锁定纵横比（1 项 `aspect-[16/10]` / 2+ 项 `grid-cols-2 + aspect-[4/3]`）搭配 `focalPoint` 非破坏性取景，超出 2 项显示 `+N 点击查看`。
- [ ] 如后续需要本地音视频附件回放，在 `src-tauri/tauri.conf.json` 的 `media-src` 同步放行 `tidydesk-asset: http://tidydesk-asset.localhost`。

#### 1.3 拍照、截图与本地上传入口
- [x] **本地图片/粘贴导入**：支持原生文件选择框导入（PNG/JPG/WebP）、桌面拖拽投放及弹窗 `Ctrl+V` 粘贴图片（自动路由至当前聚焦的子任务或主卡片），Rust 后端转存并生成 `480px` 朝向校正缩略图。
- [x] **截屏直接生成任务图**：复用 `capture/screen_gdi.rs` + `SnipOverlayApp.tsx`（`SnipTarget::TodoCard { card_id, subtask_id }`），完成或取消均可靠恢复 `todos` 窗口并广播 `todos-updated`。
- [x] **摄像头拍照任务**：前端基于 `<video>` + `getUserMedia` + `<canvas>` 实现 `TodoCameraModal.tsx`（含多摄像头切换、重拍与退出停轨释放，拒权/无设备显式提示，主卡与子任务共用同一弹窗组件）。

#### 1.4 阶段验收标准
- [ ] 实机桌面验收（`npm run dev`）：在真实 Windows 环境验证 WebView2 摄像头权限、子任务内嵌多媒体拍摄/截图、多图卡片拖拽滚动、防误关/窗体隐藏停流与删卡/删子任务磁盘清理。
- [x] **多维边界与防误操作加固**：新建草稿防误关确认、拖图偏离/正文中链接防 WebView2 跳转、子任务编辑 `Esc` 防冒泡、同列误拖与快速建卡防重、子任务操作串行队列（消解“新建即拍”竞态）、窗体隐藏自动释放相机流、截屏异常强制恢复 `todos` 窗口、`> 20 MB` / `.svg` 前置拦截及 Rust 解码像素上限保护。
- [x] 补齐 `asset_protocol`、`todos::attachments`（EXIF/SHA-256/焦点/超限拦截）、`todos::store`（Summary/Detail 分离与子任务附件聚合）与 `todos::model`（UUID/子任务附件合并清理）全套 Rust 单测，`npm run check`、`tsc --noUnusedLocals --noUnusedParameters`、`cargo check --features e2e-tests`、`cargo clippy --all-targets`（TODO/截屏/账号模块零警告）与 `cargo test`（40/40）全量通过。

---

### Phase 2：客户端多账号隔离与协同数据模型补齐（代码已落地，待实机验收）

> **核心目标**：把单机数据库目录和数据结构改造成“可多账号切换、可与服务端合并同步”的客户端基线，暂不强制联网（默认纯本地工作区 0 登录直用）。

- [x] **账号级数据目录隔离**：新增 `src-tauri/src/accounts/`（`account-session.json` 持久化当前会话，`activeUserId = None` 时默认直连原 `app_data_dir()/todos/` 与 `storage/quick-notes.json`）；切换账号后隔离读写 `app_data_dir()/accounts/<user_id>/todos/` 与 `quick-notes.json`，支持 `accounts_import_local_todos` 安全复制并跳过重复/已删卡片，在设置面板提供 `AccountSyncCard.tsx` 切换/登出入口。
- [x] **全局唯一主键升级**：在 `src-tauri/src/todos/model.rs` 基于 Windows `BCryptGenRandom` 实现 RFC-4122 UUID v4 生成器（`create_uuid_v4`），新建卡片与附件改用 UUID，并完全向后兼容既有 `card-...` 旧 ID。
- [x] **并发协同元数据补齐**：
  - 为 `TodoCard` 增加 `revision`（版本修订号）、`updatedBy`、`deletedAt`（开启同步/账号时执行软删除墓碑并清理正文/附件；纯本地模式保持物理清除）；`todo_counts` 与列表视图自动过滤墓碑。
  - 新增 `src-tauri/src/todos/ranking.rs` 实现 base-62 分数排序键（LexoRank / `position`），头尾插与跨列移动均可独立计算局部排序键，同时保留 `cardOrder` 向下兼容。
- [x] **离线变更发件箱（Outbox）设计**：新增 `src-tauri/src/sync/`（`SyncTransport` trait、`LocalNoopSyncTransport` 空实现、`sync-outbox.json` 按 `(entityKind, entityId)` 合并去重与 `sync_get_status`/`sync_list_outbox`/`sync_clear_outbox`/`sync_run_once` 命令）；仅在账号同步模式激活时挂载入队，纯本地模式零额外磁盘开销。

#### 阶段验收标准
- [ ] 同机切换两个模拟账号后，各自 TODO 数据、附件目录与便签互不可见、互不污染（待实机桌面端验证）。
- [x] UUID v4、软删除、多账号路径与 URL 校验、Outbox 合并去重及分数排序具备完整 Rust 单元测试覆盖，无新增编译/Clippy 告警。

---

### Phase 2.5：同步前置断层补齐与跨平台内核解耦（✅ 代码已落地，`47/47` 单测通过）

> **核心目标**：打通接入云端同步服务与移动端复用之前的数据断层，详细技术规约见 [TODO 数据链路与桌面/移动端协同架构指南](./TODO_SYNC_AND_MOBILE_ARCHITECTURE.md)。

- [x] **Outbox 载荷与附件队列补全**：`Card` 入队携带 `content` 正文与 `baseRevision`；在 `attachment_commands.rs` 与 `card_commands.rs` 接入 `OutboxEntityKind::Attachment` 文件级增/删/删子任务/软删卡片队列，并补齐 `accounts_import_local_todos` 导入批量入队与队列满显式阻断报错。
- [x] **鉴权凭据与账号游标隔离**：新增 `src-tauri/src/accounts/credentials.rs`，Token 通过 Windows DPAPI 加密写入 `token.dpapi`；`last_sync_cursor` 与服务端点按账号 `sync-profile.json` 持久留存，切换账号不丢失历史同步位置。
- [x] **单源排序收口**：前后端统一按未删除卡片的 `(position, createdAt, id)` 字典序排序（`ranking.rs` 与 `TodoContext.tsx` 码点排序），自动派生兼容字段 `board.cardOrder`。
- [x] **跨平台哈希解耦**：将 `attachments.rs` 中的 Windows `BCrypt` 哈希计算替换为纯 Rust 跨平台 FIPS 180-4 SHA-256，扫清领域内核复用到 iOS/Android 的原生平台障碍。
- [x] **成员级合并运行时实现（已在 Phase 3.2 实装，见 `sync/merge.rs` 与 `server/src/merge.mjs`）**：按子任务（`subtasks`）与附件（`attachments`）的 `id + deletedAt` 成员级归并及定期 Tombstone GC 实装。

---

### Phase 3：最小可用协同服务端与异步增量同步（🚧 代码已完成，待双端实机联调）

> **核心目标**：部署后端服务，实现多账号鉴权、工作空间权限隔离、图片对象存储直传，以及客户端与服务端之间的离线优先增量同步。

#### 3.1 服务端建设（零依赖 Node.js MVP + Docker Compose PostgreSQL/MinIO 生产蓝图）
- [x] **API 服务与本地测试**：新增 `server/`（`server/src/{index,auth,store,merge}.mjs`、`server/test/sync.test.mjs`），提供：
  - **认证与权限（Auth + RBAC）**：`POST /api/v1/auth/verify`（仅校验 Token 与 User ID，不耦合业务拉取）及基于 Workspace 成员角色（Owner/Admin/Member/Viewer）的读写边界校验（Viewer 写入拒绝 `403`）。
  - **生产数据库 Schema**：在 `server/sql/schema.sql` 定义 `users`、`workspaces`、`workspace_members`、`boards`、`cards`、`subtasks`、`attachments`、`sync_events` 表。
- [x] **媒体秒传与二进制存储**：
  - 实现 `POST /api/v1/media/presign`（凭 `sha256` 秒传去重）与 `PUT/GET /api/v1/media/blob/:kind/:key`（`thumb`/`original` 分层存取，限制 `25 MB` 与防路径穿越），同时在 `server/docker-compose.yml` 预留 PostgreSQL + MinIO 生产部署栈。

#### 3.2 客户端同步引擎接入（Rust 侧）
- [x] 在 `src-tauri/Cargo.toml` 启用 `reqwest 0.13.3`，新增 `src-tauri/src/sync/{http_transport.rs,engine.rs,merge.rs}`：实现附件缩略图+原图直传、Push Outbox 并发安全 ACK、Pull 游标增量合并（`subtasks`/`attachments` 成员级 ID 并集归并 + 长正文冲突副本保留 + 超期 Tombstone GC）及快捷便签同步。
- [x] 扩展 `asset_protocol.rs` 与 `todos/store.rs`：拉取远端卡片时优先预取 `480px` 缩略图回写本地缓存；本地缺失原图时由 `asset_protocol` 按需从远端懒下载回写后直接输出 `200 OK`。
- [x] 严格解耦登录与业务拉取：`accounts_switch_session` 与 `accounts_get_session` 仅处理会话与加密 Token 存储；仅在用户或独立调度调用 `sync_run_once` 时执行推拉，且不关闭正在查看的卡片弹窗。

#### 阶段验收标准
- [ ] 启动 `node server/src/index.mjs` 并登录两台设备/两模拟账号加入同一 Workspace：A 创建拍照任务卡片并拖拽列位置，B 同步后完整呈现缩略图、原图与列顺序。
- [ ] 断网状态下 A 正常拍照与建卡，恢复联网后点击「立即云端同步」Outbox 自动补传成功。

---

### Phase 4：实时协同推送与桌面 / 移动端扩展（🚧 代码已完成，待双端真机联调）

> **核心目标**：打通秒级实时协同体验，并基于同一跨平台领域核与 `NativeClient.capabilities` 扩展手机端（详细分层与缩略图省流方案见 [TODO 数据链路与桌面/移动端协同架构指南](./TODO_SYNC_AND_MOBILE_ARCHITECTURE.md)）。

- [x] **SSE 实时广播与桌面端订阅**：`server/` 新增 `GET /api/v1/sync/events` 按 `workspaceId` 推送 `sync-changed`（并支持 CORS 与构建后 `dist/` 同域静态托管）；Rust 端新增 `src-tauri/src/sync/realtime.rs`（`sync_set_realtime_enabled` 控制开关、切号/登出自动停止连接、退避重连并在收到远端更新时自动调用 `execute_account_sync` 刷新）。
- [x] **移动端适配与能力开关**：基于 `NativeClient.capabilities` 在移动端自动屏蔽桌面截屏、开放 `<input capture="environment">` 手机系统相机直拍与相册多选；新增 `src/native/web-http-adapter.ts` 与 `src/modules/mobile/MobileTodoApp.tsx`（`?mode=mobile`），实现“手机拍照建卡 / 子任务拍照 → 电脑端秒级收到推送并展示”。
- [x] **轻量账户管理、设备会话吊销与共享/私人工作区隔离**：详见 [轻量账户管理、设备吊销与多工作区隔离指南](./TODO_AUTH_AND_WORKSPACE_GUIDE.md)——服务端新增 `scrypt` 密码哈希、SHA-256 Token 吊销、热加载运维 CLI（`server/src/cli.mjs`）及 `private:<userId>` 私有空间强隔离；桌面与移动端支持账号密码登录、设备管理、改密与工作区安全切换。

#### 阶段验收标准
- [ ] 在手机端浏览器访问 `http://<电脑局域网IP>:8787/?mode=mobile` 登录并拍照提交到指定看板列（含子任务拍照），开启桌面端「实时推送」后数秒内收到更新并显示缩略图，点开灯箱正常懒加载原图。

---

## 四、文档同步约定

每次开始或完成上述任意阶段时，请同步：

1. 将本文档与 [TODO 数据链路与桌面/移动端协同架构指南](./TODO_SYNC_AND_MOBILE_ARCHITECTURE.md) 对应 check-list 更新为 `[x]`，并在阶段概览表中更新状态与目标版本。
2. 同步补充/更新 [CHANGELOG.md](../../CHANGELOG.md)、[README.md](../../README.md)（如涉及新环境变量、部署依赖或数据结构变化）。
3. 重大改动先在 `task.md` / 实施计划中拆解后再动手编码，所有新增或变更的架构约束需先核对本文档红线及架构规范。
