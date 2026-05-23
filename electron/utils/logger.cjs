/**
 * TidyDesk 日志系统
 * 使用 electron-log 提供完整的日志功能
 */

const log = require('electron-log');
const path = require('path');
const { app } = require('electron');

// 配置文件日志
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.file.resolvePathFn = () => {
  return path.join(app.getPath('userData'), 'logs', 'tidydesk.log');
};

// 配置控制台日志
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

// 导出便捷方法
const logger = {
  /**
   * 调试日志
   */
  debug: (...args) => {
    log.debug(...args);
  },
  
  /**
   * 信息日志
   */
  info: (...args) => {
    log.info(...args);
  },
  
  /**
   * 警告日志
   */
  warn: (...args) => {
    log.warn(...args);
  },
  
  /**
   * 错误日志
   */
  error: (...args) => {
    log.error(...args);
  },
  
  /**
   * 获取日志文件路径
   */
  getLogPath: () => {
    try {
      return log.transports.file.getFile().path;
    } catch (err) {
      return null;
    }
  },
  
  /**
   * 获取日志文件夹路径
   */
  getLogDir: () => {
    return path.join(app.getPath('userData'), 'logs');
  }
};

// 记录启动信息
logger.info('='.repeat(60));
logger.info('TidyDesk Logger Initialized');
logger.info(`Version: ${app.getVersion()}`);
logger.info(`Platform: ${process.platform}`);
logger.info(`Node: ${process.versions.node}`);
logger.info(`Electron: ${process.versions.electron}`);
logger.info(`Log file: ${logger.getLogPath()}`);
logger.info('='.repeat(60));

module.exports = logger;
