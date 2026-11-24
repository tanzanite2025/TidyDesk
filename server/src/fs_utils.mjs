import fs from 'node:fs';
import path from 'node:path';

export const USER_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const WORKSPACE_ID_RE = /^[a-zA-Z0-9_:-]{1,64}$/;

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function sanitizeUserId(raw) {
  const trimmed = String(raw || '').trim();
  if (!USER_ID_RE.test(trimmed) || trimmed.toLowerCase() === 'local') {
    throw httpError(400, '账号 ID 无效（仅支持 1~64 位字母、数字、下划线和连字符，且不可为 local）');
  }
  return trimmed;
}

export function sanitizeWorkspaceId(raw, fallback = 'default') {
  const rawStr = raw === undefined || raw === null ? '' : String(raw).trim();
  const value = rawStr || fallback;
  if (!WORKSPACE_ID_RE.test(value)) {
    throw httpError(400, '工作区 ID 无效（仅支持 1~64 位字母、数字、下划线、连字符和冒号）');
  }
  if (value.startsWith('private:')) {
    const owner = value.slice('private:'.length);
    sanitizeUserId(owner);
  }
  return value;
}

export function getPrivateWorkspaceOwner(workspaceId) {
  if (!workspaceId || !workspaceId.startsWith('private:')) {
    return null;
  }
  return workspaceId.slice('private:'.length);
}

export function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}
