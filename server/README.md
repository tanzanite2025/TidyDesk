# TidyDesk Sync Server (MVP)

零外部 npm 依赖、基于 Node.js 22 原生运行的 TidyDesk 协同服务端 MVP，与桌面客户端 Phase 3 HTTPS 增量同步协议完全对齐；同时附带生产环境 PostgreSQL + MinIO Schema (`sql/schema.sql`) 与 `docker-compose.yml`。

## 本地一键启动

```bash
node server/src/index.mjs
```

默认监听 `http://0.0.0.0:8787`（支持同局域网手机端直连），先执行 `npm run build` 构建前端后，即可在手机或电脑浏览器直接访问移动端面板：
- 移动端 URL：`http://<电脑局域网IP>:8787/?mode=mobile`
- 账号 ID：`user_01`（如 `alice` / `bob`）
- 服务端 URL：`http://<电脑局域网IP>:8787`
- Token：任意非空字符串（或通过环境变量 `TIDYDESK_SYNC_TOKENS='{"user_01":"secret"}'` 严格校验）

## 运行自动化测试

```bash
node --test server/test/*.test.mjs
```

## 核心接口

- `GET /health`
- `POST /api/v1/auth/verify`（仅校验 Token 与 User ID）
- `GET /api/v1/sync/events?workspaceId=default`（SSE 实时变更推送流）
- `POST /api/v1/media/presign`（SHA-256 去重秒传检测）
- `PUT / GET /api/v1/media/blob/:kind/:key`（`thumb` / `original`）
- `POST /api/v1/sync/push`（含 `baseRevision` 冲突检测与成员级子任务/附件合并）
- `GET /api/v1/sync/pull?cursor=<seq>`（基于单调游标增量拉取）
