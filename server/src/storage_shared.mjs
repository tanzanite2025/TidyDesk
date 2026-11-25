import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SAFE_KEY_RE = /^[a-zA-Z0-9._-]{1,128}$/;
export const BLOB_SHA_RE = /^(?:thumb|orig)_([a-fA-F0-9]{64})\.[a-z0-9]+$/;

export function validateBlobKey(kind, key) {
  if ((kind !== 'thumb' && kind !== 'original') || !SAFE_KEY_RE.test(key) || key.startsWith('.')) {
    throw new Error('Invalid media blob key');
  }
}

export function extractLegacyScopedRecords(legacyObj) {
  const map = new Map();
  if (!legacyObj || typeof legacyObj !== 'object') return [];
  for (const [rawKey, record] of Object.entries(legacyObj)) {
    if (!record || typeof record !== 'object') continue;
    const colonIdx = rawKey.indexOf(':');
    let workspaceId = record.workspaceId || 'default';
    let entityId = record.id || rawKey;
    if (colonIdx > 0) {
      const prefix = rawKey.slice(0, colonIdx);
      const rest = rawKey.slice(colonIdx + 1);
      if (rawKey.startsWith('private:')) {
        const secondColon = rawKey.indexOf(':', 'private:'.length);
        if (secondColon > 0) {
          workspaceId = rawKey.slice(0, secondColon);
          entityId = rawKey.slice(secondColon + 1);
        }
      } else if (prefix === workspaceId || !record.workspaceId) {
        workspaceId = prefix;
        entityId = rest;
      }
    }
    const dedupKey = `${workspaceId}:${entityId}`;
    if (!map.has(dedupKey)) {
      map.set(dedupKey, { workspaceId, entityId, record });
    }
  }
  return Array.from(map.values());
}

export function extractShaFromBlobKey(key) {
  const match = String(key || '').match(BLOB_SHA_RE);
  return match ? match[1].toLowerCase() : null;
}

export function safeBlobPath(blobsDir, kind, key) {
  try {
    validateBlobKey(kind, key);
  } catch {
    return null;
  }
  const target = path.resolve(blobsDir, kind, key);
  const parent = path.resolve(blobsDir, kind);
  if (!target.startsWith(parent + path.sep)) return null;
  return target;
}

export function writeBlobFileAtomic(blobsDir, kind, key, buffer) {
  const target = safeBlobPath(blobsDir, kind, key);
  if (!target) {
    throw new Error('Invalid media blob key');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmpPath = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, target);
  return extractShaFromBlobKey(key);
}

export function readBlobFromDisk(blobsDir, kind, key) {
  const target = safeBlobPath(blobsDir, kind, key);
  if (!target || !fs.existsSync(target)) return null;
  return fs.readFileSync(target);
}

export function sha256Hex(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

export function hashPassword(password, saltHex) {
  return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

export function timingSafeHexEqual(aHex, bHex) {
  if (!aHex || !bHex || aHex.length !== bHex.length) return false;
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function archiveLegacyJsonFile(filePath, suffix = '.pre-sqlite.bak') {
  if (!fs.existsSync(filePath)) return null;
  let backupPath = `${filePath}${suffix}`;
  if (fs.existsSync(backupPath)) {
    backupPath = `${filePath}.${Date.now()}${suffix}`;
  }
  fs.renameSync(filePath, backupPath);
  return backupPath;
}
