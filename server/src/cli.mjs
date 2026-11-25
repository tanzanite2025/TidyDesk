#!/usr/bin/env node
import path from 'node:path';
import { createServerStorage } from './storage_factory.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printUsage() {
  console.log(`TidyDesk Sync Admin CLI

用法:
  node server/src/cli.mjs useradd <userId> --password <pwd> [--name <显示名>] [--issue-token] [--label <设备标签>]
  node server/src/cli.mjs passwd <userId> --password <newPwd> [--revoke-all]
  node server/src/cli.mjs disable <userId>
  node server/src/cli.mjs enable <userId>
  node server/src/cli.mjs token-issue <userId> [--label <设备标签>]
  node server/src/cli.mjs token-revoke <tokenId>
  node server/src/cli.mjs workspace-role <workspaceId> <userId> <owner|admin|member|viewer>
  node server/src/cli.mjs list

环境变量:
  TIDYDESK_DATA_DIR       数据目录，默认 ./server/data
  TIDYDESK_STORE_DRIVER   存储引擎: sqlite（默认）、json（回退）或 postgres
  TIDYDESK_PG_URL         PostgreSQL 连接串（driver=postgres 时使用）
`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  if (!cmd || flags.help) {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }

  const dataDir = process.env.TIDYDESK_DATA_DIR || path.resolve(process.cwd(), 'server', 'data');
  const storage = createServerStorage(dataDir, {
    driver: typeof flags.driver === 'string' ? flags.driver : undefined
  });
  const { userRegistry: users, store } = storage;

  try {
    switch (cmd) {
      case 'useradd': {
        const userId = rest[0];
        const password = flags.password;
        if (!userId || typeof password !== 'string') {
          throw new Error('useradd 需要 <userId> 与 --password <pwd>');
        }
        const created = await users.createUser({
          userId,
          password,
          displayName: typeof flags.name === 'string' ? flags.name : ''
        });
        console.log(`✅ 已创建账号: ${created.userId} (${created.displayName})`);
        if (flags['issue-token']) {
          const issued = await users.issueToken({
            userId: created.userId,
            label: typeof flags.label === 'string' ? flags.label : 'cli-initial'
          });
          console.log(`🔑 设备 Token (${issued.tokenId}): ${issued.token}`);
        }
        break;
      }
      case 'passwd': {
        const userId = rest[0];
        const password = flags.password;
        if (!userId || typeof password !== 'string') {
          throw new Error('passwd 需要 <userId> 与 --password <newPwd>');
        }
        await users.setPassword({
          userId,
          newPassword: password,
          revokeAll: Boolean(flags['revoke-all'])
        });
        console.log(`✅ 已更新 ${userId} 密码${flags['revoke-all'] ? '并吊销全部旧会话' : ''}`);
        break;
      }
      case 'disable': {
        const userId = rest[0];
        if (!userId) throw new Error('disable 需要 <userId>');
        await users.setUserDisabled(userId, true);
        console.log(`⛔ 已禁用账号 ${userId} 并吊销其活跃设备会话`);
        break;
      }
      case 'enable': {
        const userId = rest[0];
        if (!userId) throw new Error('enable 需要 <userId>');
        await users.setUserDisabled(userId, false);
        console.log(`✅ 已重新启用账号 ${userId}`);
        break;
      }
      case 'token-issue': {
        const userId = rest[0];
        if (!userId) throw new Error('token-issue 需要 <userId>');
        const issued = await users.issueToken({
          userId,
          label: typeof flags.label === 'string' ? flags.label : 'cli'
        });
        console.log(`🔑 已为 ${issued.userId} 签发设备凭据 (${issued.tokenId}): ${issued.token}`);
        break;
      }
      case 'token-revoke': {
        const tokenId = rest[0];
        if (!tokenId) throw new Error('token-revoke 需要 <tokenId>');
        const rev = await users.revokeTokenById({ tokenId, isAdmin: true });
        console.log(`🗑️ 已吊销 ${rev.userId} 的设备会话 ${rev.tokenId}`);
        break;
      }
      case 'workspace-role': {
        const [workspaceId, userId, role] = rest;
        if (!workspaceId || !userId || !role) {
          throw new Error('workspace-role 需要 <workspaceId> <userId> <owner|admin|member|viewer>');
        }
        const validRoles = ['owner', 'admin', 'member', 'viewer'];
        if (!validRoles.includes(role)) {
          throw new Error(`无效角色: ${role}`);
        }
        await store.setWorkspaceRole(workspaceId, userId, role);
        console.log(`✅ 已设置工作区 ${workspaceId} 成员 ${userId} 角色为 ${role}`);
        break;
      }
      case 'list': {
        const entries = await users.listUsersAndSessions();
        if (entries.length === 0) {
          console.log('（暂无持久化注册用户）');
          break;
        }
        for (const entry of entries) {
          const activeCount = entry.sessions.filter(s => !s.revokedAt).length;
          console.log(
            `- ${entry.userId} (${entry.displayName}) | 状态=${entry.disabled ? '已禁用' : '正常'} | 活跃设备=${activeCount}`
          );
          for (const sess of entry.sessions) {
            console.log(
              `    • ${sess.tokenId} [${sess.label}] ${sess.revokedAt ? '(已吊销)' : '(活跃)'}`
            );
          }
        }
        break;
      }
      default:
        throw new Error(`未知命令: ${cmd}`);
    }
  } finally {
    await storage.close();
  }
}

main().catch(err => {
  console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
