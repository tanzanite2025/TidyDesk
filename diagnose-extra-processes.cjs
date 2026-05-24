/**
 * 诊断额外进程来源
 * 
 * 目标: 找出为什么有 5-6 个进程而不是预期的 4 个
 * 
 * 预期进程:
 * 1. 主进程 (Main Process)
 * 2. GPU 进程 (GPU Process)
 * 3. handleWindow 渲染进程
 * 4. drawerWindow 渲染进程
 * 
 * 实际进程: 5-6 个
 * 差距: +1-2 个进程
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function diagnoseExtraProcesses() {
  console.log('='.repeat(80));
  console.log('诊断额外进程来源');
  console.log('='.repeat(80));
  console.log();

  try {
    // 1. 获取所有 electron.exe 进程
    const { stdout } = await execPromise(
      'wmic process where "name=\'electron.exe\'" get ProcessId,CommandLine,WorkingSetSize,HandleCount /format:csv',
      { maxBuffer: 1024 * 1024 * 10 }
    );

    const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
    
    console.log(`找到 ${lines.length} 个 electron.exe 进程\n`);

    // 2. 分析每个进程
    const processes = [];
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length < 5) continue;

      // CSV 格式: Node,CommandLine,HandleCount,ProcessId,WorkingSetSize
      const commandLine = parts[1]?.trim() || '';
      const handleCount = parts[2]?.trim() || '0';
      const pid = parts[3]?.trim() || '0';
      const workingSetSize = parts[4]?.trim() || '0';
      
      // 解析进程类型
      let type = 'Unknown';
      let details = '';
      
      if (commandLine.includes('--type=gpu-process')) {
        type = 'GPU Process';
      } else if (commandLine.includes('--type=renderer')) {
        type = 'Renderer Process';
        
        // 尝试识别是哪个窗口
        if (commandLine.includes('mode=rail')) {
          details = '(handleWindow)';
        } else if (commandLine.includes('mode=drawer')) {
          details = '(drawerWindow)';
        } else if (commandLine.includes('mode=todos')) {
          details = '(todoWindow)';
        } else if (commandLine.includes('mode=capture')) {
          details = '(captureWindow)';
        } else if (commandLine.includes('mode=app-picker')) {
          details = '(appPickerWindow)';
        } else {
          details = '(Unknown Window)';
        }
      } else if (commandLine.includes('--type=utility')) {
        type = 'Utility Process';
        
        // 识别 utility 进程的用途
        if (commandLine.includes('--utility-sub-type=network.mojom.NetworkService')) {
          details = '(Network Service)';
        } else if (commandLine.includes('--utility-sub-type=storage.mojom.StorageService')) {
          details = '(Storage Service)';
        } else if (commandLine.includes('--utility-sub-type=audio.mojom.AudioService')) {
          details = '(Audio Service)';
        } else {
          details = '(Unknown Utility)';
        }
      } else if (!commandLine.includes('--type=')) {
        type = 'Main Process';
      }

      processes.push({
        pid: parseInt(pid),
        type,
        details,
        memory: parseInt(workingSetSize) / 1024 / 1024,
        handles: parseInt(handleCount),
        commandLine
      });
    }

    // 3. 按类型分组
    const grouped = {};
    for (const proc of processes) {
      const key = proc.type;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(proc);
    }

    // 4. 输出分析结果
    console.log('进程分类统计:');
    console.log('-'.repeat(80));
    
    let totalProcesses = 0;
    for (const [type, procs] of Object.entries(grouped)) {
      console.log(`\n${type}: ${procs.length} 个`);
      totalProcesses += procs.length;
      
      for (const proc of procs) {
        console.log(`  PID ${proc.pid} ${proc.details}`);
        console.log(`    内存: ${proc.memory.toFixed(2)} MB`);
        console.log(`    句柄: ${proc.handles}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`总进程数: ${totalProcesses}`);
    console.log('='.repeat(80));

    // 5. 分析额外进程
    console.log('\n额外进程分析:');
    console.log('-'.repeat(80));
    
    const expectedProcesses = {
      'Main Process': 1,
      'GPU Process': 1,
      'Renderer Process': 2  // handleWindow + drawerWindow
    };

    let extraProcesses = 0;
    for (const [type, expected] of Object.entries(expectedProcesses)) {
      const actual = grouped[type]?.length || 0;
      const diff = actual - expected;
      
      if (diff > 0) {
        console.log(`❌ ${type}: 预期 ${expected} 个，实际 ${actual} 个，多了 ${diff} 个`);
        extraProcesses += diff;
      } else if (diff < 0) {
        console.log(`⚠️  ${type}: 预期 ${expected} 个，实际 ${actual} 个，少了 ${-diff} 个`);
      } else {
        console.log(`✅ ${type}: ${actual} 个（正常）`);
      }
    }

    // 检查意外的进程类型
    for (const [type, procs] of Object.entries(grouped)) {
      if (!expectedProcesses[type]) {
        console.log(`❓ ${type}: ${procs.length} 个（意外的进程类型）`);
        extraProcesses += procs.length;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`额外进程总数: ${extraProcesses}`);
    console.log('='.repeat(80));

    // 6. 输出详细命令行（用于调试）
    console.log('\n详细命令行参数:');
    console.log('-'.repeat(80));
    for (const proc of processes) {
      console.log(`\nPID ${proc.pid} - ${proc.type} ${proc.details}`);
      console.log(`命令行: ${proc.commandLine.substring(0, 200)}...`);
    }

    // 7. 建议
    console.log('\n' + '='.repeat(80));
    console.log('建议:');
    console.log('-'.repeat(80));
    
    if (grouped['Utility Process']) {
      console.log('⚠️  检测到 Utility Process，这是 Electron 的辅助进程');
      console.log('   - Network Service: 网络服务');
      console.log('   - Storage Service: 存储服务');
      console.log('   - Audio Service: 音频服务');
      console.log('   这些进程是 Electron 自动创建的，无法避免');
    }

    if (grouped['Renderer Process']?.length > 2) {
      console.log('\n❌ 检测到多余的渲染进程！');
      console.log('   可能原因:');
      console.log('   1. todoWindow 或 captureWindow 被意外创建');
      console.log('   2. appPickerWindow 正在运行');
      console.log('   3. 有隐藏的窗口未销毁');
      console.log('   建议: 检查 windows.cjs 中的窗口创建逻辑');
    }

    console.log('\n' + '='.repeat(80));

  } catch (err) {
    console.error('诊断失败:', err.message);
    process.exit(1);
  }
}

diagnoseExtraProcesses();
