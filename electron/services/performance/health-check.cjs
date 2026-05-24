/**
 * Health Check - 健康检查器
 * 定期检查系统健康状态，触发自动恢复
 */

const { EventEmitter } = require('events');

class HealthCheck extends EventEmitter {
  constructor(resourceMonitor, options = {}) {
    super();
    
    this.monitor = resourceMonitor;
    
    // 配置
    this.checkInterval = options.checkInterval || 30000; // 30 秒检查一次
    this.enabled = options.enabled !== false;
    
    // 健康检查项
    this.checks = [
      { name: 'process-count', fn: this.checkProcessCount.bind(this) },
      { name: 'cpu-usage', fn: this.checkCpuUsage.bind(this) },
      { name: 'memory-usage', fn: this.checkMemoryUsage.bind(this) },
      { name: 'handle-count', fn: this.checkHandleCount.bind(this) }
    ];
    
    // 问题历史
    this.issueHistory = [];
    this.maxHistorySize = 100;
    
    this.interval = null;
    this.isRunning = false;
  }
  
  /**
   * 启动健康检查
   */
  start() {
    if (this.isRunning || !this.enabled) {
      return;
    }
    
    this.isRunning = true;
    console.log('[HealthCheck] Starting...');
    
    // 立即执行一次
    this.runChecks().catch(err => {
      console.error('[HealthCheck] Initial check failed:', err);
    });
    
    // 定期检查
    this.interval = setInterval(() => {
      this.runChecks().catch(err => {
        console.error('[HealthCheck] Check failed:', err);
      });
    }, this.checkInterval);
    
    console.log('[HealthCheck] Started');
  }
  
  /**
   * 停止健康检查
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    console.log('[HealthCheck] Stopping...');
    
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    this.isRunning = false;
    console.log('[HealthCheck] Stopped');
  }
  
  /**
   * 执行所有健康检查
   */
  async runChecks() {
    const metrics = this.monitor.getCurrentMetrics();
    const issues = [];
    
    // 执行所有检查项
    for (const check of this.checks) {
      try {
        const issue = await check.fn(metrics);
        if (issue) {
          issues.push(issue);
        }
      } catch (err) {
        console.error(`[HealthCheck] Check "${check.name}" failed:`, err);
      }
    }
    
    // 记录到历史
    this.addToHistory({
      timestamp: Date.now(),
      healthy: issues.length === 0,
      issues: issues
    });
    
    // 触发事件
    if (issues.length > 0) {
      console.warn('[HealthCheck] Health issues detected:', issues);
      this.emit('health-issues', issues);
      
      // 触发自动恢复
      this.autoRecover(issues);
    } else {
      this.emit('health-ok');
    }
    
    return {
      healthy: issues.length === 0,
      issues: issues
    };
  }

  /**
   * 检查进程数量
   */
  checkProcessCount(metrics) {
    if (metrics.processes > 4) {
      return {
        severity: 'critical',
        type: 'process-leak',
        message: `进程数量异常: ${metrics.processes} (正常: ≤3)`,
        value: metrics.processes,
        threshold: 3,
        action: 'restart-recommended'
      };
    }
    return null;
  }
  
  /**
   * 检查 CPU 使用率
   */
  checkCpuUsage(metrics) {
    if (metrics.cpu > 50) {
      return {
        severity: 'warning',
        type: 'high-cpu',
        message: `CPU 使用率过高: ${metrics.cpu.toFixed(1)}% (正常: <10%)`,
        value: metrics.cpu.toFixed(1),
        threshold: 10,
        action: 'throttle-operations'
      };
    }
    return null;
  }
  
  /**
   * 检查内存使用
   */
  checkMemoryUsage(metrics) {
    const memoryMB = metrics.memory / 1024 / 1024;
    if (memoryMB > 300) {
      return {
        severity: 'warning',
        type: 'high-memory',
        message: `内存使用过高: ${memoryMB.toFixed(0)}MB (正常: <200MB)`,
        value: memoryMB.toFixed(0),
        threshold: 200,
        action: 'gc-recommended'
      };
    }
    return null;
  }
  
  /**
   * 检查句柄数量
   */
  checkHandleCount(metrics) {
    if (metrics.handles > 1000) {
      return {
        severity: 'critical',
        type: 'handle-leak',
        message: `句柄数量异常: ${metrics.handles} (正常: <500)`,
        value: metrics.handles,
        threshold: 500,
        action: 'cleanup-resources'
      };
    }
    return null;
  }
  
  /**
   * 自动恢复
   */
  autoRecover(issues) {
    for (const issue of issues) {
      console.log(`[HealthCheck] Auto-recovering from: ${issue.type}`);
      
      switch (issue.action) {
        case 'restart-recommended':
          this.emit('recommend-restart', issue);
          break;
          
        case 'gc-recommended':
          // 触发垃圾回收（如果可用）
          if (global.gc) {
            try {
              global.gc();
              console.log('[HealthCheck] Garbage collection triggered');
            } catch (err) {
              console.error('[HealthCheck] GC failed:', err);
            }
          }
          this.emit('gc-triggered', issue);
          break;
          
        case 'throttle-operations':
          this.emit('enable-throttle', issue);
          break;
          
        case 'cleanup-resources':
          this.emit('cleanup-resources', issue);
          break;
      }
    }
  }
  
  /**
   * 添加到历史记录
   */
  addToHistory(record) {
    this.issueHistory.push(record);
    
    // 保持历史记录大小
    if (this.issueHistory.length > this.maxHistorySize) {
      this.issueHistory.shift();
    }
  }
  
  /**
   * 获取历史记录
   */
  getHistory(duration) {
    if (!duration) {
      return [...this.issueHistory];
    }
    
    const cutoff = Date.now() - duration;
    return this.issueHistory.filter(record => record.timestamp >= cutoff);
  }
  
  /**
   * 获取当前问题
   */
  getCurrentIssues() {
    if (this.issueHistory.length === 0) {
      return [];
    }
    
    const latest = this.issueHistory[this.issueHistory.length - 1];
    return latest.issues || [];
  }
  
  /**
   * 获取健康状态
   */
  getHealthStatus() {
    if (this.issueHistory.length === 0) {
      return { healthy: true, issues: [] };
    }
    
    const latest = this.issueHistory[this.issueHistory.length - 1];
    return {
      healthy: latest.healthy,
      issues: latest.issues,
      timestamp: latest.timestamp
    };
  }
  
  /**
   * 清空历史记录
   */
  clearHistory() {
    this.issueHistory = [];
  }
}

module.exports = HealthCheck;
