# TidyDesk 档位二：轻量账户管理、设备会话吊销与多工作区隔离指南

> **适用范围**：私有部署团队（5~30 人）、多手机/多电脑协同、需要账号密码登录与设备吊销能力但无需公网开放注册的场景。  
> **关联文档**：
> - [文档中心](../README.md)
> - [TODO 富媒体与多账号协同演进路线图](./TODO_MEDIA_AND_COLLAB_ROADMAP.md)
> - [TODO 数据链路与桌面/移动端协同架构指南](./TODO_SYNC_AND_MOBILE_ARCHITECTURE.md)
> - [服务端部署与接口说明](../../server/README.md)

---

## 一、设计定位与核心原则

相比单纯的静态环境变量白名单（档位一），**档位二**在不引入重量级邮箱注册、找回密码和第三方 npm 依赖的前提下，通过 **Node.js 22 原生 `node:crypto`** 为 [server/](../../server/README.md) 补齐完整的轻量账户生命周期能力：

1. **零开放注册面（安全基线）**：公网默认不提供自助注册接口，所有账号由管理员通过服务端 CLI（[server/src/cli.mjs](../../server/src/cli.mjs)）开通或签发。
2. **密码加盐哈希 + 只存 Token 摘要**：
   - 用户密码采用 `crypto.scryptSync` + 16 字节随机盐计算 64 字节摘要存储，验证使用 `crypto.timingSafeEqual`。
   - Bearer Token 仅在登录/签发时生成一次明文（`tdk_<64 hex>`）返回给客户端，服务端磁盘仅持久化其 **SHA-256 哈希**。
3. **登录与业务数据严格解耦**：
   - `POST /api/v1/auth/login` 与 `POST /api/v1/auth/verify` **只校验账号密码或 Token 合法性并签发会话元信息**，绝不在登录请求中夹带卡片、子任务、便签或附件数据。
4. **免重启热加载（Hot Reload）**：
   - 管理员使用 CLI 新增用户、禁用账号或吊销设备 Token 修改磁盘 `users-auth.json` 后，运行中的 HTTP 服务依据文件 `mtimeMs` 与大小自动重载生效，无需重启服务进程。
5. **共享空间与私人空间并存（工作区隔离）**：
   - 通过 `workspaceId` 区分共享看板（默认 `default`）与个人私人空间（约定 `private:<userId>`，服务端强制校验仅限本人读写，拒绝其他用户越权访问）。

---

## 二、服务端数据结构（`${TIDYDESK_DATA_DIR}/users-auth.json`）

```json
{
  "version": 1,
  "users": {
    "alice": {
      "userId": "alice",
      "displayName": "Alice",
      "passwordSalt": "<32-hex>",
      "passwordHash": "<128-hex>",
      "disabled": false,
      "createdAt": "1795490000000",
      "updatedAt": "1795490000000"
    }
  },
  "tokens": {
    "tok_abc123": {
      "tokenId": "tok_abc123",
      "userId": "alice",
      "tokenHash": "<64-hex-sha256>",
      "label": "iPhone 16 Pro",
      "createdAt": "1795490000000",
      "lastUsedAt": "1795490005000",
      "revokedAt": null
    }
  }
}
```

### 鉴权决策优先级

1. **环境变量静态白名单（`TIDYDESK_SYNC_TOKENS`）**：若匹配且账号在注册表中未被 `disabled`，直接放行（兼容原有容器/CI 运维注入）。
2. **注册表设备 Token（`users-auth.json`）**：将请求头 `Authorization: Bearer <token>` 做 SHA-256 摘要后在 `tokens` 中检索：
   - Token 不存在、已吊销（`revokedAt !== null`）或所属 `userId` 已禁用（`disabled === true`）→ 返回 `401`/`403`。
   - Token 绑定用户与请求头 `X-TidyDesk-User` 不一致 → 返回 `401`。
3. **无白名单开发模式兜底（`allowAnyDevToken`）**：
   - 仅当 `NODE_ENV !== 'production'` **且** 既未设置 `TIDYDESK_SYNC_TOKENS` **且** `users-auth.json` 尚无任何注册用户时启用。
   - 一旦管理员通过 CLI 创建了首个账号，服务自动进入严格鉴权状态，不再接受未登记的随机账号接入。

---

## 三、HTTP API 增量契约

| 方法 | 路径 | 鉴权要求 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/login` | 公开（账号+密码） | 校验 `{ userId, password, deviceLabel? }`，签发设备 Token（`token`, `tokenId`, `displayName`），不返回任何业务数据 |
| `POST` | `/api/v1/auth/verify` | Bearer Token | 校验 Token 与 `userId` 并确认目标 `workspaceId` 权限（已接入既有路径） |
| `POST` | `/api/v1/auth/logout` | Bearer Token | 立即吊销当前请求携带的设备 Token（环境变量静态 Token 不可被接口吊销，返回提示） |
| `POST` | `/api/v1/auth/password` | Bearer Token | 校验 `oldPassword` 后更新当前用户密码（`newPassword`） |
| `GET` | `/api/v1/auth/sessions` | Bearer Token | 列出当前账号名下的设备会话列表（`tokenId`, `label`, `createdAt`, `lastUsedAt`, `revokedAt`, `isCurrent`） |
| `POST` | `/api/v1/auth/sessions/revoke` | Bearer Token | 吊销当前账号下指定的 `tokenId`（只能吊销本人会话，跨用户返回 `403`） |
| `GET` | `/api/v1/workspaces` | Bearer Token | 返回当前用户可访问的工作区列表元信息（默认 `default` 共享区、个人 `private:<userId>`、已加入且无越权的工作区） |

### 私人工作区权限红线

- 任何形如 `private:<ownerId>` 的 `workspaceId`：
  - 当请求者 `userId === ownerId` 时，自动确保为其 `'owner'` 角色。
  - 当 `userId !== ownerId` 时，无论请求读、写、推、拉或 SSE 订阅，均直接返回 **`403 Forbidden`**，禁止借由工作区 ID 枚举或越权访问他人私人待办。

---

## 四、运维管理 CLI（`server/src/cli.mjs`）

在部署目录下零依赖运行，所有变更实时持久化到 `${TIDYDESK_DATA_DIR}/users-auth.json`（运行中的服务端自动热感知，无需重启）：

```bash
# 1. 新增用户并设置初始密码（可附加 --issue-token 同时输出一条设备 Token）
node server/src/cli.mjs useradd alice --password "StrongPassword123!" --name "Alice" --issue-token

# 2. 修改用户密码（可选 --revoke-all 同步吊销所有旧设备会话）
node server/src/cli.mjs passwd alice --password "NewPassword456!" --revoke-all

# 3. 签发/查看/吊销设备 Token（不暴露已存在 Token 明文）
node server/src/cli.mjs token-issue bob --label "iPhone"
node server/src/cli.mjs token-revoke tok_abc123
node server/src/cli.mjs list

# 4. 禁用或重新启用账号（禁用会一并拒绝对该账号全部 Token 的校验）
node server/src/cli.mjs disable bob
node server/src/cli.mjs enable bob
```

---

## 五、桌面端与移动端演进设计

### 1. 数据模型与跨工作区安全隔离
- `AccountSessionSnapshot`、`StoredAccountSession`、`StoredAccountSyncProfile`、`SyncStatusSnapshot` 与前端 `SwitchAccountSessionInput` 统一新增 `workspaceId?: string`（默认 `"default"`）。
- `HttpSyncClient`（[http_transport.rs](../../src-tauri/src/sync/http_transport.rs)）与后台 SSE（[realtime.rs](../../src-tauri/src/sync/realtime.rs)）将原本硬编码的 `"default"` 改为读取会话 `workspaceId`。
- **桌面端切换工作区防串库守卫**：若用户在同一个账号下切换 `workspaceId`（例如从 `default` 切到 `private:alice`）：
  - 若当前本地 `sync-outbox.json` 仍有未提交变更，**显式阻断报错**，要求用户先执行一次同步或清空队列，防止把旧工作区的待办变更误推送到新工作区。
  - 队列清空后切换 `workspaceId`，自动重置 `lastSyncCursor` 并清空当前工作区本地待办索引与内容缓存，由用户手动或实时同步从新工作区干净拉取。

### 2. 登录体验升级（兼容密码登录与静态 Token）
- **桌面端**（[AccountSyncCard.tsx](../../src/components/settings/AccountSyncCard.tsx) + Rust `accounts_login_with_password`）：
  - 新增「账号密码登录」与「Token 凭据接入」两种模式切换。
  - 密码登录在 Rust 侧直接请求 `POST /api/v1/auth/login`，拿回设备 Token 后由 Windows DPAPI 加密写入 `token.dpapi`，不将明文 Token 留在前端 JS 持久化层。
  - 支持在配置区展示并切换当前工作区（共享空间 `default` / 个人空间 `private:<userId>` / 自定义空间 ID），以及修改当前账号密码或查看已登录设备列表。
- **移动端 H5**（[MobileTodoApp.tsx](../../src/modules/mobile/MobileTodoApp.tsx) + [web-http-adapter.ts](../../src/native/web-http-adapter.ts)）：
  - 登录页默认支持「密码登录」与「Token 登录」双模式，并支持直接选择登录目标工作区（共享看板 vs 私人看板）。
  - 移动端点击退出登录时调用 `POST /api/v1/auth/logout` 主动吊销服务端当前浏览器会话 Token，避免旧会话残留。
