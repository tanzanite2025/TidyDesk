/**
 * 图标转换脚本
 * 将 SVG 转换为 PNG 和 ICO 格式
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const buildDir = path.join(__dirname, 'build');
const svgPath = path.join(buildDir, 'icon.svg');

console.log('🎨 TidyDesk 图标转换工具\n');

// 检查 SVG 文件是否存在
if (!fs.existsSync(svgPath)) {
  console.error('❌ 错误: 找不到 icon.svg 文件');
  console.log('📝 请确保 build/icon.svg 文件存在');
  process.exit(1);
}

console.log('✅ 找到 SVG 文件:', svgPath);

// 方法 1: 尝试使用 ImageMagick
console.log('\n📦 方法 1: 尝试使用 ImageMagick...');
try {
  // 检查是否安装了 ImageMagick
  execSync('magick -version', { stdio: 'ignore' });
  console.log('✅ 检测到 ImageMagick');
  
  // 转换为 ICO
  const icoPath = path.join(buildDir, 'icon.ico');
  console.log('🔄 转换中...');
  execSync(`magick convert "${svgPath}" -define icon:auto-resize=256,128,64,48,32,16 "${icoPath}"`, {
    stdio: 'inherit'
  });
  
  console.log('✅ 成功创建 icon.ico');
  console.log('📁 位置:', icoPath);
  
  // 复制为 tray-icon.ico
  const trayIconPath = path.join(buildDir, 'tray-icon.ico');
  fs.copyFileSync(icoPath, trayIconPath);
  console.log('✅ 成功创建 tray-icon.ico');
  
  console.log('\n🎉 图标转换完成！');
  process.exit(0);
} catch (err) {
  console.log('⚠️  未安装 ImageMagick 或转换失败');
}

// 方法 2: 在线转换指南
console.log('\n📦 方法 2: 在线转换（推荐）');
console.log('');
console.log('请按照以下步骤操作：');
console.log('');
console.log('1️⃣  访问在线转换工具:');
console.log('   🔗 https://www.icoconverter.com/');
console.log('   🔗 https://convertio.co/zh/svg-ico/');
console.log('   🔗 https://cloudconvert.com/svg-to-ico');
console.log('');
console.log('2️⃣  上传文件:');
console.log('   📁 ' + svgPath);
console.log('');
console.log('3️⃣  选择尺寸:');
console.log('   ✅ 16x16 (必需 - 托盘图标)');
console.log('   ✅ 32x32 (必需 - 托盘图标)');
console.log('   ✅ 48x48 (推荐 - 任务栏)');
console.log('   ✅ 256x256 (推荐 - 高清显示)');
console.log('');
console.log('4️⃣  下载并保存:');
console.log('   💾 保存为: build/icon.ico');
console.log('   💾 复制为: build/tray-icon.ico');
console.log('');

// 方法 3: 安装 ImageMagick
console.log('📦 方法 3: 安装 ImageMagick');
console.log('');
console.log('Windows 用户:');
console.log('1️⃣  访问: https://imagemagick.org/script/download.php');
console.log('2️⃣  下载: ImageMagick-7.x.x-Q16-HDRI-x64-dll.exe');
console.log('3️⃣  安装时勾选 "Add to PATH"');
console.log('4️⃣  重新运行此脚本: node convert-icon.cjs');
console.log('');
console.log('或使用 Chocolatey:');
console.log('   choco install imagemagick');
console.log('');

console.log('💡 提示: 推荐使用在线转换（方法 2），最简单快捷！');
console.log('');
