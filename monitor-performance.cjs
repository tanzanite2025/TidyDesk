/**
 * TidyDesk 实时性能监控脚本
 * 用于监控运行中的 TidyDesk 应用的性能指标
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

// 性能阈值
const thresholds = {
  processes: { normal: 3, warning: 4, critical: 5 },
  cpu: { normal: 10, warning: 30, critical: 50 },
  memory: { normal: 200, warning: 300, critical: 400 }, // MB
  handles: { normal: 500, warning: 800, critical: 1000 }
};

// 历史数据（用于计算趋势）
const history = {
  processes: [],
  cpu: [],
  memory: [],
  handles: []
};

const historySize = 10; // 保留最近 10 次采样

/**
 * 获取 TidyDesk 进程列表
 */
async function getTidyDeskProcesses() {
  try {
    const { stdout } = await execPromise(
      'powershell "Get-Process | Where-Object {$_.ProcessName -like \'*electron*\'} | Select-Object Id, ProcessName, CPU, WorkingSet, HandleCount | ConvertTo-Json"'
    );
    
    if (!stdout.trim()) {
      return [];
    }
    
    const processes = JSON.parse(stdout);
    return Array.isArray(processes) ? processes : [processes];
  } catch (err) {
    return [];
  }
}

/**
 * 计算总指标
 */
function calculateMetrics(processes) {
  if (processes.length === 0) {
    return {
      count: 0,
      totalCpu: 0,
      totalMemory: 0,
      totalHandles: 0,
      avgCpu: 0,
      avgMemory: 0,
      avgHandles: 0
    };
  }
  
  const totalCpu = processes.reduce((sum, p) => sum + (p.CPU || 0), 0);
  const totalMemory = processes.reduce((sum, p) => sum + (p.WorkingSet || 0), 0);
  const totalHandles = processes.reduce((sum, p) => sum + (p.HandleCount || 0), 0);
  
  return {
    count: processes.length,
    totalCpu: totalCpu.toFixed(2),
    totalMemory: (totalMemory / 1024 / 1024).toFixed(0), // 转换为 MB
    totalHandles: totalHandles,
    avgCpu: (totalCpu / processes.length).toFixed(2),
    avgMemory: (totalMemory / processes.length / 1024 / 1024).toFixed(0),
    avgHandles: Math.round(totalHandles / processes.length)
  };
}

/**
 * 获取状态颜色
 */
function getStatusColor(value, thresholds) {
  if (value <= thresholds.normal) return colors.green;
  if (value <= thresholds.warning) return colors.yellow;
  return colors.red;
}

/**
 * 获取状态标签
 */
function getStatusLabel(value, thresholds) {
  if (value <= thresholds.normal) return '✅ 正常';
  if (value <= thresholds.warning) return '⚠️  警告';
  return '🔴 严重';
}

/**
 * 添加到历史记录
 */
function addToHistory(type, value) {
  history[type].push(value);
  if (history[type].length > historySize) {
    history[type].shift();
  }
}

/**
 * 计算趋势
 */
function calculateTrend(type) {
  const data = history[type];
  if (data.length < 2) return '—';
  
  const recent = data.slice(-3).reduce((sum, v) => sum + v, 0) / Math.min(3, data.length);
  const older = data.slice(0, -3).reduce((sum, v) => sum + v, 0) / Math.max(1, data.length - 3);
  
  const diff = recent - older;
  const percentChange = older === 0 ? 0 : (diff / older * 100);
  
  if (Math.abs(percentChange) < 5) return '→ 稳定';
  if (percentChange > 0) return `↑ +${percentChange.toFixed(1)}%`;
  return `↓ ${percentChange.toFixed(1)}%`;
}

/**
 * 显示监控面板
 */
function displayMonitor(metrics, processes) {
  // 清屏
  console.clear();
  
  // 标题
  console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}   TidyDesk 实时性能监控${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log();
  
  // 时间戳
  console.log(`${colors.white}⏰ 采样时间: ${new Date().toLocaleString('zh-CN')}${colors.reset}`);
  console.log();
  
  // 进程数量
  const processColor = getStatusColor(metrics.count, thresholds.processes);
  const processStatus = getStatusLabel(metrics.count, thresholds.processes);
  const processTrend = calculateTrend('processes');
  console.log(`${colors.bright}📊 进程数量:${colors.reset} ${processColor}${metrics.count}${colors.reset} / 目标: ≤${thresholds.processes.normal}`);
  console.log(`   状态: ${processStatus}  趋势: ${processTrend}`);
  console.log();
  
  // CPU 使用率
  const cpuColor = getStatusColor(parseFloat(metrics.totalCpu), thresholds.cpu);
  const cpuStatus = getStatusLabel(parseFloat(metrics.totalCpu), thresholds.cpu);
  const cpuTrend = calculateTrend('cpu');
  console.log(`${colors.bright}💻 CPU 使用率:${colors.reset} ${cpuColor}${metrics.totalCpu}%${colors.reset} / 目标: <${thresholds.cpu.normal}%`);
  console.log(`   状态: ${cpuStatus}  趋势: ${cpuTrend}`);
  console.log(`   平均: ${metrics.avgCpu}% / 进程`);
  console.log();
  
  // 内存使用
  const memoryColor = getStatusColor(parseFloat(metrics.totalMemory), thresholds.memory);
  const memoryStatus = getStatusLabel(parseFloat(metrics.totalMemory), thresholds.memory);
  const memoryTrend = calculateTrend('memory');
  console.log(`${colors.bright}🧠 内存使用:${colors.reset} ${memoryColor}${metrics.totalMemory} MB${colors.reset} / 目标: <${thresholds.memory.normal} MB`);
  console.log(`   状态: ${memoryStatus}  趋势: ${memoryTrend}`);
  console.log(`   平均: ${metrics.avgMemory} MB / 进程`);
  console.log();
  
  // 句柄数量
  const handlesColor = getStatusColor(metrics.totalHandles, thresholds.handles);
  const handlesStatus = getStatusLabel(metrics.totalHandles, thresholds.handles);
  const handlesTrend = calculateTrend('handles');
  console.log(`${colors.bright}🔗 句柄数量:${colors.reset} ${handlesColor}${metrics.totalHandles}${colors.reset} / 目标: <${thresholds.handles.normal}`);
  console.log(`   状态: ${handlesStatus}  趋势: ${handlesTrend}`);
  console.log(`   平均: ${metrics.avgHandles} / 进程`);
  console.log();
  
  // 进程详情
  if (processes.length > 0) {
    console.log(`${colors.bright}${colors.blue}─────────────────────────────────────────────────────────────${colors.reset}`);
    console.log(`${colors.bright}进程详情:${colors.reset}`);
    console.log();
    
    processes.forEach((p, i) => {
      const memory = (p.WorkingSet / 1024 / 1024).toFixed(0);
      console.log(`  ${i + 1}. PID: ${p.Id}`);
      console.log(`     名称: ${p.ProcessName}`);
      console.log(`     CPU: ${(p.CPU || 0).toFixed(2)}%  内存: ${memory} MB  句柄: ${p.HandleCount}`);
      console.log();
    });
  }
  
  // 底部提示
  console.log(`${colors.bright}${colors.cyan}─────────────────────────────────────────────────────────────${colors.reset}`);
  console.log(`${colors.white}按 Ctrl+C 停止监控${colors.reset}`);
  console.log();
}

/**
 * 主监控循环
 */
async function monitorLoop() {
  const processes = await getTidyDeskProcesses();
  
  if (processes.length === 0) {
    console.clear();
    console.log(`${colors.yellow}⚠️  未检测到 Electron 进程${colors.reset}`);
    console.log(`${colors.white}请先启动 TidyDesk 应用${colors.reset}`);
    console.log();
    console.log(`${colors.cyan}提示: 运行 ${colors.bright}npx electron .${colors.reset}${colors.cyan} 启动应用${colors.reset}`);
    return;
  }
  
  const metrics = calculateMetrics(processes);
  
  // 添加到历史记录
  addToHistory('processes', metrics.count);
  addToHistory('cpu', parseFloat(metrics.totalCpu));
  addToHistory('memory', parseFloat(metrics.totalMemory));
  addToHistory('handles', metrics.totalHandles);
  
  // 显示监控面板
  displayMonitor(metrics, processes);
}

/**
 * 启动监控
 */
async function startMonitoring() {
  console.log(`${colors.bright}${colors.cyan}启动 TidyDesk 性能监控...${colors.reset}`);
  console.log();
  
  // 立即执行一次
  await monitorLoop();
  
  // 每 3 秒更新一次
  setInterval(monitorLoop, 3000);
}

// 处理 Ctrl+C
process.on('SIGINT', () => {
  console.log();
  console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.green}监控已停止${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log();
  
  // 显示历史统计
  if (history.processes.length > 0) {
    console.log(`${colors.bright}历史统计:${colors.reset}`);
    console.log(`  进程数量: 平均 ${(history.processes.reduce((a, b) => a + b, 0) / history.processes.length).toFixed(1)}`);
    console.log(`  CPU 使用率: 平均 ${(history.cpu.reduce((a, b) => a + b, 0) / history.cpu.length).toFixed(1)}%`);
    console.log(`  内存使用: 平均 ${(history.memory.reduce((a, b) => a + b, 0) / history.memory.length).toFixed(0)} MB`);
    console.log(`  句柄数量: 平均 ${Math.round(history.handles.reduce((a, b) => a + b, 0) / history.handles.length)}`);
    console.log();
  }
  
  process.exit(0);
});

// 启动
startMonitoring().catch(err => {
  console.error(`${colors.red}监控启动失败:${colors.reset}`, err);
  process.exit(1);
});
