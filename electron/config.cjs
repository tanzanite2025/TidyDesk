/**
 * TidyDesk 配置常量
 * 集中管理所有魔法数字和配置项
 */

module.exports = {
  // 文件扫描配置
  SCAN: {
    MAX_RECURSION_DEPTH: 3,           // 最大递归深度
    SKIP_DIRECTORIES: [                // 跳过的目录
      'Accessories',
      'Administrative Tools',
      'Maintenance',
      'System Tools',
      'Startup'
    ]
  },

  // 文件大小限制
  FILE: {
    MAX_SIZE_WARNING: 1024 * 1024 * 1024,  // 1GB - 警告阈值
    MAX_SIZE_REJECT: 5 * 1024 * 1024 * 1024, // 5GB - 拒绝阈值
    MAX_BATCH_COUNT: 100                     // 批量操作最大文件数
  },

  // 验证配置
  VALIDATION: {
    INTERVAL: 30 * 60 * 1000,         // 30分钟 - 定期验证间隔
    ANIMATION_DURATION: 250           // 250ms - 动画时长
  },

  // 缓存配置
  CACHE: {
    APP_SCAN_TTL: 60 * 60 * 1000,     // 1小时 - 应用扫描缓存时间
    ICON_CACHE_SIZE: 100              // 图标缓存数量
  },

  // 窗口配置
  WINDOW: {
    MIN_WIDTH: 48,
    MIN_HEIGHT: 120,
    HANDLE_WIDTH: 56,
    HANDLE_HEIGHT: 288,
    DRAWER_WIDTH_RATIO: 0.3,          // 抽屉宽度占屏幕比例
    DRAWER_MIN_WIDTH: 360,
    DRAWER_MAX_WIDTH: 560,
    TODO_WIDTH_RATIO: 0.42,           // 保留兼容：旧待办侧栏宽度比例
    TODO_MIN_WIDTH: 760,
    TODO_MIN_HEIGHT: 520,
    TODO_WIDTH: 980,
    TODO_HEIGHT: 680,
    TODO_MAX_WIDTH: 1120,
    CAPTURE_WIDTH: 460,
    CAPTURE_HEIGHT: 320,
    APP_PICKER_WIDTH: 680,            // 应用选择器宽度
    APP_PICKER_HEIGHT: 720,           // 应用选择器高度
    CORNER_RADIUS: 32                 // 圆角半径（Windows 11）
  },

  // 系统路径（保护）
  SYSTEM_PATHS: [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ],

  // 搜索位置
  SEARCH_PATHS: {
    START_MENU: [
      'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
      '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs'
    ],
    COMMON_LOCATIONS: [
      '%USERPROFILE%\\Desktop',
      '%USERPROFILE%\\Documents',
      '%USERPROFILE%\\Downloads',
      '%USERPROFILE%\\Pictures',
      '%USERPROFILE%\\Videos'
    ]
  },

  // 应用分类关键词
  APP_CATEGORIES: {
    browser: ['chrome', 'firefox', 'edge', 'browser'],
    development: ['visual studio', 'vscode', 'code', 'git'],
    office: ['word', 'excel', 'powerpoint', 'office', 'wps'],
    communication: ['wechat', 'qq', 'dingtalk', 'teams', '微信', '钉钉'],
    media: ['player', 'music', 'video', 'photoshop']
  },

  // 过滤关键词
  FILTER_KEYWORDS: {
    uninstall: ['uninstall', 'unins', 'setup', 'installer'],
    protected: ['desktop.ini', 'tidydesk', 'node_modules', '.git', '.github', '桌面收纳盒']
  },

  // 日志配置
  LOG: {
    LEVEL: 'info',                    // 日志级别
    MAX_FILE_SIZE: 10 * 1024 * 1024   // 10MB - 日志文件最大大小
  },

  // 常驻机制配置
  RESIDENT: {
    ENABLE_TRAY: true,                    // 启用系统托盘
    ENABLE_AUTO_START: true,              // 启用开机自启
    ENABLE_WATCHDOG: false,               // 启用守护进程（可选，暂未实现）
    MEMORY_CHECK_INTERVAL: 10 * 60 * 1000, // 内存检查间隔（10分钟）
    MEMORY_WARNING_THRESHOLD: 500 * 1024 * 1024, // 内存警告阈值（500MB）
    CACHE_CLEANUP_INTERVAL: 60 * 60 * 1000, // 缓存清理间隔（1小时）
    HIDE_ON_CLOSE: true,                  // 关闭窗口时隐藏而不是退出
    MINIMIZE_TO_TRAY: true                // 最小化到托盘
  }
};
