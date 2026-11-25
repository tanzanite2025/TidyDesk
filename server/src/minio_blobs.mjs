import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readBlobFromDisk, safeBlobPath, writeBlobFileAtomic } from './storage_shared.mjs';

function sha256HexBuf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hmacBuf(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function formatAmzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8)
  };
}

function encodeS3Path(objectPath) {
  return objectPath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

/**
 * Build AWS Signature Version 4 headers for MinIO / S3 path-style requests with zero SDK dependencies.
 */
export function signS3Request({
  method,
  endpoint,
  objectPath,
  accessKey,
  secretKey,
  region = 'us-east-1',
  body = Buffer.alloc(0),
  contentType = null,
  now = new Date()
}) {
  const url = new URL(endpoint);
  const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const cleanRel = String(objectPath || '').replace(/^\/+/, '');
  const canonicalUri = `${basePath}/${encodeS3Path(cleanRel)}`;
  const targetUrl = `${url.origin}${canonicalUri}`;

  const { amzDate, dateStamp } = formatAmzDates(now);
  const payloadHash = sha256HexBuf(body);
  const hostHeader = url.host;

  const headerPairs = [
    ['host', hostHeader],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate]
  ];
  if (contentType) {
    headerPairs.push(['content-type', contentType]);
  }
  headerPairs.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = headerPairs.map(([k, v]) => `${k}:${String(v).trim()}\n`).join('');
  const signedHeaders = headerPairs.map(([k]) => k).join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256HexBuf(Buffer.from(canonicalRequest, 'utf8'))
  ].join('\n');

  const kDate = hmacBuf(Buffer.from(`AWS4${secretKey}`, 'utf8'), dateStamp);
  const kRegion = hmacBuf(kDate, region);
  const kService = hmacBuf(kRegion, 's3');
  const kSigning = hmacBuf(kService, 'aws4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    Authorization: authorization,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return { targetUrl, headers };
}

export function resolveMinioConfigFromEnv(overrides = {}) {
  const endpoint = overrides.endpoint ?? process.env.TIDYDESK_MINIO_ENDPOINT ?? '';
  const trimmed = String(endpoint).trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  const accessKey = String(
    overrides.accessKey ??
      process.env.TIDYDESK_MINIO_ACCESS_KEY ??
      process.env.MINIO_ROOT_USER ??
      ''
  ).trim();
  const secretKey = String(
    overrides.secretKey ??
      process.env.TIDYDESK_MINIO_SECRET_KEY ??
      process.env.MINIO_ROOT_PASSWORD ??
      ''
  ).trim();
  if (!accessKey || !secretKey) {
    throw new Error(
      '[CRITICAL] 已配置 TIDYDESK_MINIO_ENDPOINT，但缺少 TIDYDESK_MINIO_ACCESS_KEY / TIDYDESK_MINIO_SECRET_KEY'
    );
  }
  const bucket = String(overrides.bucket ?? process.env.TIDYDESK_MINIO_BUCKET ?? 'tidydesk-blobs').trim();
  const region = String(overrides.region ?? process.env.TIDYDESK_MINIO_REGION ?? 'us-east-1').trim();
  return { endpoint: trimmed, bucket, accessKey, secretKey, region };
}

export function createMinioBlobStore(config, { fetchImpl = fetch } = {}) {
  let bucketEnsured = false;

  async function s3Fetch(method, objectPath, { body = Buffer.alloc(0), contentType = null } = {}) {
    const { targetUrl, headers } = signS3Request({
      method,
      endpoint: config.endpoint,
      objectPath,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region,
      body,
      contentType
    });
    return fetchImpl(targetUrl, {
      method,
      headers,
      body: method === 'PUT' || method === 'POST' ? body : undefined
    });
  }

  async function ensureBucket() {
    if (bucketEnsured) return;
    const head = await s3Fetch('HEAD', `${config.bucket}`);
    if (head.status === 404) {
      const createRes = await s3Fetch('PUT', `${config.bucket}`);
      if (!createRes.ok && createRes.status !== 409) {
        const text = await createRes.text().catch(() => '');
        throw new Error(
          `[CRITICAL] 创建 MinIO 存储桶 "${config.bucket}" 失败 (${createRes.status}): ${text}`
        );
      }
    } else if (!head.ok) {
      throw new Error(`[CRITICAL] 检查 MinIO 存储桶 "${config.bucket}" 失败 (${head.status})`);
    }
    bucketEnsured = true;
  }

  function objectPath(kind, key) {
    return `${config.bucket}/${kind}/${key}`;
  }

  return {
    mode: 'minio',
    bucket: config.bucket,
    ensureReady: ensureBucket,
    async hasBlobPair(thumbKey, origKey) {
      await ensureBucket();
      const [thumbHead, origHead] = await Promise.all([
        s3Fetch('HEAD', objectPath('thumb', thumbKey)),
        s3Fetch('HEAD', objectPath('original', origKey))
      ]);
      return thumbHead.ok && origHead.ok;
    },
    async writeBlob(kind, key, buffer, contentType = 'application/octet-stream') {
      await ensureBucket();
      const res = await s3Fetch('PUT', objectPath(kind, key), {
        body: buffer,
        contentType
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`[CRITICAL] 写入 MinIO 对象 ${kind}/${key} 失败 (${res.status}): ${text}`);
      }
    },
    async readBlob(kind, key) {
      await ensureBucket();
      const res = await s3Fetch('GET', objectPath(kind, key));
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`[CRITICAL] 读取 MinIO 对象 ${kind}/${key} 失败 (${res.status})`);
      }
      return Buffer.from(await res.arrayBuffer());
    }
  };
}

export function createDiskBlobStore(dataDir) {
  const blobsDir = path.join(path.resolve(dataDir), 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });
  return {
    mode: 'disk',
    blobsDir,
    async ensureReady() {},
    async hasBlobPair(thumbKey, origKey) {
      const thumbPath = safeBlobPath(blobsDir, 'thumb', thumbKey);
      const origPath = safeBlobPath(blobsDir, 'original', origKey);
      return Boolean(thumbPath && origPath && fs.existsSync(thumbPath) && fs.existsSync(origPath));
    },
    async writeBlob(kind, key, buffer) {
      writeBlobFileAtomic(blobsDir, kind, key, buffer);
    },
    async readBlob(kind, key) {
      return readBlobFromDisk(blobsDir, kind, key);
    }
  };
}
