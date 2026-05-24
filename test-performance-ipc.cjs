/**
 * 测试性能系统的 IPC 接口
 */

const { app, ipcMain } = require('electron');

async function testPerformanceIPC() {
  console.log('Testing Performance IPC...');
  console.log();
  
  // 模拟 IPC 调用
  const { ipcRenderer } = require('electron');
  
  try {
    // 1. 获取性能状态
    console.log('1. Testing get-performance-status...');
    const statusResult = await ipcRenderer.invoke('get-performance-status');
    console.log('Status:', JSON.stringify(statusResult, null, 2));
    console.log();
    
    // 2. 获取资源统计
    console.log('2. Testing get-resource-stats...');
    const statsResult = await ipcRenderer.invoke('get-resource-stats');
    console.log('Stats:', JSON.stringify(statsResult, null, 2));
    console.log();
    
    // 3. 检测资源泄漏
    console.log('3. Testing detect-resource-leaks...');
    const leaksResult = await ipcRenderer.invoke('detect-resource-leaks');
    console.log('Leaks:', JSON.stringify(leaksResult, null, 2));
    console.log();
    
  } catch (err) {
    console.error('Error:', err);
  }
}

// 这个脚本需要在渲染进程中运行
console.log('This script needs to be run from the renderer process.');
console.log('Use the browser console in the TidyDesk app instead.');
