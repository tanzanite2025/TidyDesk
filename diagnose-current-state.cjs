/**
 * 诊断当前 TidyDesk 的性能状态
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function diagnose() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   TidyDesk 性能诊断报告');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  
  // 1. 获取所有 electron 进程
  console.log('📊 进程分析:');
  console.log('─────────────────────────────────────────────────────────────');
  
  try {
    const { stdout } = await execPromise(
      'powershell "Get-Process | Where-Object {$_.ProcessName -like \'*electron*\'} | Select-Object Id, ProcessName, CPU, WorkingSet, HandleCount, StartTime | ConvertTo-Json"'
    );
    
    const processes = JSON.parse(stdout);
    const procList = Array.isArray(processes) ? processes : [processes];
    
    console.log(`总进程数: ${procList.length}`);
    console.log();
    
    let totalCpu = 0;
    let totalMemory = 0;
    let totalHandles = 0;
    
    procList.forEach((p, i) => {
      const memory = (p.WorkingSet / 1024 / 1024).toFixed(0);
      const cpu = (p.CPU || 0).toFixed(2);
      
      totalCpu += parseFloat(cpu);
      totalMemory += parseInt(memory);
      totalHandles += p.HandleCount;
      
      console.log(`进程 ${i + 1}:`);
      console.log(`  PID: ${p.Id}`);
      console.log(`  CPU: ${cpu}%`);
      console.log(`  内存: ${memory} MB`);
      console.log(`  句柄: ${p.HandleCount}`);
      console.log(`  启动时间: ${p.StartTime}`);
      console.log();
    });
    
    console.log('─────────────────────────────────────────────────────────────');
    console.log('总计:');
    console.log(`  CPU: ${totalCpu.toFixed(2)}%`);
    console.log(`  内存: ${totalMemory} MB`);
    console.log(`  句柄: ${totalHandles}`);
    console.log();
    
    // 2. 性能评估
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📈 性能评估:');
    console.log('─────────────────────────────────────────────────────────────');
    
    const issues = [];
    
    if (procList.length > 3) {
      issues.push({
        severity: '🔴 严重',
        type: '进程泄漏',
        current: procList.length,
        target: '≤3',
        message: `检测到 ${procList.length} 个进程，超过目标值`
      });
    }
    
    if (totalCpu > 50) {
      issues.push({
        severity: '🔴 严重',
        type: 'CPU 过高',
        current: `${totalCpu.toFixed(1)}%`,
        target: '<10%',
        message: 'CPU 使用率严重超标'
      });
    } else if (totalCpu > 30) {
      issues.push({
        severity: '⚠️  警告',
        type: 'CPU 偏高',
        current: `${totalCpu.toFixed(1)}%`,
        target: '<10%',
        message: 'CPU 使用率偏高'
      });
    }
    
    if (totalMemory > 300) {
      issues.push({
        severity: '🔴 严重',
        type: '内存过高',
        current: `${totalMemory} MB`,
        target: '<200 MB',
        message: '内存使用严重超标'
      });
    } else if (totalMemory > 200) {
      issues.push({
        severity: '⚠️  警告',
        type: '内存偏高',
        current: `${totalMemory} MB`,
        target: '<200 MB',
        message: '内存使用偏高'
      });
    }
    
    if (totalHandles > 1000) {
      issues.push({
        severity: '🔴 严重',
        type: '句柄泄漏',
        current: totalHandles,
        target: '<500',
        message: '句柄数量严重超标'
      });
    } else if (totalHandles > 800) {
      issues.push({
        severity: '⚠️  警告',
        type: '句柄偏高',
        current: totalHandles,
        target: '<500',
        message: '句柄数量偏高'
      });
    }
    
    if (issues.length === 0) {
      console.log('✅ 所有指标正常');
    } else {
      console.log(`发现 ${issues.length} 个问题:\n`);
      issues.forEach((issue, i) => {
        console.log(`${i + 1}. ${issue.severity} ${issue.type}`);
        console.log(`   当前值: ${issue.current}`);
        console.log(`   目标值: ${issue.target}`);
        console.log(`   说明: ${issue.message}`);
        console.log();
      });
    }
    
    // 3. 建议
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('💡 优化建议:');
    console.log('─────────────────────────────────────────────────────────────');
    
    if (procList.length > 3) {
      console.log('1. 进程泄漏问题:');
      console.log('   - Electron 会创建多个进程（主进程、渲染进程、GPU 进程等）');
      console.log('   - 正常情况应该是 2-3 个进程');
      console.log('   - 当前有 ' + procList.length + ' 个进程，可能存在泄漏');
      console.log('   - 建议: 检查是否有未关闭的窗口或后台任务');
      console.log();
    }
    
    if (totalCpu > 30) {
      console.log('2. CPU 使用率过高:');
      console.log('   - 可能原因: 频繁的轮询、动画、或计算密集型任务');
      console.log('   - 建议: 检查注册表监听频率、减少不必要的定时器');
      console.log();
    }
    
    if (totalHandles > 800) {
      console.log('3. 句柄泄漏:');
      console.log('   - 可能原因: 定时器、事件监听器、文件句柄未正确清理');
      console.log('   - 建议: 使用 ResourceManager 统一管理资源');
      console.log();
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    
  } catch (err) {
    console.error('诊断失败:', err);
  }
}

diagnose().catch(console.error);
