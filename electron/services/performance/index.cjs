/**
 * Performance Management - 性能管理模块入口
 */

const PerformanceCore = require('./performance-core.cjs');
const ResourceMonitor = require('./resource-monitor.cjs');
const ThrottleManager = require('./throttle-manager.cjs');
const HealthCheck = require('./health-check.cjs');
const ResourceManager = require('./resource-manager.cjs');

module.exports = {
  PerformanceCore,
  ResourceMonitor,
  ThrottleManager,
  HealthCheck,
  ResourceManager
};
