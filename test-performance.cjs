/**
 * 性能监控系统测试脚本
 */

const { PerformanceCore } = require('./electron/services/performance/index.cjs');

console.log('='.repeat(60));
console.log('TidyDesk 性能监控系统测试');
console.log('='.repeat(60));
console.log();

// 创建性能核心
const performanceCore = new PerformanceCore({
  monitor: {
    sampleInterval: 3000, // 3 秒采样一次（测试用）
    processName: 'TidyDesk.exe'
  },
  health: {
    checkInterval: 10000 // 10 秒检查一次（测试用）
  }
});

// 监听事件
performanceCore.on('metrics-updated', (metrics) => {
  console.log('\n📊 性能指标更新:');
  console.log(`  进程数量: ${metrics.processes}`);
  console.log(`  CPU 使用率: ${metrics.cpu.toFixed(1)}%`);
  console.log(`  内存使用: ${(metrics.memory / 1024 / 1024).toFixed(0)}MB`);
  console.log(`  句柄数量: ${metrics.handles}`);
});

performanceCore.on('anomalies', (anomalies) => {
  console.log('\n⚠️  检测到异常:');
  anomalies.forEach(anomaly => {
    console.log(`  [${anomaly.severity}] ${anomaly.message}`);
  });
});

performanceCore.on('health-issues', (issues) => {
  console.log('\n🏥 健康检查发现问题:');
  issues.forEach(issue => {
    console.log(`  [${issue.severity}] ${issue.message}`);
    console.log(`    建议操作: ${issue.action}`);
  });
});

performanceCore.on('degradation', (info) => {
  console.log(`\n🔄 降级级别变更: ${info.levelName} (Level ${info.level})`);
  console.log('  采取的措施:');
  info.actions.forEach(action => {
    console.log(`    - ${action}`);
  });
});

performanceCore.on('recommend-restart', () => {
  console.log('\n🔴 建议重启应用以恢复性能');
});

// 启动监控
console.log('启动性能监控...\n');
performanceCore.start();

// 10 秒后显示统计信息
setTimeout(() => {
  console.log('\n' + '='.repeat(60));
  console.log('统计信息');
  console.log('='.repeat(60));
  
  const stats = performanceCore.getAllStats();
  console.log('\n进程数量统计:');
  console.log(`  当前: ${stats.processes.current}`);
  console.log(`  平均: ${stats.processes.avg}`);
  console.log(`  最小: ${stats.processes.min}`);
  console.log(`  最大: ${stats.processes.max}`);
  
  console.log('\nCPU 使用率统计:');
  console.log(`  当前: ${stats.cpu.current.toFixed(1)}%`);
  console.log(`  平均: ${stats.cpu.avg}%`);
  console.log(`  最小: ${stats.cpu.min.toFixed(1)}%`);
  console.log(`  最大: ${stats.cpu.max.toFixed(1)}%`);
  
  console.log('\n内存使用统计:');
  console.log(`  当前: ${(stats.memory.current / 1024 / 1024).toFixed(0)}MB`);
  console.log(`  平均: ${(stats.memory.avg / 1024 / 1024).toFixed(0)}MB`);
  console.log(`  最小: ${(stats.memory.min / 1024 / 1024).toFixed(0)}MB`);
  console.log(`  最大: ${(stats.memory.max / 1024 / 1024).toFixed(0)}MB`);
  
  console.log('\n句柄数量统计:');
  console.log(`  当前: ${stats.handles.current}`);
  console.log(`  平均: ${stats.handles.avg}`);
  console.log(`  最小: ${stats.handles.min}`);
  console.log(`  最大: ${stats.handles.max}`);
  
  const health = performanceCore.getHealthStatus();
  console.log('\n健康状态:');
  console.log(`  状态: ${health.healthy ? '✅ 健康' : '❌ 有问题'}`);
  if (health.issues && health.issues.length > 0) {
    console.log('  问题列表:');
    health.issues.forEach(issue => {
      console.log(`    - ${issue.message}`);
    });
  }
  
  const degradation = performanceCore.getDegradationLevel();
  console.log('\n降级级别:');
  console.log(`  级别: ${degradation.level} (${degradation.name})`);
  
}, 10000);

// 30 秒后停止
setTimeout(() => {
  console.log('\n' + '='.repeat(60));
  console.log('停止性能监控...');
  performanceCore.stop();
  console.log('测试完成！');
  console.log('='.repeat(60));
  process.exit(0);
}, 30000);

// 处理退出信号
process.on('SIGINT', () => {
  console.log('\n\n收到退出信号，停止监控...');
  performanceCore.stop();
  process.exit(0);
});
