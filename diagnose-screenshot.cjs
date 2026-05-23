/**
 * 截图功能诊断脚本
 * 运行: node diagnose-screenshot.cjs
 */

const fs = require('fs');
const path = require('path');

console.log('=== TidyDesk 截图功能诊断 ===\n');

// 1. 检查关键文件是否存在
console.log('1. 检查关键文件...');
const files = [
  'electron/services/stickers.cjs',
  'electron/preload.cjs',
  'electron/main.cjs',
  'src/modules/stickers/SnipOverlayApp.tsx',
  'src/modules/stickers/StickerApp.tsx',
  'src/modules/rail/RailApp.tsx'
];

let allFilesExist = true;
for (const file of files) {
  const exists = fs.existsSync(file);
  console.log(`  ${exists ? '✅' : '❌'} ${file}`);
  if (!exists) allFilesExist = false;
}

if (!allFilesExist) {
  console.log('\n❌ 部分关键文件缺失！');
  process.exit(1);
}

console.log('\n2. 检查 stickers.cjs 中的关键函数...');
const stickersContent = fs.readFileSync('electron/services/stickers.cjs', 'utf8');
const requiredFunctions = [
  'startScreenshot',
  'createSnipWindow',
  'captureSelection',
  'createStickerWindow',
  'registerIpcHandlers'
];

for (const func of requiredFunctions) {
  const exists = stickersContent.includes(`function ${func}`) || stickersContent.includes(`${func}:`);
  console.log(`  ${exists ? '✅' : '❌'} ${func}`);
}

console.log('\n3. 检查 preload.cjs 中的 API 暴露...');
const preloadContent = fs.readFileSync('electron/preload.cjs', 'utf8');
const requiredApis = [
  'completeSnipSelection',
  'cancelSnip',
  'getSticker',
  'toggleStickerPin',
  'copySticker',
  'saveStickerAs',
  'closeSticker',
  'onStickerUpdated'
];

for (const api of requiredApis) {
  const exists = preloadContent.includes(api);
  console.log(`  ${exists ? '✅' : '❌'} ${api}`);
}

console.log('\n4. 检查 main.cjs 中的事件监听...');
const mainContent = fs.readFileSync('electron/main.cjs', 'utf8');
const requiredListeners = [
  'start-screenshot',
  'startScreenshot',
  'stickerService'
];

for (const listener of requiredListeners) {
  const exists = mainContent.includes(listener);
  console.log(`  ${exists ? '✅' : '❌'} ${listener}`);
}

console.log('\n5. 检查 IPC 处理器注册...');
const ipcHandlers = [
  'snip-complete-selection',
  'snip-cancel',
  'sticker-get',
  'sticker-toggle-pin',
  'sticker-copy',
  'sticker-save-as',
  'sticker-close'
];

for (const handler of ipcHandlers) {
  const exists = stickersContent.includes(`'${handler}'`) || stickersContent.includes(`"${handler}"`);
  console.log(`  ${exists ? '✅' : '❌'} ${handler}`);
}

console.log('\n6. 检查 package.json 依赖...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const electronVersion = packageJson.devDependencies?.electron || packageJson.dependencies?.electron;
console.log(`  Electron 版本: ${electronVersion || '未找到'}`);

if (!electronVersion) {
  console.log('  ❌ Electron 未安装！');
} else {
  console.log('  ✅ Electron 已安装');
}

console.log('\n7. 检查存储目录结构...');
const userDataPath = process.env.APPDATA || process.env.HOME;
if (userDataPath) {
  const stickerPath = path.join(userDataPath, 'TidyDesk', 'stickers');
  const imagePath = path.join(stickerPath, 'images');
  const statePath = path.join(stickerPath, 'stickers.json');
  
  console.log(`  存储路径: ${stickerPath}`);
  console.log(`  ${fs.existsSync(stickerPath) ? '✅' : '⚠️'} stickers/ 目录 ${fs.existsSync(stickerPath) ? '存在' : '不存在（首次运行时会自动创建）'}`);
  console.log(`  ${fs.existsSync(imagePath) ? '✅' : '⚠️'} images/ 目录 ${fs.existsSync(imagePath) ? '存在' : '不存在（首次运行时会自动创建）'}`);
  console.log(`  ${fs.existsSync(statePath) ? '✅' : '⚠️'} stickers.json ${fs.existsSync(statePath) ? '存在' : '不存在（首次运行时会自动创建）'}`);
  
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      console.log(`  📊 当前贴纸数量: ${state.stickers?.length || 0}`);
    } catch (err) {
      console.log(`  ❌ stickers.json 格式错误: ${err.message}`);
    }
  }
} else {
  console.log('  ⚠️ 无法确定用户数据目录');
}

console.log('\n8. 检查 SnipOverlayApp 组件...');
const snipContent = fs.readFileSync('src/modules/stickers/SnipOverlayApp.tsx', 'utf8');
const snipChecks = [
  'completeSnipSelection',
  'cancelSnip',
  'onMouseDown',
  'onMouseMove',
  'onMouseUp',
  'Escape'
];

for (const check of snipChecks) {
  const exists = snipContent.includes(check);
  console.log(`  ${exists ? '✅' : '❌'} ${check}`);
}

console.log('\n9. 检查 StickerApp 组件...');
const stickerAppContent = fs.readFileSync('src/modules/stickers/StickerApp.tsx', 'utf8');
const stickerAppChecks = [
  'getSticker',
  'toggleStickerPin',
  'copySticker',
  'saveStickerAs',
  'closeSticker',
  'onStickerUpdated'
];

for (const check of stickerAppChecks) {
  const exists = stickerAppContent.includes(check);
  console.log(`  ${exists ? '✅' : '❌'} ${check}`);
}

console.log('\n10. 检查 RailApp 中的截图按钮...');
const railContent = fs.readFileSync('src/modules/rail/RailApp.tsx', 'utf8');
const railChecks = [
  'start-screenshot',
  'Scissors',
  'screenshot'
];

for (const check of railChecks) {
  const exists = railContent.includes(check);
  console.log(`  ${exists ? '✅' : '❌'} ${check}`);
}

console.log('\n=== 诊断完成 ===\n');

// 总结
console.log('📋 诊断总结:');
console.log('  - 如果所有检查都通过（✅），说明代码结构正常');
console.log('  - 如果有失败项（❌），请检查对应的文件');
console.log('  - 如果代码正常但功能不工作，请：');
console.log('    1. 运行 npm run dev 并查看控制台日志');
console.log('    2. 按 Ctrl+Alt+S 或点击截图按钮');
console.log('    3. 查看是否有错误信息');
console.log('    4. 参考 docs/development/SCREENSHOT_TROUBLESHOOTING.md');
console.log('\n💡 提示: 如果是权限问题（macOS），需要授予屏幕录制权限');
console.log('💡 提示: 如果是 Windows，通常不需要特殊权限');
console.log('\n');
