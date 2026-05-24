/**
 * Resource Monitor - 资源监控器
 * 监控进程、CPU、内存、句柄使用情况
 */

const { EventEmitter } = require('events');
const { execSync } = require('child_process');

class ResourceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // 配置
    this.sampleInterval = options.sampleInterval || 5000; // 5 秒采样一次
    this.historySize = options.historySize || 60;         // 保留 60 个样本（5 分钟）
    this.processName = options.processName || 'TidyDesk.exe';
    
    // 性能指标历史
    this.metrics = {
      processes: [],  // 进程数量历史
      cpu: [],        // CPU 使用率历史
      memory: [],     // 内存使用历史
      handles: []     // 句柄数量历史
    };
    
    // 当前指标
    this.current = {
      processes: 0,
      cpu: 0,
      memory: 0,
      handles: 0,
      processList: []
    };
    
    // 异常阈值
    this.thresholds = {
      processes: options.processThreshold || 4,
      cpu: options.cpuThreshold || 50,
      memory: options.memoryThreshold || 300 * 1024 * 1024, // 300MB
      handles: options.handleThreshold || 1000
    };
    
    this.interval = null;
    this.isRunning = false;
  }
  
  /**
   * 启动监控
   */
  start() {
    if (this.isRunning) {
      console.log('[ResourceMonitor] Already running');
      return;
    }
    
    this.isRunning = true;
    console.log('[ResourceMonitor] Starting...');
    
    // 立即采集一次
    this.collectMetrics().catch(err => {
      console.error('[ResourceMonitor] Initial collection failed:', err);
    });
    
    // 定期采集
    this.interval = setInterval(() => {
      this.collectMetrics().catch(err => {
        console.error('[ResourceMonitor] Collection failed:', err);
      });
    }, this.sampleInterval);
    
    console.log('[ResourceMonitor] Started');
  }

  /**
   * 停止监控
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    console.log('[ResourceMonitor] Stopping...');
    
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    this.isRunning = false;
    console.log('[ResourceMonitor] Stopped');
  }
  
  /**
   * 采集性能指标
   */
  async collectMetrics() {
    try {
      // 获取进程列表
      const processList = await this.getProcessList();
      
      // 计算总计
      const totalCpu = processList.reduce((sum, p) => sum + p.cpu, 0);
      const totalMemory = processList.reduce((sum, p) => sum + p.memory, 0);
      const totalHandles = processList.reduce((sum, p) => sum + p.handles, 0);
      
      // 更新当前指标
      this.current = {
        processes: processList.length,
        cpu: totalCpu,
        memory: totalMemory,
        handles: totalHandles,
        processList: processList,
        timestamp: Date.now()
      };
      
      // 添加到历史记录
      this.addMetric('processes', processList.length);
      this.addMetric('cpu', totalCpu);
      this.addMetric('memory', totalMemory);
      this.addMetric('handles', totalHandles);
      
      // 检查异常
      this.checkAnomalies();
      
      // 触发更新事件
      this.emit('metrics-updated', this.current);
      
    } catch (err) {
      console.error('[ResourceMonitor] Failed to collect metrics:', err);
      this.emit('error', err);
    }
  }
  
  /**
   * 获取进程列表
   */
  async getProcessList() {
    try {
      // 使用 tasklist 获取进程信息
      const output = execSync(
        `tasklist /FI "IMAGENAME eq ${this.processName}" /FO CSV /NH`,
        { encoding: 'utf8', timeout: 5000 }
      );
      
      const lines = output.trim().split('\n').filter(line => line.trim());
      const processes = [];
      
      for (const line of lines) {
        // 解析 CSV 格式
        const match = line.match(/"([^"]+)","(\d+)","[^"]+","[^"]+","([^"]+)"/);
        if (match) {
          const [, name, pid, memStr] = match;
          const memory = this.parseMemory(memStr);
          
          // 获取详细信息（CPU 和句柄）
          const details = await this.getProcessDetails(pid);
          
          processes.push({
            name,
            pid: parseInt(pid),
            memory,
            cpu: details.cpu,
            handles: details.handles
          });
        }
      }
      
      return processes;
    } catch (err) {
      // 如果没有找到进程，返回空数组
      if (err.message.includes('INFO: No tasks')) {
        return [];
      }
      throw err;
    }
  }

  /**
   * 获取进程详细信息（CPU 和句柄）
   */
  async getProcessDetails(pid) {
    try {
      // 使用 PowerShell 获取详细信息，添加 -ErrorAction SilentlyContinue 抑制错误
      // 使用 2>$null 重定向 stderr 到 null
      const output = execSync(
        `powershell -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object CPU, HandleCount | ConvertTo-Json" 2>$null`,
        { encoding: 'utf8', timeout: 3000 }
      );
      
      if (!output || !output.trim()) {
        // 进程已经不存在
        return { cpu: 0, handles: 0 };
      }
      
      const data = JSON.parse(output);
      return {
        cpu: parseFloat(data.CPU) || 0,
        handles: parseInt(data.HandleCount) || 0
      };
    } catch (err) {
      // 如果获取失败（进程已退出），返回默认值
      return { cpu: 0, handles: 0 };
    }
  }
  
  /**
   * 解析内存字符串（如 "123,456 K"）
   */
  parseMemory(memStr) {
    const cleaned = memStr.replace(/[,\s]/g, '');
    const match = cleaned.match(/(\d+)([KMG])?/);
    if (!match) return 0;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'K': return value * 1024;
      case 'M': return value * 1024 * 1024;
      case 'G': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }
  
  /**
   * 添加指标到历史记录
   */
  addMetric(type, value) {
    const history = this.metrics[type];
    history.push({
      value,
      timestamp: Date.now()
    });
    
    // 保持历史记录大小
    if (history.length > this.historySize) {
      history.shift();
    }
  }
  
  /**
   * 检测异常
   */
  checkAnomalies() {
    const anomalies = [];
    
    // 检查进程数量
    if (this.current.processes > this.thresholds.processes) {
      anomalies.push({
        type: 'process-leak',
        severity: 'critical',
        value: this.current.processes,
        threshold: this.thresholds.processes,
        message: `进程数量异常: ${this.current.processes} (阈值: ${this.thresholds.processes})`
      });
    }
    
    // 检查 CPU 使用率
    if (this.current.cpu > this.thresholds.cpu) {
      anomalies.push({
        type: 'high-cpu',
        severity: 'warning',
        value: this.current.cpu.toFixed(1),
        threshold: this.thresholds.cpu,
        message: `CPU 使用率过高: ${this.current.cpu.toFixed(1)}% (阈值: ${this.thresholds.cpu}%)`
      });
    }
    
    // 检查内存使用
    if (this.current.memory > this.thresholds.memory) {
      const memoryMB = (this.current.memory / 1024 / 1024).toFixed(0);
      const thresholdMB = (this.thresholds.memory / 1024 / 1024).toFixed(0);
      anomalies.push({
        type: 'high-memory',
        severity: 'warning',
        value: memoryMB,
        threshold: thresholdMB,
        message: `内存使用过高: ${memoryMB}MB (阈值: ${thresholdMB}MB)`
      });
    }
    
    // 检查句柄数量
    if (this.current.handles > this.thresholds.handles) {
      anomalies.push({
        type: 'handle-leak',
        severity: 'critical',
        value: this.current.handles,
        threshold: this.thresholds.handles,
        message: `句柄数量异常: ${this.current.handles} (阈值: ${this.thresholds.handles})`
      });
    }
    
    // 触发异常事件
    if (anomalies.length > 0) {
      this.emit('anomalies', anomalies);
    }
  }

  /**
   * 获取当前指标
   */
  getCurrentMetrics() {
    return { ...this.current };
  }
  
  /**
   * 获取历史指标
   */
  getHistory(type, duration) {
    if (!this.metrics[type]) {
      return [];
    }
    
    const history = this.metrics[type];
    
    if (!duration) {
      return [...history];
    }
    
    // 过滤指定时间范围内的数据
    const cutoff = Date.now() - duration;
    return history.filter(item => item.timestamp >= cutoff);
  }
  
  /**
   * 获取所有历史指标
   */
  getAllHistory() {
    return {
      processes: [...this.metrics.processes],
      cpu: [...this.metrics.cpu],
      memory: [...this.metrics.memory],
      handles: [...this.metrics.handles]
    };
  }
  
  /**
   * 清空历史记录
   */
  clearHistory() {
    this.metrics.processes = [];
    this.metrics.cpu = [];
    this.metrics.memory = [];
    this.metrics.handles = [];
  }
  
  /**
   * 获取统计信息
   */
  getStats(type) {
    const history = this.metrics[type];
    if (!history || history.length === 0) {
      return null;
    }
    
    const values = history.map(item => item.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    return {
      current: this.current[type],
      avg: parseFloat(avg.toFixed(2)),
      min,
      max,
      samples: values.length
    };
  }
  
  /**
   * 获取所有统计信息
   */
  getAllStats() {
    return {
      processes: this.getStats('processes'),
      cpu: this.getStats('cpu'),
      memory: this.getStats('memory'),
      handles: this.getStats('handles')
    };
  }
}

module.exports = ResourceMonitor;
