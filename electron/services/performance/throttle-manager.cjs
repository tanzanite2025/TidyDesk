/**
 * Throttle Manager - 限流管理器
 * 提供节流、防抖和互斥锁功能
 */

class ThrottleManager {
  constructor() {
    // 节流器存储：key -> { lastCall, timer, queue }
    this.throttles = new Map();
    
    // 互斥锁存储：key -> { locked, promise, queue }
    this.locks = new Map();
    
    // 防抖器存储：key -> { timer, lastArgs }
    this.debounces = new Map();
  }
  
  /**
   * 节流：限制函数执行频率
   * @param {string} key - 唯一标识
   * @param {Function} fn - 要执行的函数
   * @param {number} delay - 延迟时间（毫秒）
   * @returns {Promise} 执行结果
   */
  async throttle(key, fn, delay = 1000) {
    if (!this.throttles.has(key)) {
      this.throttles.set(key, {
        lastCall: 0,
        timer: null,
        queue: []
      });
    }
    
    const throttle = this.throttles.get(key);
    const now = Date.now();
    const timeSinceLastCall = now - throttle.lastCall;
    
    if (timeSinceLastCall >= delay) {
      // 可以立即执行
      throttle.lastCall = now;
      return await fn();
    } else {
      // 需要延迟执行
      return new Promise((resolve, reject) => {
        // 清除之前的定时器
        if (throttle.timer) {
          clearTimeout(throttle.timer);
        }
        
        // 设置新的定时器
        const remainingTime = delay - timeSinceLastCall;
        throttle.timer = setTimeout(async () => {
          throttle.lastCall = Date.now();
          throttle.timer = null;
          try {
            const result = await fn();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        }, remainingTime);
      });
    }
  }
  
  /**
   * 防抖：延迟执行，如果在延迟期间再次调用，则重新计时
   * @param {string} key - 唯一标识
   * @param {Function} fn - 要执行的函数
   * @param {number} delay - 延迟时间（毫秒）
   * @returns {Promise} 执行结果
   */
  debounce(key, fn, delay = 1000) {
    if (!this.debounces.has(key)) {
      this.debounces.set(key, {
        timer: null,
        lastArgs: null,
        promise: null,
        resolve: null,
        reject: null
      });
    }
    
    const debounce = this.debounces.get(key);
    
    // 清除之前的定时器
    if (debounce.timer) {
      clearTimeout(debounce.timer);
    }
    
    // 创建新的 Promise（如果还没有）
    if (!debounce.promise) {
      debounce.promise = new Promise((resolve, reject) => {
        debounce.resolve = resolve;
        debounce.reject = reject;
      });
    }
    
    // 设置新的定时器
    debounce.timer = setTimeout(async () => {
      try {
        const result = await fn();
        debounce.resolve(result);
      } catch (err) {
        debounce.reject(err);
      } finally {
        // 清理
        this.debounces.delete(key);
      }
    }, delay);
    
    return debounce.promise;
  }

  /**
   * 互斥锁：确保同一时间只有一个任务执行
   * @param {string} key - 唯一标识
   * @param {Function} fn - 要执行的函数
   * @param {number} timeout - 超时时间（毫秒），0 表示无超时
   * @returns {Promise} 执行结果
   */
  async lock(key, fn, timeout = 30000) {
    if (!this.locks.has(key)) {
      this.locks.set(key, {
        locked: false,
        promise: null,
        queue: []
      });
    }
    
    const lock = this.locks.get(key);
    
    // 如果已经锁定，等待前一个任务完成
    if (lock.locked && lock.promise) {
      console.log(`[ThrottleManager] Lock "${key}" is busy, waiting...`);
      await lock.promise;
    }
    
    // 获取锁
    lock.locked = true;
    
    // 创建执行 Promise
    lock.promise = (async () => {
      let timeoutTimer = null;
      
      try {
        // 设置超时
        if (timeout > 0) {
          const timeoutPromise = new Promise((_, reject) => {
            timeoutTimer = setTimeout(() => {
              reject(new Error(`Lock "${key}" timeout after ${timeout}ms`));
            }, timeout);
          });
          
          // 竞速：任务完成 vs 超时
          return await Promise.race([fn(), timeoutPromise]);
        } else {
          return await fn();
        }
      } finally {
        // 清理超时定时器
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        
        // 释放锁
        lock.locked = false;
        lock.promise = null;
      }
    })();
    
    return lock.promise;
  }
  
  /**
   * 检查锁是否被占用
   * @param {string} key - 唯一标识
   * @returns {boolean} 是否被锁定
   */
  isLocked(key) {
    const lock = this.locks.get(key);
    return lock ? lock.locked : false;
  }
  
  /**
   * 取消节流任务
   * @param {string} key - 唯一标识
   */
  cancelThrottle(key) {
    const throttle = this.throttles.get(key);
    if (throttle && throttle.timer) {
      clearTimeout(throttle.timer);
      throttle.timer = null;
    }
  }
  
  /**
   * 取消防抖任务
   * @param {string} key - 唯一标识
   */
  cancelDebounce(key) {
    const debounce = this.debounces.get(key);
    if (debounce) {
      if (debounce.timer) {
        clearTimeout(debounce.timer);
      }
      if (debounce.reject) {
        debounce.reject(new Error('Debounce cancelled'));
      }
      this.debounces.delete(key);
    }
  }
  
  /**
   * 取消所有任务
   */
  cancelAll() {
    // 取消所有节流任务
    for (const [key] of this.throttles) {
      this.cancelThrottle(key);
    }
    this.throttles.clear();
    
    // 取消所有防抖任务
    for (const [key] of this.debounces) {
      this.cancelDebounce(key);
    }
    this.debounces.clear();
    
    // 注意：不能取消正在执行的锁任务，只能等待它们完成
  }
  
  /**
   * 获取状态信息
   */
  getStatus() {
    return {
      throttles: {
        count: this.throttles.size,
        keys: Array.from(this.throttles.keys())
      },
      debounces: {
        count: this.debounces.size,
        keys: Array.from(this.debounces.keys())
      },
      locks: {
        count: this.locks.size,
        locked: Array.from(this.locks.entries())
          .filter(([, lock]) => lock.locked)
          .map(([key]) => key)
      }
    };
  }
  
  /**
   * 清理资源
   */
  cleanup() {
    this.cancelAll();
    this.locks.clear();
  }
}

module.exports = ThrottleManager;
