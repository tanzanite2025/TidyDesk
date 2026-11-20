# TidyDesk TODO 富媒体与多账号服务端协同演进路线图

> **定位**：作为 TidyDesk 从“单机整理工具（v3.5.0）”向“Trello 式拍照/附件看板 + 服务端多账号协同”演进的长期施工清单。每完成一个阶段，请同步勾选对应检查项并更新阶段状态与关联提交记录。
>
> **最后更新**：2026-11-19（对应基线版本 `v3.5.0`）

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
| **Phase 1** | 单机 Trello 式拍照 / 图片附件 TODO 看板 | 🚧 代码已完成（待实机验收） | 下一发布版本 |
| **Phase 2** | 多账号本地隔离与协同数据模型补齐 | ⬜ 未开始 | 联网前置准备 |
| **Phase 3** | 最小可用服务端与离线优先增量同步 | ⬜ 未开始 | 服务端上线 MVP |
| **Phase 4** | 实时协同推送与 Web / 移动端拍照扩展 | ⬜ 未开始 | 多端实时协同 |

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
  - `attachments`: `Array<{ id, kind: 'image', originalName, fileName, thumbFileName, width, height, sizeBytes, mimeType, createdAt }>`
  - `coverAttachmentId`: `string | null`（看板列表封面图引用）
  - （注：独立结构化 `checklist` 待后续按需扩展，当前继续支持卡片 Markdown 任务项 `- [ ]`）
- [x] 在 `src-tauri/src/todos/attachments.rs` 建立卡片附件目录：`app_data_dir()/todos/attachments/<card_id>/`（原图 + 最大边 360px 缩略图 `thumb_<att_id>.png`）。
- [x] 更新 `todos_delete_card`（`src-tauri/src/todos/commands.rs`）：采用“隔离重命名附件目录 → 更新 `boards.json` → 物理清理”两阶段删除，杜绝孤儿图片残留在磁盘。

#### 1.2 协议扩展与按需加载
- [x] 在 `src-tauri/src/asset_protocol.rs` 新增 `TodoAttachment` 安全路由（严格校验 `<card_id>` 与文件名白名单，拒绝 `..` 路径穿越），通过 `tidydesk-asset://localhost/todos/<card_id>/<file>` 输出。
- [x] 新增 `todos_get_card_detail` 按需读取单卡详情，并使看板卡片列表瓷砖 `TodoCardTile.tsx` 仅渲染 `coverThumbUrl` 360px 缩略图。
- [ ] 如后续需要本地音视频附件回放，在 `src-tauri/tauri.conf.json` 的 `media-src` 同步放行 `tidydesk-asset: http://tidydesk-asset.localhost`。

#### 1.3 拍照、截图与本地上传入口
- [x] **本地图片/粘贴导入**：支持原生文件选择框导入（PNG/JPG/WebP）及编辑区 `Ctrl+V` 粘贴图片，Rust 后端转存并生成 360px 缩略图。
- [x] **截屏直接生成任务图**：复用 `capture/screen_gdi.rs` + `SnipOverlayApp.tsx`（`SnipTarget::TodoCard`），完成或取消均可靠恢复 `todos` 窗口并广播 `todos-updated`。
- [x] **摄像头拍照任务**：前端基于 `<video>` + `getUserMedia` + `<canvas>` 实现 `TodoCameraModal.tsx`（含多摄像头切换、重拍与退出停轨释放，拒权/无设备显式提示）。

#### 1.4 阶段验收标准
- [ ] 实机桌面验收（`npm run dev`）：在真实 Windows 环境验证 WebView2 摄像头权限、多图卡片拖拽滚动与删卡磁盘清理。
- [x] 补齐 `asset_protocol` `TodoAttachment` 路由单测与 `todos::attachments` 缩略图/异常校验单测，`npm run check`、`tsc --noUnusedLocals --noUnusedParameters`、`cargo check --features e2e-tests` 与 `cargo test`（22/22）全量通过。

---

### Phase 2：客户端多账号隔离与协同数据模型补齐

> **核心目标**：把单机数据库目录和数据结构改造成“可多账号切换、可与服务端合并同步”的客户端基线，暂不强制联网。

- [ ] **账号级数据目录隔离**：引入本地账号上下文目录 `app_data_dir()/accounts/<user_id>/todos/` 与 `quick-notes.json`，支持本地访客目录向已登录账号目录的安全迁移与多账号切换隔离。
- [ ] **全局唯一主键升级**：将卡片、附件、清单项新建 ID 统一改为 UUID v4 / v7，替换当前的 `prefix-timestamp-pid`。
- [ ] **并发协同元数据补齐**：
  - 为 Board / Card / Attachment 增加 `revision`（版本修订号）、`updatedBy`、`deletedAt`（软删除墓碑时间戳）。
  - 看板列内排序由整列 `cardOrder` 数组升级为单卡可独立调整的分数排序键（Fractional Indexing / LexoRank），避免多人同时拖拽互相覆盖整列顺序。
- [ ] **离线变更发件箱（Outbox）设计**：定义本地待同步操作日志表（记录增量 mutation + 文件待上传队列），保证断网状态所有编辑/拍照零延迟写入本地。

#### 阶段验收标准
- [ ] 同机切换两个模拟账号后，各自 TODO 数据、附件目录与便签互不可见、互不污染。
- [ ] 软删除与分数排序具备完整 Rust 单元测试覆盖。

---

### Phase 3：最小可用协同服务端与异步增量同步

> **核心目标**：部署后端服务，实现多账号鉴权、工作空间权限隔离、图片对象存储直传，以及客户端与服务端之间的离线优先增量同步。

#### 3.1 服务端建设（建议 Docker Compose 一体化部署）
- [ ] **API 服务**：轻量 HTTP + WebSocket 后端（Rust Axum / Go / Node 均可），提供以下核心能力：
  - **认证（Auth）**：登录验证（仅校验 Token 与 User ID，颁发短期 Access Token + Refresh Token）。
  - **多租户与权限矩阵（RBAC）**：Workspace / 成员角色（Owner / Admin / Member / Viewer）与 Board 访问权限唯一校验。
  - **协同数据存储（PostgreSQL）**：`users`、`workspaces`、`workspace_members`、`boards`、`columns`、`cards`、`attachments`、`sync_events` 表，使用服务端单调递增游标（Sync Cursor）支持增量拉取。
- [ ] **对象存储（MinIO 私有化 / S3 / OSS）**：
  - 服务端签发附件上传与下载预签名 URL，客户端直传原图与缩略图。
  - 上传完成后向业务接口提交校验信息（`objectKey`、`sha256`、`size`、`width`、`height`）。
- [ ] **反向代理与运维**：Nginx / Caddy 托管 HTTPS + WSS，可选同一静态站点托管内网版安装包与 `latest.json`。

#### 3.2 客户端同步引擎接入（Rust 侧）
- [ ] 新增 `src-tauri/src/sync/` 模块：在 Rust 层统一发起云端 HTTPS 同步与附件直传，保持前端 WebView CSP 最小权限面。
- [ ] 实现同步循环：启动后异步全量/游标对齐（不阻塞 UI 启动与把手/抽屉就绪）→ 本地 Outbox 变更防抖推送 → 冲突检测（以 `revision` 校验，保留冲突副本或明确提示用户）。
- [ ] 扩展 `asset_protocol.rs`：TODO 附件访问优先命中本地 `accounts/<user_id>/todos/attachments/` 缓存，未命中时由 Rust 从服务端预签名 URL 拉取缩略图/原图并回写本地缓存。

#### 阶段验收标准
- [ ] 两台电脑登录不同账号加入同一 Workspace：A 创建拍照任务卡片并拖拽列位置，B 重连或同步后完整呈现缩略图、原图与列顺序。
- [ ] 断网状态下 A 正常拍照与建卡，恢复联网后 Outbox 自动补传成功。

---

### Phase 4：实时协同推送与 Web / 移动端拍照扩展

> **核心目标**：打通秒级实时协同体验，并复用现有前端架构支持浏览器 / 手机端直接拍照提交任务。

- [ ] **WebSocket / SSE 实时广播**：服务端在提交增量变更后，按 `workspace_id` / `board_id` 房间推送轻量变更通知；在线桌面端通过 Rust WebSocket 客户端接收并局部增量刷新状态与角标。
- [ ] **Web / H5 浏览器适配器**：基于现有 `src/native/native-client.ts` 抽象新增 `web-http-adapter.ts`，使 `TodoPanel` 与拍照任务流程可直接打包为 Web 应用运行在手机或浏览器端（不依赖 Tauri 壳），实现“手机浏览器拍照进 TODO → 电脑端 TidyDesk 桌面秒级同步看到”。

#### 阶段验收标准
- [ ] 在局域网/公网手机浏览器登录账号并拍照提交到指定看板列，Windows 桌面端在数秒内收到推送并显示新卡片与封面缩略图。

---

## 四、文档同步约定

每次开始或完成上述任意阶段时，请同步：

1. 将本文档对应 check-list 更新为 `[x]`，并在阶段概览表中更新状态与目标版本。
2. 同步补充/更新 [CHANGELOG.md](../../CHANGELOG.md)、[README.md](../../README.md)（如涉及新环境变量、部署依赖或数据结构变化）。
3. 重大改动先在 `task.md` / 实施计划中拆解后再动手编码，所有新增或变更的架构约束需先核对本文档红线。
