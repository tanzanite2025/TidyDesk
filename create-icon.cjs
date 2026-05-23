/**
 * 创建简单的 TidyDesk 图标
 * 使用 Canvas 创建一个蓝色方块图标
 */

const fs = require('fs');
const path = require('path');

// 创建一个简单的 ICO 文件（16x16 和 32x32）
function createSimpleIcon() {
  const buildDir = path.join(__dirname, 'build');
  
  // 确保 build 目录存在
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }
  
  // 创建一个简单的 SVG 图标
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <!-- 背景 -->
  <rect width="256" height="256" fill="#4A90E2" rx="32"/>
  
  <!-- 白色方块 -->
  <rect x="64" y="64" width="128" height="128" fill="#FFFFFF" rx="16"/>
  
  <!-- 蓝色小方块 -->
  <rect x="96" y="96" width="64" height="64" fill="#4A90E2" rx="8"/>
</svg>`;
  
  // 保存 SVG
  const svgPath = path.join(buildDir, 'icon.svg');
  fs.writeFileSync(svgPath, svg);
  console.log(`Created SVG icon: ${svgPath}`);
  
  // 创建一个简单的 README
  const readme = `# TidyDesk 图标

## 图标文件

- \`icon.svg\` - SVG 格式图标（已创建）
- \`icon.png\` - PNG 格式图标（需要转换）
- \`icon.ico\` - ICO 格式图标（需要转换）

## 转换图标

### 使用在线工具
1. 访问 https://www.icoconverter.com/
2. 上传 icon.svg
3. 选择尺寸：16x16, 32x32, 48x48, 256x256
4. 下载 icon.ico

### 使用 ImageMagick
\`\`\`bash
magick convert icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico
\`\`\`

## 临时方案

如果没有图标文件，应用会使用 Electron 默认图标。
托盘功能仍然可用，只是图标不明显。
`;
  
  const readmePath = path.join(buildDir, 'ICON_README.md');
  fs.writeFileSync(readmePath, readme);
  console.log(`Created README: ${readmePath}`);
  
  console.log('\n✅ 图标文件已创建！');
  console.log('📝 请使用在线工具或 ImageMagick 将 SVG 转换为 ICO 格式');
  console.log('🔗 在线转换: https://www.icoconverter.com/');
}

createSimpleIcon();
