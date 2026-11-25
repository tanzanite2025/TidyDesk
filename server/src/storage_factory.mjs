import {
  createDiskBlobStore,
  createMinioBlobStore,
  resolveMinioConfigFromEnv
} from './minio_blobs.mjs';
import { createPgPool } from './pg_client.mjs';
import { createPostgresSyncStore, loadPostgresSchemaSql } from './pg_store.mjs';
import { createPostgresUserRegistry } from './pg_users.mjs';
import { openSyncSqliteDatabase } from './sqlite_db.mjs';
import { createSqliteSyncStore } from './sqlite_store.mjs';
import { createSqliteUserRegistry } from './sqlite_users.mjs';
import { createSyncStore as createJsonSyncStore } from './store.mjs';
import { createUserRegistry as createJsonUserRegistry } from './users.mjs';

export const SUPPORTED_STORE_DRIVERS = ['sqlite', 'json', 'postgres'];

/**
 * Resolve the server persistence engine (`sqlite` default, `json` rollback, `postgres` production cluster).
 */
export function resolveStoreDriver(explicitDriver = undefined) {
  const raw =
    explicitDriver !== undefined && explicitDriver !== null && String(explicitDriver).trim() !== ''
      ? String(explicitDriver)
      : process.env.TIDYDESK_STORE_DRIVER || 'sqlite';
  const normalized = raw.trim().toLowerCase();
  if (!SUPPORTED_STORE_DRIVERS.includes(normalized)) {
    throw new Error(
      `[CRITICAL] 不支持的存储驱动 "${raw}"，仅支持: ${SUPPORTED_STORE_DRIVERS.join(', ')}`
    );
  }
  return normalized;
}

export function createServerStorage(
  dataDir,
  {
    driver = undefined,
    pgUrl = undefined,
    pgClient = null,
    minioConfig = undefined,
    blobStore = null
  } = {}
) {
  const resolvedDriver = resolveStoreDriver(driver);
  if (resolvedDriver === 'json') {
    const store = createJsonSyncStore(dataDir);
    const userRegistry = createJsonUserRegistry(dataDir);
    return {
      driver: 'json',
      blobMode: 'disk',
      store,
      userRegistry,
      close() {
        store.close?.();
        userRegistry.close?.();
      }
    };
  }

  if (resolvedDriver === 'postgres') {
    const ownsPg = !pgClient;
    const pg =
      pgClient || createPgPool(pgUrl !== undefined ? pgUrl : process.env.TIDYDESK_PG_URL);
    const resolvedMinio = minioConfig !== undefined ? minioConfig : resolveMinioConfigFromEnv();
    const effectiveBlobStore =
      blobStore || (resolvedMinio ? createMinioBlobStore(resolvedMinio) : createDiskBlobStore(dataDir));

    let schemaPromise = null;
    const ensureSchema = () => {
      if (!schemaPromise) {
        schemaPromise = (async () => {
          await pg.exec(loadPostgresSchemaSql());
          await effectiveBlobStore.ensureReady();
        })().catch(err => {
          schemaPromise = null;
          throw err;
        });
      }
      return schemaPromise;
    };

    const userRegistry = createPostgresUserRegistry({ pg, ensureSchema, ownsPg: false });
    const store = createPostgresSyncStore({
      pg,
      blobStore: effectiveBlobStore,
      ensureSchema,
      ownsPg: false
    });
    return {
      driver: 'postgres',
      blobMode: effectiveBlobStore.mode,
      pg,
      blobStore: effectiveBlobStore,
      ensureSchema,
      store,
      userRegistry,
      async close() {
        if (ownsPg) {
          await pg.close();
        }
      }
    };
  }

  const dbHandle = openSyncSqliteDatabase(dataDir);
  try {
    const userRegistry = createSqliteUserRegistry(dataDir, { dbHandle });
    const store = createSqliteSyncStore(dataDir, { dbHandle });
    return {
      driver: 'sqlite',
      blobMode: 'disk',
      store,
      userRegistry,
      close() {
        dbHandle.close();
      }
    };
  } catch (err) {
    dbHandle.close();
    throw err;
  }
}
