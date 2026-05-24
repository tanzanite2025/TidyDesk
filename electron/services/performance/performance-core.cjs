/**
 * Performance Core - 性能核心
 * 整合所有性能管理组件，提供统一的 API
 */

const { EventEmitter } = require('events');
const ResourceMonitor = require('./resource-monitor.cjs');
const ThrottleManager = require('./throttle-manager.cjs');
const HealthCheck = require('./health-check.cjs');

class PerformanceCore extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // 创建子组件
    this.resourceMonitor = new ResourceMonitor(options.monitor);
    this.throttleManager = new ThrottleManager();
    this.healthCheck = new HealthCheck(this.resourceMonitor, options.health);
    
    // 降级级别：0=正常, 1=轻度降级, 2=重度降级
    this.degradationLevel = 0;
    
    // 降级阈值
    this.degradationThresholds = {
      light: {
        cpu: options.lightCpuThreshold || 30,
        memory: options.lightMemoryThreshold || 200 * 1024 * 1024,
        handles: options.lightHandleThreshold || 800
      },
      heavy: {
        cpu: options.heavyCpuThreshold || 50,
        memory: options.heavyMemoryThreshold || 300 * 1024 * 1024,
        handles: options.heavyHandleThreshold || 1000
      }
    };
    
    this.isRunning = false;
    
    // 绑定事件
    this.setupEventHandlers();
  }
  
  /**
   * 设置事件处理器
   */
  setupEventHandlers() {
    // 监听资源监控事件
    this.resourceMonitor.on('metrics-updated', (metrics) => {
      this.emit('metrics-updated', metrics);
      this.updateDegradationLevel(metrics);
    });
    
    this.resourceMonitor.on('anomalies', (anomalies) => {
      this.emit('anomalies', anomalies);
    });
    
    this.resourceMonitor.on('error', (err) => {
      this.emit('error', err);
    });
    
    // 监听健康检查事件
    this.healthCheck.on('health-issues', (issues) => {
      this.emit('health-issues', issues);
    });
    
    this.healthCheck.on('health-ok', () => {
      this.emit('health-ok');
    });
    
    this.healthCheck.on('recommend-restart', (issue) => {
      this.emit('recommend-restart', issue);
    });
    
    this.healthCheck.on('gc-triggered', (issue) => {
      this.emit('gc-triggered', issue);
    });
    
    this.healthCheck.on('enable-throttle', (issue) => {
      this.emit('enable-throttle', issue);
    });
    
    this.healthCheck.on('cleanup-resources', (issue) => {
      this.emit('cleanup-resources', issue);
    });
  }

  /**
   * 启动性能监控
   */
  start() {
    if (this.isRunning) {
      console.log('[PerformanceCore] Already running');
      return;
    }
    
    console.log('[PerformanceCore] Starting...');
    
    this.resourceMonitor.start();
    this.healthCheck.start();
    
    this.isRunning = true;
    console.log('[PerformanceCore] Started');
    
    this.emit('started');
  }
  
  /**
   * 停止性能监控
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    console.log('[PerformanceCore] Stopping...');
    
    this.resourceMonitor.stop();
    this.healthCheck.stop();
    this.throttleManager.cleanup();
    
    this.isRunning = false;
    console.log('[PerformanceCore] Stopped');
    
    this.emit('stopped');
  }
  
  /**
   * 更新降级级别
   */
  updateDegradationLevel(metrics) {
    const memoryMB = metrics.memory / 1024 / 1024;
    let newLevel = 0;
    
    // 检查是否需要重度降级
    if (
      metrics.cpu > this.degradationThresholds.heavy.cpu ||
      metrics.memory > this.degradationThresholds.heavy.memory ||
      metrics.handles > this.degradationThresholds.heavy.handles
    ) {
      newLevel = 2;
    }
    // 检查是否需要轻度降级
    else if (
      metrics.cpu > this.degradationThresholds.light.cpu ||
      metrics.memory > this.degradationThresholds.light.memory ||
      metrics.handles > this.degradationThresholds.light.handles
    ) {
      newLevel = 1;
    }
    
    // 如果降级级别改变，触发事件
    if (newLevel !== this.degradationLevel) {
      const oldLevel = this.degradationLevel;
      this.degradationLevel = newLevel;
      
      console.log(`[PerformanceCore] Degradation level changed: ${oldLevel} -> ${newLevel}`);
      
      this.applyDegradation(newLevel);
    }
  }
  
  /**
   * 应用降级策略
   */
  applyDegradation(level) {
    const degradationInfo = {
      level: level,
      levelName: ['normal', 'light', 'heavy'][level],
      actions: []
    };
    
    switch (level) {
      case 0: // 正常模式
        degradationInfo.actions = [
          '恢复所有功能',
          '正常轮询间隔',
          '启用所有动画'
        ];
        break;
        
      case 1: // 轻度降级
        degradationInfo.actions = [
          '注册表监听间隔延长到 60 秒',
          '禁用非关键动画',
          '延迟后台任务'
        ];
        break;
        
      case 2: // 重度降级
        degradationInfo.actions = [
          '暂停注册表监听',
          '禁用所有动画',
          '暂停后台扫描',
          '建议用户重启应用'
        ];
        break;
    }
    
    this.emit('degradation', degradationInfo);
  }
  
  /**
   * 获取当前性能指标
   */
  getMetrics() {
    return this.resourceMonitor.getCurrentMetrics();
  }
  
  /**
   * 获取历史指标
   */
  getHistory(type, duration) {
    return this.resourceMonitor.getHistory(type, duration);
  }
  
  /**
   * 获取所有历史指标
   */
  getAllHistory() {
    return this.resourceMonitor.getAllHistory();
  }
  
  /**
   * 获取统计信息
   */
  getStats(type) {
    return this.resourceMonitor.getStats(type);
  }
  
  /**
   * 获取所有统计信息
   */
  getAllStats() {
    return this.resourceMonitor.getAllStats();
  }
  
  /**
   * 获取健康状态
   */
  getHealthStatus() {
    return this.healthCheck.getHealthStatus();
  }
  
  /**
   * 获取降级级别
   */
  getDegradationLevel() {
    return {
      level: this.degradationLevel,
      name: ['normal', 'light', 'heavy'][this.degradationLevel]
    };
  }
  
  /**
   * 获取完整状态
   */
  getStatus() {
    return {
      running: this.isRunning,
      metrics: this.getMetrics(),
      health: this.getHealthStatus(),
      degradation: this.getDegradationLevel(),
      throttle: this.throttleManager.getStatus()
    };
  }
}

module.exports = PerformanceCore;
