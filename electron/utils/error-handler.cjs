/**
 * TidyDesk 错误处理工具
 * 提供统一的错误处理和用户反馈机制
 */

const { dialog } = require('electron');
const logger = require('./logger.cjs');

/**
 * TidyDesk 自定义错误类
 */
class TidyDeskError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'TidyDeskError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * 错误代码定义
 */
const ErrorCodes = {
  // 文件操作错误
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_PATH: 'INVALID_FILE_PATH',
  
  // 抽屉操作错误
  DRAWER_CREATE_FAILED: 'DRAWER_CREATE_FAILED',
  DRAWER_NOT_FOUND: 'DRAWER_NOT_FOUND',
  DRAWER_NAME_INVALID: 'DRAWER_NAME_INVALID',
  
  // 导入错误
  IMPORT_FAILED: 'IMPORT_FAILED',
  SHORTCUT_CREATE_FAILED: 'SHORTCUT_CREATE_FAILED',
  
  // 系统错误
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  
  // 配置错误
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_LOAD_FAILED: 'CONFIG_LOAD_FAILED'
};

/**
 * 错误消息映射（用户友好的消息）
 */
const ErrorMessages = {
  [ErrorCodes.FILE_NOT_FOUND]: '文件不存在或已被删除',
  [ErrorCodes.FILE_ACCESS_DENIED]: '没有权限访问该文件',
  [ErrorCodes.FILE_TOO_LARGE]: '文件太大，无法处理',
  [ErrorCodes.INVALID_FILE_PATH]: '文件路径无效',
  [ErrorCodes.DRAWER_CREATE_FAILED]: '创建抽屉失败',
  [ErrorCodes.DRAWER_NOT_FOUND]: '抽屉不存在',
  [ErrorCodes.DRAWER_NAME_INVALID]: '抽屉名称无效',
  [ErrorCodes.IMPORT_FAILED]: '导入文件失败',
  [ErrorCodes.SHORTCUT_CREATE_FAILED]: '创建快捷方式失败',
  [ErrorCodes.SYSTEM_ERROR]: '系统错误',
  [ErrorCodes.PERMISSION_DENIED]: '权限不足',
  [ErrorCodes.CONFIG_INVALID]: '配置无效',
  [ErrorCodes.CONFIG_LOAD_FAILED]: '加载配置失败'
};

/**
 * 处理错误
 * @param {Error} error - 错误对象
 * @param {string} context - 错误上下文
 * @param {Object} options - 选项
 * @param {boolean} options.showDialog - 是否显示对话框
 * @param {boolean} options.sendToRenderer - 是否发送到渲染进程
 * @param {BrowserWindow} options.window - 目标窗口
 */
function handleError(error, context = '', options = {}) {
  const {
    showDialog = false,
    sendToRenderer = true,
    window = null
  } = options;
  
  // 记录错误到日志
  logger.error(`[${context}] Error:`, error);
  if (error.stack) {
    logger.error('Stack trace:', error.stack);
  }
  
  // 获取用户友好的错误消息
  let userMessage = error.message;
  if (error instanceof TidyDeskError && ErrorMessages[error.code]) {
    userMessage = ErrorMessages[error.code];
  }
  
  // 显示错误对话框
  if (showDialog) {
    dialog.showErrorBox(
      'TidyDesk 错误',
      `${userMessage}\n\n如果问题持续，请查看日志文件或联系支持。`
    );
  }
  
  // 发送到渲染进程
  if (sendToRenderer && window && !window.isDestroyed()) {
    window.webContents.send('error-notification', {
      message: userMessage,
      code: error.code || 'UNKNOWN',
      context,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * 包装异步操作，自动处理错误
 * @param {Function} operation - 异步操作
 * @param {string} context - 操作上下文
 * @param {Object} options - 错误处理选项
 */
async function wrapAsync(operation, context, options = {}) {
  try {
    return await operation();
  } catch (error) {
    handleError(error, context, options);
    throw error;
  }
}

/**
 * 创建错误对象
 * @param {string} code - 错误代码
 * @param {string} message - 自定义消息（可选）
 * @param {Object} details - 错误详情
 */
function createError(code, message = null, details = {}) {
  const errorMessage = message || ErrorMessages[code] || '未知错误';
  return new TidyDeskError(errorMessage, code, details);
}

module.exports = {
  TidyDeskError,
  ErrorCodes,
  ErrorMessages,
  handleError,
  wrapAsync,
  createError
};
