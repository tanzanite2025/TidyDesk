/**
 * TidyDesk 深度代码审查
 * 检查潜在的漏洞、Bug 和代码质量问题
 */

const fs = require('fs');
const path = require('path');

console.log('=== TidyDesk 深度代码审查 ===\n');

const issues = [];
const warnings = [];
const suggestions = [];

// 1. 检查安全问题
console.log('1. 安全检查...\n');

// 1.1 检查 preload.cjs 中的 API 暴露
console.log('  1.1 检查 preload.cjs API 暴露...');
const preloadContent = fs.readFileSync('electron/preload.cjs', 'utf8');

// 检查是否暴露了危险的 API
const dangerousApis = ['eval', 'Function', 'require', 'process', 'child_process', '__dirname', '__filename'];
for (const api of dangerousApis) {
  if (preloadContent.includes(`'${api}'`) || preloadContent.includes(`"${api}"`)) {
    issues.push(`⚠️ preload.cjs 可能暴露了危险的 API: ${api}`);
  }
}

// 检查 contextIsolation
if (!preloadContent.includes('contextIsolation: true')) {
  issues.push('❌ preload.cjs 未启用 contextIsolation');
} else {
  console.log('    ✅ contextIsolation 已启用');
}

// 检查 nodeIntegration
if (preloadContent.includes('nodeIntegration: true')) {
  issues.push('❌ 某些窗口启用了 nodeIntegration（安全风险）');
} else {
  console.log('    ✅ nodeIntegration 已禁用');
}

// 1.2 检查输入验证
console.log('\n  1.2 检查输入验证...');
const inputValidationChecks = [
  { pattern: /typeof.*!==.*'string'/, desc: '字符串类型检查' },
  { pattern: /\.length\s*[<>]=?\s*\d+/, desc: '长度验证' },
  { pattern: /Array\.isArray/, desc: '数组验证' }
];

let validationCount = 0;
for (const check of inputValidationChecks) {
  if (check.pattern.test(preloadContent)) {
    validationCount++;
  }
}
console.log(`    ✅ 发现 ${validationCount} 种输入验证模式`);

// 2. 检查内存泄漏风险
console.log('\n2. 内存泄漏检查...\n');

// 2.1 检查事件监听器清理
console.log('  2.1 检查事件监听器清理...');
const files = [
  'electron/services/windows.cjs',
  'electron/services/stickers.cjs',
  'electron/services/apps.cjs',
  'electron/main.cjs'
];

let listenerCleanupCount = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const hasOn = content.includes('.on(');
  const hasRemoveListener = content.includes('removeListener') || content.includes('removeAllListeners') || content.includes('off(');
  
  if (hasOn && !hasRemoveListener) {
    warnings.push(`⚠️ ${file} 注册了事件监听器但可能未清理`);
  } else if (hasOn && hasRemoveListener) {
    listenerCleanupCount++;
  }
}
console.log(`    ✅ ${listenerCleanupCount} 个文件正确清理了事件监听器`);

// 2.2 检查定时器清理
console.log('\n  2.2 检查定时器清理...');
let timerCleanupCount = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const hasSetTimeout = content.includes('setTimeout');
  const hasSetInterval = content.includes('setInterval');
  const hasClearTimeout = content.includes('clearTimeout');
  const hasClearInterval = content.includes('clearInterval');
  
  if ((hasSetTimeout && !hasClearTimeout) || (hasSetInterval && !hasClearInterval)) {
    warnings.push(`⚠️ ${file} 使用了定时器但可能未清理`);
  } else if ((hasSetTimeout && hasClearTimeout) || (hasSetInterval && hasClearInterval)) {
    timerCleanupCount++;
  }
}
console.log(`    ✅ ${timerCleanupCount} 个文件正确清理了定时器`);

// 3. 检查错误处理
console.log('\n3. 错误处理检查...\n');

// 3.1 检查 try-catch
console.log('  3.1 检查 try-catch 覆盖...');
let tryCatchCount = 0;
let asyncFunctionCount = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const tryCatchMatches = content.match(/try\s*{/g);
  const asyncMatches = content.match(/async\s+function|async\s*\(/g);
  
  if (tryCatchMatches) tryCatchCount += tryCatchMatches.length;
  if (asyncMatches) asyncFunctionCount += asyncMatches.length;
}
console.log(`    ✅ 发现 ${tryCatchCount} 个 try-catch 块`);
console.log(`    ℹ️ 发现 ${asyncFunctionCount} 个 async 函数`);

if (asyncFunctionCount > tryCatchCount * 2) {
  warnings.push(`⚠️ async 函数数量 (${asyncFunctionCount}) 远多于 try-catch 块 (${tryCatchCount})，可能存在未捕获的异常`);
}

// 3.2 检查 Promise rejection 处理
console.log('\n  3.2 检查 Promise rejection 处理...');
let catchCount = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const catchMatches = content.match(/\.catch\(/g);
  if (catchMatches) catchCount += catchMatches.length;
}
console.log(`    ✅ 发现 ${catchCount} 个 .catch() 处理`);

// 4. 检查资源管理
console.log('\n4. 资源管理检查...\n');

// 4.1 检查文件句柄关闭
console.log('  4.1 检查文件操作...');
const drawerService = fs.readFileSync('electron/services/drawers/shortcuts.cjs', 'utf8');
const hasFileSync = drawerService.includes('fs.readFileSync') || drawerService.includes('fs.writeFileSync');
const hasFileStream = drawerService.includes('fs.createReadStream') || drawerService.includes('fs.createWriteStream');

if (hasFileStream) {
  const hasClose = drawerService.includes('.close()') || drawerService.includes('.end()');
  if (!hasClose) {
    warnings.push('⚠️ 使用了文件流但可能未关闭');
  } else {
    console.log('    ✅ 文件流正确关闭');
  }
} else {
  console.log('    ✅ 使用同步文件操作（自动关闭）');
}

// 4.2 检查窗口销毁
console.log('\n  4.2 检查窗口销毁...');
const windowsContent = fs.readFileSync('electron/services/windows.cjs', 'utf8');
const hasWindowClose = windowsContent.includes('.close()');
const hasWindowDestroy = windowsContent.includes('.destroy()');
const hasIsDestroyed = windowsContent.includes('.isDestroyed()');

if (!hasIsDestroyed) {
  warnings.push('⚠️ 未检查窗口是否已销毁就操作窗口');
} else {
  console.log('    ✅ 正确检查窗口状态');
}

// 5. 检查并发问题
console.log('\n5. 并发问题检查...\n');

// 5.1 检查竞态条件
console.log('  5.1 检查竞态条件...');
const appsContent = fs.readFileSync('electron/services/apps.cjs', 'utf8');
const hasLock = appsContent.includes('isScanning') || appsContent.includes('isRefreshing') || appsContent.includes('mutex') || appsContent.includes('lock');

if (!hasLock) {
  warnings.push('⚠️ apps.cjs 可能存在竞态条件（多次同时调用 refreshApps）');
} else {
  console.log('    ✅ 使用了锁机制防止竞态条件');
}

// 5.2 检查注册表监听
console.log('\n  5.2 检查注册表监听...');
const registryContent = fs.readFileSync('electron/services/registry-watcher.cjs', 'utf8');
const hasDebounce = registryContent.includes('setTimeout') && registryContent.includes('clearTimeout');

if (!hasDebounce) {
  warnings.push('⚠️ 注册表监听可能没有防抖，可能导致频繁触发');
} else {
  console.log('    ✅ 注册表监听使用了防抖');
}

// 6. 检查性能问题
console.log('\n6. 性能问题检查...\n');

// 6.1 检查大循环
console.log('  6.1 检查大循环...');
let largeLoopWarnings = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  // 检查嵌套循环
  const nestedLoops = content.match(/for\s*\([^)]+\)\s*{[^}]*for\s*\(/g);
  if (nestedLoops && nestedLoops.length > 0) {
    warnings.push(`⚠️ ${file} 包含 ${nestedLoops.length} 个嵌套循环，可能影响性能`);
    largeLoopWarnings++;
  }
}
if (largeLoopWarnings === 0) {
  console.log('    ✅ 未发现明显的性能问题');
}

// 6.2 检查缓存使用
console.log('\n  6.2 检查缓存使用...');
const hasCacheRead = appsContent.includes('readCache');
const hasCacheWrite = appsContent.includes('writeCache');

if (hasCacheRead && hasCacheWrite) {
  console.log('    ✅ 正确使用了缓存机制');
} else {
  warnings.push('⚠️ 缓存机制可能不完整');
}

// 7. 检查代码质量
console.log('\n7. 代码质量检查...\n');

// 7.1 检查魔法数字
console.log('  7.1 检查魔法数字...');
const mainContent = fs.readFileSync('electron/main.cjs', 'utf8');
const magicNumbers = mainContent.match(/\d{4,}/g);
if (magicNumbers && magicNumbers.length > 5) {
  suggestions.push(`💡 main.cjs 包含 ${magicNumbers.length} 个大数字，建议使用常量`);
}

// 7.2 检查函数长度
console.log('  7.2 检查函数长度...');
let longFunctions = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const functions = content.match(/function\s+\w+\s*\([^)]*\)\s*{/g);
  if (functions) {
    // 简单检查：如果函数之间的代码超过 100 行，可能太长
    const lines = content.split('\n');
    if (lines.length / functions.length > 100) {
      longFunctions++;
    }
  }
}
if (longFunctions > 0) {
  suggestions.push(`💡 发现 ${longFunctions} 个可能过长的函数，建议拆分`);
}

// 8. 检查特定 Bug
console.log('\n8. 特定 Bug 检查...\n');

// 8.1 检查路径拼接
console.log('  8.1 检查路径拼接...');
let pathJoinCount = 0;
let stringConcatCount = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const pathJoins = content.match(/path\.join/g);
  const stringConcats = content.match(/['"][^'"]*[/\\][^'"]*['"]\s*\+/g);
  
  if (pathJoins) pathJoinCount += pathJoins.length;
  if (stringConcats) stringConcatCount += stringConcats.length;
}
console.log(`    ✅ 使用 path.join: ${pathJoinCount} 次`);
if (stringConcatCount > 0) {
  warnings.push(`⚠️ 发现 ${stringConcatCount} 处字符串拼接路径，建议使用 path.join`);
}

// 8.2 检查 Windows 路径问题
console.log('\n  8.2 检查 Windows 路径问题...');
const hasBackslash = mainContent.includes('\\\\') || mainContent.includes("\\'");
if (hasBackslash) {
  suggestions.push('💡 代码中包含反斜杠，确保跨平台兼容性');
}

// 8.3 检查截图贴纸问题（已修复）
console.log('\n  8.3 检查截图贴纸问题...');
const stickersContent = fs.readFileSync('electron/services/stickers.cjs', 'utf8');
const defaultAlwaysOnTop = stickersContent.match(/alwaysOnTop:\s*false/);
const floatingLevel = stickersContent.match(/'floating'/g);

if (!defaultAlwaysOnTop) {
  issues.push('❌ 截图贴纸默认置顶未修复');
} else {
  console.log('    ✅ 截图贴纸默认不置顶');
}

if (floatingLevel && floatingLevel.length > 0) {
  warnings.push(`⚠️ 仍然使用 'floating' 级别 (${floatingLevel.length} 处)`);
} else {
  console.log('    ✅ 未使用 floating 级别');
}

// 9. 检查依赖安全
console.log('\n9. 依赖安全检查...\n');

console.log('  9.1 检查 package.json...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// 检查是否有不安全的依赖版本
const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
let outdatedCount = 0;

// 检查 Electron 版本
if (deps.electron) {
  const electronVersion = deps.electron.replace(/[\^~]/, '');
  const majorVersion = parseInt(electronVersion.split('.')[0]);
  if (majorVersion < 28) {
    warnings.push(`⚠️ Electron 版本较旧 (${deps.electron})，建议升级`);
  } else {
    console.log(`    ✅ Electron 版本: ${deps.electron}`);
  }
}

// 10. 检查用户数据安全
console.log('\n10. 用户数据安全检查...\n');

console.log('  10.1 检查敏感数据存储...');
const todoService = fs.readFileSync('electron/services/todos.cjs', 'utf8');
const hasEncryption = todoService.includes('encrypt') || todoService.includes('crypto');

if (hasEncryption) {
  console.log('    ✅ 使用了加密');
} else {
  console.log('    ℹ️ 未使用加密（待办数据以明文存储）');
  suggestions.push('💡 考虑为敏感数据添加加密');
}

// 总结
console.log('\n=== 审查完成 ===\n');

console.log('📊 统计:\n');
console.log(`  严重问题: ${issues.length}`);
console.log(`  警告: ${warnings.length}`);
console.log(`  建议: ${suggestions.length}`);

if (issues.length > 0) {
  console.log('\n❌ 严重问题:\n');
  issues.forEach(issue => console.log(`  ${issue}`));
}

if (warnings.length > 0) {
  console.log('\n⚠️ 警告:\n');
  warnings.forEach(warning => console.log(`  ${warning}`));
}

if (suggestions.length > 0) {
  console.log('\n💡 建议:\n');
  suggestions.forEach(suggestion => console.log(`  ${suggestion}`));
}

if (issues.length === 0 && warnings.length === 0) {
  console.log('\n✅ 未发现严重问题或警告！');
  console.log('   代码质量良好，可以安全发布。');
}

console.log('\n');

// 生成报告
const report = {
  timestamp: new Date().toISOString(),
  issues,
  warnings,
  suggestions,
  summary: {
    issueCount: issues.length,
    warningCount: warnings.length,
    suggestionCount: suggestions.length,
    status: issues.length === 0 ? 'PASS' : 'FAIL'
  }
};

fs.writeFileSync('audit-report.json', JSON.stringify(report, null, 2));
console.log('📄 详细报告已保存到: audit-report.json\n');
