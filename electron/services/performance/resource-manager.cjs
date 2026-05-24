/**
 * Resource Manager - 资源管理器
 * 统一管理定时器、间隔器和事件监听器，确保正确清理
 */

class ResourceManager {
  constructor() {
    // 定时器存储：timer -> { type, key, createdAt }
    this.timers = new Map();
    
    // 间隔器存储：interval -> { type, key, createdAt }
    this.intervals = new Map();
    
    // 事件监听器存储：key -> { emitter, event, handler, createdAt }
    this.listeners = new Map();
    
    // 统计信息
    this.stats = {
      timersCreated: 0,
      intervalsCreated: 0,
      listenersCreated: 0,
      timersCleaned: 0,
      intervalsCleaned: 0,
      listenersCleaned: 0
    };
  }
  
  /**
   * 注册定时器
   * @param {NodeJS.Timeout} timer - setTimeout 返回的定时器
   * @param {string} key - 唯一标识（用于调试）
   * @returns {NodeJS.Timeout} 原定时器
   */
  registerTimer(timer, key = 'unknown') {
    this.timers.set(timer, {
      type: 'timer',
      key,
      createdAt: Date.now()
    });
    this.stats.timersCreated++;
    
    console.log(`[ResourceManager] Timer registered: ${key} (total: ${this.timers.size})`);
    
    return timer;
  }
  
  /**
   * 注册间隔器
   * @param {NodeJS.Timeout} interval - setInterval 返回的间隔器
   * @param {string} key - 唯一标识（用于调试）
   * @returns {NodeJS.Timeout} 原间隔器
   */
  registerInterval(interval, key = 'unknown') {
    this.intervals.set(interval, {
      type: 'interval',
      key,
      createdAt: Date.now()
    });
    this.stats.intervalsCreated++;
    
    console.log(`[ResourceManager] Interval registered: ${key} (total: ${this.intervals.size})`);
    
    return interval;
  }
  
  /**
   * 注册事件监听器
   * @param {EventEmitter} emitter - 事件发射器
   * @param {string} event - 事件名称
   * @param {Function} handler - 处理函数
   * @param {string} key - 唯一标识（用于调试）
   */
  registerListener(emitter, event, handler, key = 'unknown') {
    const listenerKey = `${key}-${event}`;
    
    if (this.listeners.has(listenerKey)) {
      console.warn(`[ResourceManager] Listener already registered: ${listenerKey}`);
      return;
    }
    
    this.listeners.set(listenerKey, {
      emitter,
      event,
      handler,
      createdAt: Date.now()
    });
    this.stats.listenersCreated++;
    
    emitter.on(event, handler);
    
    console.log(`[ResourceManager] Listener registered: ${listenerKey} (total: ${this.listeners.size})`);
  }
  
  /**
   * 清除单个定时器
   * @param {NodeJS.Timeout} timer - 要清除的定时器
   */
  clearTimer(timer) {
    if (this.timers.has(timer)) {
      clearTimeout(timer);
      const info = this.timers.get(timer);
      this.timers.delete(timer);
      this.stats.timersCleaned++;
      
      console.log(`[ResourceManager] Timer cleared: ${info.key}`);
    }
  }
  
  /**
   * 清除单个间隔器
   * @param {NodeJS.Timeout} interval - 要清除的间隔器
   */
  clearInterval(interval) {
    if (this.intervals.has(interval)) {
      clearInterval(interval);
      const info = this.intervals.get(interval);
      this.intervals.delete(interval);
      this.stats.intervalsCleaned++;
      
      console.log(`[ResourceManager] Interval cleared: ${info.key}`);
    }
  }
  
  /**
   * 移除单个事件监听器
   * @param {string} key - 监听器的唯一标识
   */
  removeListener(key) {
    if (this.listeners.has(key)) {
      const { emitter, event, handler } = this.listeners.get(key);
      emitter.removeListener(event, handler);
      this.listeners.delete(key);
      this.stats.listenersCleaned++;
      
      console.log(`[ResourceManager] Listener removed: ${key}`);
    }
  }
  
  /**
   * 清理所有定时器
   */
  clearAllTimers() {
    console.log(`[ResourceManager] Clearing ${this.timers.size} timers...`);
    
    for (const [timer, info] of this.timers) {
      clearTimeout(timer);
      console.log(`[ResourceManager] Cleared timer: ${info.key}`);
    }
    
    this.stats.timersCleaned += this.timers.size;
    this.timers.clear();
  }
  
  /**
   * 清理所有间隔器
   */
  clearAllIntervals() {
    console.log(`[ResourceManager] Clearing ${this.intervals.size} intervals...`);
    
    for (const [interval, info] of this.intervals) {
      clearInterval(interval);
      console.log(`[ResourceManager] Cleared interval: ${info.key}`);
    }
    
    this.stats.intervalsCleaned += this.intervals.size;
    this.intervals.clear();
  }
  
  /**
   * 移除所有事件监听器
   */
  removeAllListeners() {
    console.log(`[ResourceManager] Removing ${this.listeners.size} listeners...`);
    
    for (const [key, { emitter, event, handler }] of this.listeners) {
      emitter.removeListener(event, handler);
      console.log(`[ResourceManager] Removed listener: ${key}`);
    }
    
    this.stats.listenersCleaned += this.listeners.size;
    this.listeners.clear();
  }
  
  /**
   * 清理所有资源
   */
  cleanup() {
    console.log('[ResourceManager] Cleaning up all resources...');
    
    this.clearAllTimers();
    this.clearAllIntervals();
    this.removeAllListeners();
    
    console.log('[ResourceManager] Cleanup complete');
    console.log('[ResourceManager] Stats:', this.stats);
  }
  
  /**
   * 获取资源统计信息
   */
  getStats() {
    return {
      ...this.stats,
      active: {
        timers: this.timers.size,
        intervals: this.intervals.size,
        listeners: this.listeners.size
      }
    };
  }
  
  /**
   * 获取详细的资源列表
   */
  getDetails() {
    return {
      timers: Array.from(this.timers.values()).map(info => ({
        key: info.key,
        age: Date.now() - info.createdAt
      })),
      intervals: Array.from(this.intervals.values()).map(info => ({
        key: info.key,
        age: Date.now() - info.createdAt
      })),
      listeners: Array.from(this.listeners.entries()).map(([key, info]) => ({
        key,
        event: info.event,
        age: Date.now() - info.createdAt
      }))
    };
  }
  
  /**
   * 检测长时间运行的资源（可能泄漏）
   * @param {number} threshold - 阈值（毫秒），默认 1 小时
   */
  detectLeaks(threshold = 60 * 60 * 1000) {
    const now = Date.now();
    const leaks = [];
    
    // 检查定时器
    for (const [timer, info] of this.timers) {
      const age = now - info.createdAt;
      if (age > threshold) {
        leaks.push({
          type: 'timer',
          key: info.key,
          age
        });
      }
    }
    
    // 检查间隔器
    for (const [interval, info] of this.intervals) {
      const age = now - info.createdAt;
      if (age > threshold) {
        leaks.push({
          type: 'interval',
          key: info.key,
          age
        });
      }
    }
    
    // 检查监听器
    for (const [key, info] of this.listeners) {
      const age = now - info.createdAt;
      if (age > threshold) {
        leaks.push({
          type: 'listener',
          key,
          event: info.event,
          age
        });
      }
    }
    
    if (leaks.length > 0) {
      console.warn(`[ResourceManager] Detected ${leaks.length} potential leaks:`, leaks);
    }
    
    return leaks;
  }
}

module.exports = ResourceManager;
