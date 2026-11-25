# TidyDesk Sync Server (MVP)

零外部 npm 依赖、基于 Node.js 22 原生运行的 TidyDesk 协同服务端（Phase 1 起默认内置 `node:sqlite` WAL 事务数据库 `tidydesk-sync.db`，支持通过 `TIDYDESK_STORE_DRIVER=json` 秒级回退至 JSON 存储，并会在首次升级时自动将既有 `sync-db.json` / `users-auth.json` 事务导入并备份为 `.pre-sqlite.bak`）；同时附带生产环境 PostgreSQL + MinIO Schema (`sql/schema.sql`) 与 `docker-compose.yml`。

## 本地一键启动

### 方式 A：使用 GitHub Release 一体部署包（无需手动构建前端）
从 GitHub Releases 下载并解压 `tidydesk-sync-server-v<version>.zip` 后，直接双击 `start.bat`（Windows）或在目录内运行：

```bash
node src/index.mjs
```

压缩包已内置预编译的 `dist/` 移动端 PWA 静态资源，服务会自动发现并托管 `/?mode=mobile` 与 `/manifest.webmanifest`。

### 方式 B：从代码仓库启动

```bash
npm run build
node server/src/index.mjs
```

默认监听 `http://0.0.0.0:8787`（支持同局域网手机端直连），启动后即可在手机或电脑浏览器直接访问移动端面板：
- 移动端 URL：`http://<电脑局域网IP>:8787/?mode=mobile`（支持在 iOS Safari / Android Chrome 点击「添加到主屏幕」作为独立 PWA 应用运行）
- 账号 ID：`user_01`（如 `alice` / `bob`）
- 服务端 URL：`http://<电脑局域网IP>:8787`
- Token：任意非空字符串（或通过环境变量 `TIDYDESK_SYNC_TOKENS='{"user_01":"secret"}'` 严格校验）

## 账号、密码与设备管理（CLI 免重启热生效）

服务端支持**密码登录换取随机设备 Token**，所有密码均以加盐 `scrypt` 落盘，Token 在服务端仅保留 SHA-256 哈希，且修改后会由运行中服务端自动热加载（详细机制见 [轻量账户管理与多工作区隔离指南](../docs/development/TODO_AUTH_AND_WORKSPACE_GUIDE.md)）：

```bash
# 创建用户并设置密码
node server/src/cli.mjs useradd alice --password "YourStrongPassword!" --name "Alice"

# 修改密码（可选同时吊销全部已签发设备）
node server/src/cli.mjs passwd alice --password "NewPassword!" --revoke-all

# 查看所有账号与活跃设备会话、吊销指定设备或禁用账号
node server/src/cli.mjs list
node server/src/cli.mjs token-revoke tok_xxxx
node server/src/cli.mjs disable bob
```

## 运行自动化测试

```bash
node --test server/test/*.test.mjs
```

## 核心接口

- `GET /health`
- `POST /api/v1/auth/login`（账号 + 密码校验后签发随机设备 Token，不耦合业务数据）
- `POST /api/v1/auth/verify`（仅校验 Token、User ID 与目标工作区权限）
- `POST /api/v1/auth/logout`（吊销当前设备 Token）
- `POST /api/v1/auth/password`、`GET /api/v1/auth/sessions`、`POST /api/v1/auth/sessions/revoke`
- `GET /api/v1/workspaces`（列出当前用户共享 `default` 与私人 `private:<userId>` 工作区）
- `GET /api/v1/sync/events?workspaceId=<id>`（SSE 实时变更推送流）
- `POST /api/v1/media/presign`（SHA-256 去重秒传检测）
- `PUT / GET /api/v1/media/blob/:kind/:key`（`thumb` / `original`）
- `POST /api/v1/sync/push`（含 `baseRevision` 冲突检测与成员级子任务/附件合并）
- `GET /api/v1/sync/pull?workspaceId=<id>&cursor=<seq>`（基于单调游标增量拉取）
