/**
 * 合并多个 ICO 文件为一个
 * 将 tanzanite16.ico, tanzanite32.ico, tanzanite48.ico, tanzanite256.ico
 * 合并为 icon.ico 和 tray-icon.ico
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const buildDir = path.join(__dirname, 'build');

console.log('🔄 TidyDesk 图标合并工具\n');

// 检查源文件
const sourceFiles = [
  'tanzanite16.ico',
  'tanzanite32.ico',
  'tanzanite48.ico',
  'tanzanite256.ico'
];

console.log('📁 检查源文件...');
let allExist = true;
for (const file of sourceFiles) {
  const filePath = path.join(buildDir, file);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`  ✅ ${file} (${Math.round(stats.size / 1024)} KB)`);
  } else {
    console.log(`  ❌ ${file} - 文件不存在`);
    allExist = false;
  }
}

if (!allExist) {
  console.error('\n❌ 错误: 部分源文件不存在');
  process.exit(1);
}

console.log('\n🔧 处理方案...\n');

// 方法 1: 尝试使用 ImageMagick 合并
console.log('📦 方法 1: 尝试使用 ImageMagick 合并...');
try {
  execSync('magick -version', { stdio: 'ignore' });
  console.log('✅ 检测到 ImageMagick');
  
  const iconPath = path.join(buildDir, 'icon.ico');
  const sourceIcons = sourceFiles.map(f => path.join(buildDir, f)).join(' ');
  
  console.log('🔄 合并中...');
  execSync(`magick convert ${sourceIcons} "${iconPath}"`, { stdio: 'inherit' });
  
  console.log('✅ 成功创建 icon.ico');
  
  // 复制为 tray-icon.ico
  const trayIconPath = path.join(buildDir, 'tray-icon.ico');
  fs.copyFileSync(iconPath, trayIconPath);
  console.log('✅ 成功创建 tray-icon.ico');
  
  console.log('\n🎉 图标合并完成！');
  console.log('📁 生成的文件:');
  console.log(`  - ${iconPath}`);
  console.log(`  - ${trayIconPath}`);
  
  process.exit(0);
} catch (err) {
  console.log('⚠️  未安装 ImageMagick 或合并失败');
}

// 方法 2: 手动处理
console.log('\n📦 方法 2: 手动处理\n');
console.log('由于无法自动合并，请选择以下方案之一：\n');

console.log('方案 A: 使用最大的图标（推荐）');
console.log('---------------------------------------');
console.log('使用 256x256 的图标，Windows 会自动缩放：');
console.log('');
console.log('  copy build\\tanzanite256.ico build\\icon.ico');
console.log('  copy build\\tanzanite256.ico build\\tray-icon.ico');
console.log('');

console.log('方案 B: 使用 32x32 的图标');
console.log('---------------------------------------');
console.log('使用标准尺寸，适合托盘显示：');
console.log('');
console.log('  copy build\\tanzanite32.ico build\\icon.ico');
console.log('  copy build\\tanzanite32.ico build\\tray-icon.ico');
console.log('');

console.log('方案 C: 在线合并（最佳）');
console.log('---------------------------------------');
console.log('1. 访问: https://www.icoconverter.com/');
console.log('2. 上传所有 4 个 ICO 文件');
console.log('3. 合并为一个 ICO 文件');
console.log('4. 下载并保存为 build/icon.ico');
console.log('5. 复制为 build/tray-icon.ico');
console.log('');

console.log('💡 推荐: 先使用方案 A 快速测试，后续可以使用方案 C 优化');
console.log('');
