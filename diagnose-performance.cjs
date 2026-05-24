/**
 * TidyDesk 性能诊断脚本
 * 检查可能导致卡顿的问题
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('='.repeat(60));
console.log('TidyDesk 性能诊断');
console.log('='.repeat(60));
console.log();

// 1. 检查进程信息
console.log('1. 进程信息');
console.log('-'.repeat(60));
const { execSync } = require('child_process');
try {
  const output = execSync('tasklist /FI "IMAGENAME eq TidyDesk.exe" /FO CSV /NH', { encoding: 'utf8' });
  const lines = output.trim().split('\n');
  console.log(`找到 ${lines.length} 个 TidyDesk 进程`);
  if (lines.length > 3) {
    console.log('⚠️  警告: 进程数量过多，可能存在进程泄漏');
  }
} catch (err) {
  console.log('无法获取进程信息');
}
console.log();

// 2. 检查缓存文件
console.log('2. 缓存文件检查');
console.log('-'.repeat(60));
const appDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'TidyDesk');
const cachePath = path.join(appDataPath, 'app-cache.json');

if (fs.existsSync(cachePath)) {
  const stats = fs.statSync(cachePath);
  const sizeKB = (stats.size / 1024).toFixed(2);
  console.log(`缓存文件大小: ${sizeKB} KB`);
  
  if (stats.size > 1024 * 1024) {
    console.log('⚠️  警告: 缓存文件过大');
  }
  
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log(`缓存应用数量: ${cache.apps?.length || 0}`);
    console.log(`缓存时间: ${new Date(cache.timestamp).toLocaleString()}`);
    
    // 检查是否有异常大的图标
    if (cache.apps) {
      let totalIconSize = 0;
      let largeIcons = 0;
      cache.apps.forEach(app => {
        if (app.icon) {
          const iconSize = app.icon.length;
          totalIconSize += iconSize;
          if (iconSize > 100000) { // > 100KB
            largeIcons++;
          }
        }
      });
      console.log(`图标总大小: ${(totalIconSize / 1024 / 1024).toFixed(2)} MB`);
      if (largeIcons > 0) {
        console.log(`⚠️  警告: 发现 ${largeIcons} 个异常大的图标`);
      }
    }
  } catch (err) {
    console.log('⚠️  错误: 无法解析缓存文件');
  }
} else {
  console.log('缓存文件不存在');
}
console.log();

// 3. 检查贴纸数量
console.log('3. 贴纸检查');
console.log('-'.repeat(60));
const stickersPath = path.join(appDataPath, 'stickers.json');
if (fs.existsSync(stickersPath)) {
  try {
    const stickers = JSON.parse(fs.readFileSync(stickersPath, 'utf8'));
    console.log(`贴纸数量: ${stickers.length}`);
    if (stickers.length > 20) {
      console.log('⚠️  警告: 贴纸数量过多，可能影响性能');
    }
    
    // 检查贴纸图片大小
    let totalSize = 0;
    stickers.forEach(sticker => {
      if (fs.existsSync(sticker.imagePath)) {
        const size = fs.statSync(sticker.imagePath).size;
        totalSize += size;
      }
    });
    console.log(`贴纸图片总大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.log('⚠️  错误: 无法解析贴纸文件');
  }
} else {
  console.log('贴纸文件不存在');
}
console.log();

// 4. 检查待办数据
console.log('4. 待办数据检查');
console.log('-'.repeat(60));
const todosPath = path.join(appDataPath, 'todos.json');
if (fs.existsSync(todosPath)) {
  try {
    const todos = JSON.parse(fs.readFileSync(todosPath, 'utf8'));
    const cardCount = todos.cards?.length || 0;
    console.log(`待办卡片数量: ${cardCount}`);
    if (cardCount > 100) {
      console.log('⚠️  警告: 待办卡片过多，可能影响性能');
    }
  } catch (err) {
    console.log('⚠️  错误: 无法解析待办文件');
  }
} else {
  console.log('待办文件不存在');
}
console.log();

// 5. 检查抽屉数据
console.log('5. 抽屉数据检查');
console.log('-'.repeat(60));
const drawersPath = path.join(appDataPath, 'drawers');
if (fs.existsSync(drawersPath)) {
  const folders = fs.readdirSync(drawersPath);
  console.log(`抽屉数量: ${folders.length}`);
  
  let totalFiles = 0;
  folders.forEach(folder => {
    const folderPath = path.join(drawersPath, folder);
    if (fs.statSync(folderPath).isDirectory()) {
      const files = fs.readdirSync(folderPath);
      totalFiles += files.length;
    }
  });
  console.log(`抽屉文件总数: ${totalFiles}`);
  
  if (totalFiles > 500) {
    console.log('⚠️  警告: 抽屉文件过多，可能影响性能');
  }
} else {
  console.log('抽屉目录不存在');
}
console.log();

// 6. 性能建议
console.log('6. 性能优化建议');
console.log('-'.repeat(60));
console.log('✓ 关闭不需要的贴纸窗口');
console.log('✓ 清理过期的待办事项');
console.log('✓ 减少抽屉中的文件数量');
console.log('✓ 重启应用以释放内存');
console.log();

console.log('='.repeat(60));
console.log('诊断完成');
console.log('='.repeat(60));
