/**
 * 应用缓存服务
 * 缓存已扫描的应用列表，大幅提升性能
 */

const fs = require('fs');
const path = require('path');

function createAppCacheService({ app }) {
  const CACHE_DIR = path.join(app.getPath('userData'), 'cache');
  const CACHE_FILE = path.join(CACHE_DIR, 'apps.json');
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时
  const CACHE_VERSION = '1.0';

  /**
   * 确保缓存目录存在
   */
  function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  /**
   * 加载缓存
   * @returns {Object|null} 缓存对象或 null
   */
  async function loadCache() {
    try {
      if (!fs.existsSync(CACHE_FILE)) {
        console.log('[TIDYDESK] No cache file found');
        return null;
      }

      const data = await fs.promises.readFile(CACHE_FILE, 'utf8');
      const cache = JSON.parse(data);

      // 验证缓存版本
      if (cache.version !== CACHE_VERSION) {
        console.log('[TIDYDESK] Cache version mismatch, invalidating');
        return null;
      }

      console.log(`[TIDYDESK] Loaded cache with ${cache.apps?.length || 0} apps`);
      return cache;
    } catch (err) {
      console.warn('[TIDYDESK] Failed to load cache:', err.message);
      
      // 自动删除损坏的缓存文件
      try {
        if (fs.existsSync(CACHE_FILE)) {
          await fs.promises.unlink(CACHE_FILE);
          console.log('[TIDYDESK] Corrupted cache file deleted');
        }
      } catch (deleteErr) {
        console.error('[TIDYDESK] Failed to delete corrupted cache:', deleteErr.message);
      }
      
      return null;
    }
  }

  /**
   * 保存缓存（使用原子写入）
   * @param {Array} apps - 应用列表
   */
  async function saveCache(apps) {
    try {
      ensureCacheDir();

      const cache = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        apps
      };

      const data = JSON.stringify(cache, null, 2);
      
      // 原子写入：先写临时文件，再重命名
      const tempFile = CACHE_FILE + '.tmp';
      await fs.promises.writeFile(tempFile, data, 'utf8');
      
      // 验证写入的文件是否有效
      try {
        const testData = await fs.promises.readFile(tempFile, 'utf8');
        JSON.parse(testData); // 验证 JSON 格式
      } catch (verifyErr) {
        console.error('[TIDYDESK] Cache verification failed:', verifyErr.message);
        await fs.promises.unlink(tempFile);
        throw new Error('Cache verification failed');
      }
      
      // 重命名（原子操作）
      await fs.promises.rename(tempFile, CACHE_FILE);

      console.log(`[TIDYDESK] Saved cache with ${apps.length} apps`);
    } catch (err) {
      console.error('[TIDYDESK] Failed to save cache:', err.message);
    }
  }

  /**
   * 检查缓存是否有效
   * @param {Object} cache - 缓存对象
   * @returns {boolean}
   */
  function isCacheValid(cache) {
    if (!cache || !cache.timestamp || !cache.apps) {
      return false;
    }

    const age = Date.now() - cache.timestamp;
    const isValid = age < CACHE_TTL;

    if (!isValid) {
      console.log(`[TIDYDESK] Cache expired (age: ${Math.round(age / 1000 / 60)} minutes)`);
    }

    return isValid;
  }

  /**
   * 清除缓存
   */
  async function clearCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        await fs.promises.unlink(CACHE_FILE);
        console.log('[TIDYDESK] Cache cleared');
      }
    } catch (err) {
      console.error('[TIDYDESK] Failed to clear cache:', err.message);
    }
  }

  /**
   * 获取缓存信息
   * @returns {Object} 缓存信息
   */
  async function getCacheInfo() {
    try {
      const cache = await loadCache();
      if (!cache) {
        return { exists: false };
      }

      const age = Date.now() - cache.timestamp;
      const ageMinutes = Math.round(age / 1000 / 60);
      const isValid = isCacheValid(cache);

      return {
        exists: true,
        valid: isValid,
        appCount: cache.apps?.length || 0,
        ageMinutes,
        timestamp: cache.timestamp
      };
    } catch (err) {
      return { exists: false, error: err.message };
    }
  }

  return {
    loadCache,
    saveCache,
    isCacheValid,
    clearCache,
    getCacheInfo
  };
}

module.exports = createAppCacheService;
