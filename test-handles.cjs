/**
 * 测试句柄使用情况
 * 通过 IPC 获取内部句柄信息
 */

const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(async () => {
  console.log('=== 句柄诊断 ===\n');
  
  // 等待主应用启动
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // 获取所有窗口
  const windows = BrowserWindow.getAllWindows();
  console.log(`窗口数量: ${windows.length}`);
  
  // 获取 Node.js 内部句柄
  if (process._getActiveHandles) {
    const handles = process._getActiveHandles();
    console.log(`\nNode.js 活动句柄: ${handles.length}`);
    
    // 统计句柄类型
    const types = {};
    handles.forEach(h => {
      const type = h.constructor.name;
      types[type] = (types[type] || 0) + 1;
    });
    
    console.log('\n句柄类型统计:');
    Object.entries(types)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
  }
  
  // 获取活动请求
  if (process._getActiveRequests) {
    const requests = process._getActiveRequests();
    console.log(`\nNode.js 活动请求: ${requests.length}`);
  }
  
  console.log('\n完成');
  app.quit();
});
