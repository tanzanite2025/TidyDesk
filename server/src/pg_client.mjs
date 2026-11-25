import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

const PG_PROTOCOL_VERSION = 196608; // 3.0

function encodeInt32(value) {
  const buf = Buffer.allocUnsafe(4);
  buf.writeInt32BE(value, 0);
  return buf;
}

function encodeInt16(value) {
  const buf = Buffer.allocUnsafe(2);
  buf.writeInt16BE(value, 0);
  return buf;
}

function buildFrontendMessage(typeChar, payloadBuf) {
  const header = Buffer.allocUnsafe(5);
  header.writeUInt8(typeChar.charCodeAt(0), 0);
  header.writeInt32BE(payloadBuf.length + 4, 1);
  return Buffer.concat([header, payloadBuf]);
}

function buildStartupPacket(user, database) {
  const parts = [encodeInt32(PG_PROTOCOL_VERSION)];
  const pairs = [
    ['user', user],
    ['database', database],
    ['client_encoding', 'UTF8'],
    ['application_name', 'tidydesk-sync-server']
  ];
  for (const [k, v] of pairs) {
    parts.push(Buffer.from(`${k}\0${v}\0`, 'utf8'));
  }
  parts.push(Buffer.from([0]));
  const body = Buffer.concat(parts);
  return Buffer.concat([encodeInt32(body.length + 4), body]);
}

function parseErrorFields(payload) {
  const fields = {};
  let offset = 0;
  while (offset < payload.length) {
    const code = payload.readUInt8(offset);
    offset += 1;
    if (code === 0) break;
    const nul = payload.indexOf(0, offset);
    if (nul < 0) break;
    fields[String.fromCharCode(code)] = payload.toString('utf8', offset, nul);
    offset = nul + 1;
  }
  const msg = fields.M || 'PostgreSQL protocol error';
  const detail = fields.D ? ` (${fields.D})` : '';
  const err = new Error(`${msg}${detail}`);
  err.pgCode = fields.C;
  return err;
}

function xorBuffers(a, b) {
  const out = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function hiPbkdf2(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
}

function parseScramAttributes(text) {
  const map = {};
  for (const part of text.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      map[part.slice(0, eq)] = part.slice(eq + 1);
    }
  }
  return map;
}

function decodeCellValue(text, oid) {
  if (text === null) return null;
  if (oid === 16) return text === 't' || text === 'true';
  if (oid === 20 || oid === 21 || oid === 23) {
    const num = Number(text);
    return Number.isSafeInteger(num) ? num : text;
  }
  if (oid === 114 || oid === 3802) {
    return JSON.parse(text);
  }
  return text;
}

export function parsePostgresUrl(pgUrl) {
  const raw = String(pgUrl || '').trim();
  if (!raw) {
    throw new Error('[CRITICAL] 未配置 PostgreSQL 连接字符串 (TIDYDESK_PG_URL)');
  }
  const parsed = new URL(raw);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`[CRITICAL] 无效的 PostgreSQL 协议: ${parsed.protocol}`);
  }
  const sslMode = (parsed.searchParams.get('sslmode') || '').toLowerCase();
  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent((parsed.pathname || '/postgres').replace(/^\/+/, '') || 'postgres'),
    ssl: sslMode === 'require' || sslMode === 'verify-full' || sslMode === 'verify-ca'
  };
}

class PgConnection {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.closed = false;
    this.lastError = null;
    this.txStatus = 'I';
  }

  _rejectAll(err) {
    this.lastError = err;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter.reject(err);
    }
  }

  _tryDrainMessages() {
    while (this.waiters.length > 0 && this.buffer.length >= 5) {
      const len = this.buffer.readInt32BE(1);
      if (len < 4) {
        this._rejectAll(new Error(`Invalid PostgreSQL packet length: ${len}`));
        return;
      }
      if (this.buffer.length < 1 + len) return;
      const typeChar = String.fromCharCode(this.buffer.readUInt8(0));
      const payload = this.buffer.subarray(5, 1 + len);
      this.buffer = this.buffer.subarray(1 + len);
      const waiter = this.waiters.shift();
      waiter.resolve({ type: typeChar, payload });
    }
  }

  _nextMessage() {
    if (this.lastError) return Promise.reject(this.lastError);
    if (this.closed) return Promise.reject(new Error('PostgreSQL connection closed'));
    if (this.buffer.length >= 5) {
      const len = this.buffer.readInt32BE(1);
      if (this.buffer.length >= 1 + len) {
        const typeChar = String.fromCharCode(this.buffer.readUInt8(0));
        const payload = this.buffer.subarray(5, 1 + len);
        this.buffer = this.buffer.subarray(1 + len);
        return Promise.resolve({ type: typeChar, payload });
      }
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  _attachSocket(sock) {
    this.socket = sock;
    sock.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this._tryDrainMessages();
    });
    sock.on('error', err => {
      this._rejectAll(err);
    });
    sock.on('close', () => {
      this.closed = true;
      this._rejectAll(new Error('PostgreSQL socket closed'));
    });
  }

  async connect() {
    const baseSock = await new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.config.host, port: this.config.port });
      sock.once('connect', () => resolve(sock));
      sock.once('error', reject);
    });

    if (this.config.ssl) {
      // Send SSLRequest packet (8 bytes: length=8, code=80877103)
      const sslReq = Buffer.concat([encodeInt32(8), encodeInt32(80877103)]);
      const replyByte = await new Promise((resolve, reject) => {
        baseSock.once('data', d => resolve(d.toString('ascii', 0, 1)));
        baseSock.once('error', reject);
        baseSock.write(sslReq);
      });
      if (replyByte !== 'S') {
        baseSock.destroy();
        throw new Error('PostgreSQL server rejected TLS SSLRequest');
      }
      const tlsSock = await new Promise((resolve, reject) => {
        const wrapped = tls.connect({ socket: baseSock, servername: this.config.host });
        wrapped.once('secureConnect', () => resolve(wrapped));
        wrapped.once('error', reject);
      });
      this._attachSocket(tlsSock);
    } else {
      this._attachSocket(baseSock);
    }

    this.socket.write(buildStartupPacket(this.config.user, this.config.database));

    let scramState = null;
    while (true) {
      const msg = await this._nextMessage();
      if (msg.type === 'R') {
        const authType = msg.payload.readInt32BE(0);
        if (authType === 0) {
          continue;
        }
        if (authType === 3) {
          this.socket.write(
            buildFrontendMessage('p', Buffer.from(`${this.config.password}\0`, 'utf8'))
          );
          continue;
        }
        if (authType === 5) {
          const salt = msg.payload.subarray(4, 8);
          const inner = crypto
            .createHash('md5')
            .update(`${this.config.password}${this.config.user}`, 'utf8')
            .digest('hex');
          const outer = crypto
            .createHash('md5')
            .update(Buffer.concat([Buffer.from(inner, 'utf8'), salt]))
            .digest('hex');
          this.socket.write(buildFrontendMessage('p', Buffer.from(`md5${outer}\0`, 'utf8')));
          continue;
        }
        if (authType === 10) {
          const clientNonce = crypto.randomBytes(18).toString('base64');
          const clientFirstBare = `n=,r=${clientNonce}`;
          const clientFirst = `n,,${clientFirstBare}`;
          const mech = Buffer.from('SCRAM-SHA-256\0', 'utf8');
          const dataBuf = Buffer.from(clientFirst, 'utf8');
          const saslInit = Buffer.concat([mech, encodeInt32(dataBuf.length), dataBuf]);
          scramState = { clientNonce, clientFirstBare };
          this.socket.write(buildFrontendMessage('p', saslInit));
          continue;
        }
        if (authType === 11 && scramState) {
          const serverFirst = msg.payload.subarray(4).toString('utf8');
          const attrs = parseScramAttributes(serverFirst);
          if (!attrs.r || !attrs.r.startsWith(scramState.clientNonce)) {
            throw new Error('PostgreSQL SCRAM-SHA-256 server nonce mismatch');
          }
          const salt = Buffer.from(attrs.s, 'base64');
          const iterations = Number(attrs.i);
          const saltedPassword = hiPbkdf2(this.config.password, salt, iterations);
          const clientKey = hmacSha256(saltedPassword, 'Client Key');
          const storedKey = sha256(clientKey);
          const clientFinalWithoutProof = `c=biws,r=${attrs.r}`;
          const authMessage = `${scramState.clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
          const clientSignature = hmacSha256(storedKey, authMessage);
          const clientProof = xorBuffers(clientKey, clientSignature).toString('base64');
          const serverKey = hmacSha256(saltedPassword, 'Server Key');
          scramState.expectedServerSig = hmacSha256(serverKey, authMessage).toString('base64');
          const clientFinal = Buffer.from(`${clientFinalWithoutProof},p=${clientProof}`, 'utf8');
          this.socket.write(buildFrontendMessage('p', clientFinal));
          continue;
        }
        if (authType === 12 && scramState) {
          const serverFinal = msg.payload.subarray(4).toString('utf8');
          const attrs = parseScramAttributes(serverFinal);
          if (attrs.v !== scramState.expectedServerSig) {
            throw new Error('PostgreSQL SCRAM-SHA-256 server signature mismatch');
          }
          continue;
        }
        throw new Error(`Unsupported PostgreSQL auth method: ${authType}`);
      }
      if (msg.type === 'E') {
        throw parseErrorFields(msg.payload);
      }
      if (msg.type === 'Z') {
        this.txStatus = msg.payload.length > 0 ? String.fromCharCode(msg.payload.readUInt8(0)) : 'I';
        return;
      }
      // Ignore ParameterStatus ('S'), BackendKeyData ('K'), NoticeResponse ('N')
    }
  }

  async query(sql, params = []) {
    const parsePayload = Buffer.concat([
      Buffer.from([0]),
      Buffer.from(`${sql}\0`, 'utf8'),
      encodeInt16(0)
    ]);

    const paramCount = params.length;
    const bindParts = [
      Buffer.from([0, 0]),
      encodeInt16(0),
      encodeInt16(paramCount)
    ];
    for (const val of params) {
      if (val === undefined || val === null) {
        bindParts.push(encodeInt32(-1));
      } else {
        const text =
          typeof val === 'string'
            ? val
            : typeof val === 'boolean'
              ? val
                ? 'true'
                : 'false'
              : typeof val === 'number' || typeof val === 'bigint'
                ? String(val)
                : JSON.stringify(val);
        const buf = Buffer.from(text, 'utf8');
        bindParts.push(encodeInt32(buf.length), buf);
      }
    }
    bindParts.push(encodeInt16(0));

    const executePayload = Buffer.concat([Buffer.from([0]), encodeInt32(0)]);
    const wire = Buffer.concat([
      buildFrontendMessage('P', parsePayload),
      buildFrontendMessage('B', Buffer.concat(bindParts)),
      buildFrontendMessage('D', Buffer.from([0x50, 0])), // Describe Portal ""
      buildFrontendMessage('E', executePayload),
      buildFrontendMessage('S', Buffer.alloc(0))
    ]);
    this.socket.write(wire);

    let columns = [];
    const rows = [];
    let queryError = null;

    while (true) {
      const msg = await this._nextMessage();
      if (msg.type === 'T') {
        const count = msg.payload.readInt16BE(0);
        columns = [];
        let offset = 2;
        for (let i = 0; i < count; i += 1) {
          const nul = msg.payload.indexOf(0, offset);
          const name = msg.payload.toString('utf8', offset, nul);
          offset = nul + 1;
          offset += 6; // tableOid (4) + columnAttr (2)
          const typeOid = msg.payload.readInt32BE(offset);
          offset += 12; // typeOid (4) + typeLen (2) + typeMod (4) + formatCode (2)
          columns.push({ name, typeOid });
        }
      } else if (msg.type === 'D') {
        const count = msg.payload.readInt16BE(0);
        const row = {};
        let offset = 2;
        for (let i = 0; i < count; i += 1) {
          const len = msg.payload.readInt32BE(offset);
          offset += 4;
          const col = columns[i];
          if (len === -1) {
            row[col.name] = null;
          } else {
            const rawText = msg.payload.toString('utf8', offset, offset + len);
            offset += len;
            row[col.name] = decodeCellValue(rawText, col.typeOid);
          }
        }
        rows.push(row);
      } else if (msg.type === 'E') {
        queryError = parseErrorFields(msg.payload);
      } else if (msg.type === 'Z') {
        this.txStatus = msg.payload.length > 0 ? String.fromCharCode(msg.payload.readUInt8(0)) : 'I';
        if (queryError) throw queryError;
        return { rows, rowCount: rows.length };
      }
    }
  }

  async exec(sql) {
    this.socket.write(buildFrontendMessage('Q', Buffer.from(`${sql}\0`, 'utf8')));
    let queryError = null;
    while (true) {
      const msg = await this._nextMessage();
      if (msg.type === 'E') {
        queryError = parseErrorFields(msg.payload);
      } else if (msg.type === 'Z') {
        this.txStatus = msg.payload.length > 0 ? String.fromCharCode(msg.payload.readUInt8(0)) : 'I';
        if (queryError) throw queryError;
        return;
      }
    }
  }

  close() {
    this.closed = true;
    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.end(buildFrontendMessage('X', Buffer.alloc(0)));
      } catch {
        this.socket.destroy();
      }
    }
  }
}

/**
 * Zero-dependency PostgreSQL v3 pooled client supporting SCRAM-SHA-256, TLS, and ACID transactions.
 */
export function createPgPool(pgUrl, { maxConnections = 8 } = {}) {
  const config = typeof pgUrl === 'string' ? parsePostgresUrl(pgUrl) : pgUrl;
  const idle = [];
  let totalCount = 0;
  const waitQueue = [];
  let closed = false;

  async function acquire() {
    if (closed) throw new Error('PostgreSQL pool has been closed');
    while (idle.length > 0) {
      const conn = idle.pop();
      if (!conn.closed) return conn;
      totalCount = Math.max(0, totalCount - 1);
    }
    if (totalCount < maxConnections) {
      totalCount += 1;
      const conn = new PgConnection(config);
      try {
        await conn.connect();
        return conn;
      } catch (err) {
        totalCount = Math.max(0, totalCount - 1);
        throw err;
      }
    }
    return new Promise((resolve, reject) => {
      waitQueue.push({ resolve, reject });
    });
  }

  function release(conn) {
    if (closed || conn.closed || conn.lastError || conn.txStatus !== 'I') {
      conn.close();
      totalCount = Math.max(0, totalCount - 1);
      return;
    }
    if (waitQueue.length > 0) {
      const next = waitQueue.shift();
      next.resolve(conn);
      return;
    }
    idle.push(conn);
  }

  async function withConnection(fn) {
    const conn = await acquire();
    try {
      return await fn(conn);
    } finally {
      release(conn);
    }
  }

  return {
    query: (sql, params = []) => withConnection(conn => conn.query(sql, params)),
    exec: sql => withConnection(conn => conn.exec(sql)),
    withTransaction: fn =>
      withConnection(async conn => {
        await conn.exec('BEGIN');
        try {
          const out = await fn(conn);
          await conn.exec('COMMIT');
          return out;
        } catch (err) {
          try {
            await conn.exec('ROLLBACK');
          } catch {
            // Preserve root transaction error
          }
          throw err;
        }
      }),
    async close() {
      closed = true;
      while (waitQueue.length > 0) {
        waitQueue.shift().reject(new Error('PostgreSQL pool closed'));
      }
      while (idle.length > 0) {
        idle.pop().close();
      }
      totalCount = 0;
    }
  };
}
