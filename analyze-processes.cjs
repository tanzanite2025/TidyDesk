/**
 * 分析 Electron 进程结构
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function analyzeProcesses() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Electron 进程结构分析');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  
  try {
    // 获取所有 electron 进程
    const { stdout } = await execPromise(
      'powershell "Get-Process | Where-Object {$_.ProcessName -eq \'electron\'} | Select-Object Id, ProcessName, MainWindowTitle, WorkingSet, HandleCount, StartTime | ConvertTo-Json"'
    );
    
    const processes = JSON.parse(stdout);
    const procList = Array.isArray(processes) ? processes : [processes];
    
    console.log(`总进程数: ${procList.length}`);
    console.log();
    
    // 按启动时间排序
    procList.sort((a, b) => {
      const timeA = new Date(a.StartTime).getTime();
      const timeB = new Date(b.StartTime).getTime();
      return timeA - timeB;
    });
    
    // 分析每个进程
    procList.forEach((p, i) => {
      const memory = (p.WorkingSet / 1024 / 1024).toFixed(0);
      const title = p.MainWindowTitle || '(无窗口)';
      const startTime = new Date(p.StartTime);
      
      console.log(`进程 ${i + 1}:`);
      console.log(`  PID: ${p.Id}`);
      console.log(`  窗口标题: ${title}`);
      console.log(`  内存: ${memory} MB`);
      console.log(`  句柄: ${p.HandleCount}`);
      console.log(`  启动时间: ${startTime.toLocaleString('zh-CN')}`);
      console.log();
    });
    
    // 分析进程类型
    console.log('─────────────────────────────────────────────────────────────');
    console.log('进程类型分析:');
    console.log();
    
    const mainProcess = procList.find(p => p.MainWindowTitle && p.MainWindowTitle.length > 0);
    const rendererProcesses = procList.filter(p => !p.MainWindowTitle || p.MainWindowTitle.length === 0);
    
    console.log(`主进程 (有窗口): ${mainProcess ? 1 : 0} 个`);
    if (mainProcess) {
      console.log(`  PID: ${mainProcess.Id}, 窗口: ${mainProcess.MainWindowTitle}`);
    }
    console.log();
    
    console.log(`渲染进程/工具进程 (无窗口): ${rendererProcesses.length} 个`);
    rendererProcesses.forEach((p, i) => {
      const memory = (p.WorkingSet / 1024 / 1024).toFixed(0);
      console.log(`  ${i + 1}. PID: ${p.Id}, 内存: ${memory} MB, 句柄: ${p.HandleCount}`);
    });
    console.log();
    
    // Electron 正常进程结构
    console.log('─────────────────────────────────────────────────────────────');
    console.log('Electron 正常进程结构:');
    console.log();
    console.log('  1. 主进程 (Main Process) - 1 个');
    console.log('     - 负责创建窗口、管理应用生命周期');
    console.log('     - 通常有窗口标题');
    console.log();
    console.log('  2. 渲染进程 (Renderer Process) - 1-2 个');
    console.log('     - 每个 BrowserWindow 一个渲染进程');
    console.log('     - 运行网页内容');
    console.log();
    console.log('  3. GPU 进程 (GPU Process) - 1 个');
    console.log('     - 处理图形渲染');
    console.log();
    console.log('  4. 工具进程 (Utility Process) - 0-2 个');
    console.log('     - 可选的辅助进程');
    console.log();
    console.log('正常情况: 2-4 个进程');
    console.log(`当前情况: ${procList.length} 个进程`);
    console.log();
    
    if (procList.length > 4) {
      console.log('⚠️  进程数量超过正常范围，可能存在进程泄漏！');
      console.log();
      console.log('可能原因:');
      console.log('  1. 有未关闭的窗口（抽屉、待办、截图、应用选择器等）');
      console.log('  2. 有隐藏的窗口没有正确销毁');
      console.log('  3. 渲染进程没有正确退出');
      console.log('  4. 创建了多余的 BrowserWindow');
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    
  } catch (err) {
    console.error('分析失败:', err);
  }
}

analyzeProcesses().catch(console.error);
