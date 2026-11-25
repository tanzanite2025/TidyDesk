import { openSyncSqliteDatabase } from './sqlite_db.mjs';
import { createSqliteSyncStore } from './sqlite_store.mjs';
import { createSqliteUserRegistry } from './sqlite_users.mjs';
import { createSyncStore as createJsonSyncStore } from './store.mjs';
import { createUserRegistry as createJsonUserRegistry } from './users.mjs';

export const SUPPORTED_STORE_DRIVERS = ['sqlite', 'json'];

/**
 * Resolve the server persistence engine (`sqlite` default, `json` fallback for rollback).
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

export function createServerStorage(dataDir, { driver = undefined } = {}) {
  const resolvedDriver = resolveStoreDriver(driver);
  if (resolvedDriver === 'json') {
    const store = createJsonSyncStore(dataDir);
    const userRegistry = createJsonUserRegistry(dataDir);
    return {
      driver: 'json',
      store,
      userRegistry,
      close() {
        store.close?.();
        userRegistry.close?.();
      }
    };
  }

  const dbHandle = openSyncSqliteDatabase(dataDir);
  try {
    const userRegistry = createSqliteUserRegistry(dataDir, { dbHandle });
    const store = createSqliteSyncStore(dataDir, { dbHandle });
    return {
      driver: 'sqlite',
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
