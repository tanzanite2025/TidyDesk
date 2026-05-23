/**
 * UI 问题诊断脚本
 * 检查图标、窗口、渲染等问题
 */

const fs = require('fs');
const path = require('path');

console.log('=== TidyDesk UI 问题诊断 ===\n');

// 1. 检查图标文件
console.log('1. 检查图标文件...');
const iconPaths = [
  'public/icon.png',
  'public/icon.ico',
  'build/icon.png',
  'build/icon.ico',
  'resources/icon.png',
  'resources/icon.ico'
];

let iconFound = false;
for (const iconPath of iconPaths) {
  if (fs.existsSync(iconPath)) {
    const stats = fs.statSync(iconPath);
    console.log(`  ✅ ${iconPath} (${stats.size} bytes)`);
    iconFound = true;
  }
}

if (!iconFound) {
  console.log('  ⚠️ 未找到图标文件');
}

// 2. 检查 dist 目录
console.log('\n2. 检查 dist 目录...');
if (fs.existsSync('dist')) {
  console.log('  ✅ dist/ 目录存在');
  
  const distFiles = ['index.html', 'assets'];
  for (const file of distFiles) {
    const filePath = path.join('dist', file);
    if (fs.existsSync(filePath)) {
      console.log(`  ✅ dist/${file}`);
    } else {
      console.log(`  ❌ dist/${file} 缺失`);
    }
  }
} else {
  console.log('  ❌ dist/ 目录不存在');
  console.log('     请运行: npm run build');
}

// 3. 检查 Rail 组件
console.log('\n3. 检查 Rail 组件...');
const railPath = 'src/modules/rail/RailApp.tsx';
if (fs.existsSync(railPath)) {
  console.log(`  ✅ ${railPath}`);
  const railContent = fs.readFileSync(railPath, 'utf8');
  
  const railChecks = [
    'PackageOpen',
    'ListTodo',
    'PencilLine',
    'Scissors',
    'windowControl'
  ];
  
  for (const check of railChecks) {
    if (railContent.includes(check)) {
      console.log(`    ✅ ${check}`);
    } else {
      console.log(`    ❌ ${check} 缺失`);
    }
  }
} else {
  console.log(`  ❌ ${railPath} 不存在`);
}

// 4. 检查窗口服务
console.log('\n4. 检查窗口服务...');
const windowsPath = 'electron/services/windows.cjs';
if (fs.existsSync(windowsPath)) {
  console.log(`  ✅ ${windowsPath}`);
  const windowsContent = fs.readFileSync(windowsPath, 'utf8');
  
  const windowChecks = [
    'createHandleWindow',
    'createDrawerWindow',
    'createWindows',
    'loadRenderer'
  ];
  
  for (const check of windowChecks) {
    if (windowsContent.includes(check)) {
      console.log(`    ✅ ${check}`);
    } else {
      console.log(`    ❌ ${check} 缺失`);
    }
  }
} else {
  console.log(`  ❌ ${windowsPath} 不存在`);
}

// 5. 检查 App.tsx 路由
console.log('\n5. 检查 App.tsx 路由...');
const appPath = 'src/App.tsx';
if (fs.existsSync(appPath)) {
  console.log(`  ✅ ${appPath}`);
  const appContent = fs.readFileSync(appPath, 'utf8');
  
  const modes = ['rail', 'drawer', 'todos', 'capture', 'snip', 'sticker', 'app-picker'];
  
  for (const mode of modes) {
    if (appContent.includes(`'${mode}'`) || appContent.includes(`"${mode}"`)) {
      console.log(`    ✅ mode: ${mode}`);
    } else {
      console.log(`    ❌ mode: ${mode} 缺失`);
    }
  }
} else {
  console.log(`  ❌ ${appPath} 不存在`);
}

// 6. 检查 package.json 配置
console.log('\n6. 检查 package.json...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log(`  版本: ${packageJson.version}`);
console.log(`  主进程: ${packageJson.main}`);

if (packageJson.build && packageJson.build.win) {
  console.log(`  ✅ Windows 构建配置存在`);
  if (packageJson.build.win.icon) {
    console.log(`    图标: ${packageJson.build.win.icon}`);
    if (fs.existsSync(packageJson.build.win.icon)) {
      console.log(`    ✅ 图标文件存在`);
    } else {
      console.log(`    ❌ 图标文件不存在`);
    }
  }
} else {
  console.log(`  ⚠️ Windows 构建配置缺失`);
}

// 7. 检查 electron-builder 配置
console.log('\n7. 检查 electron-builder 配置...');
if (packageJson.build) {
  console.log('  ✅ build 配置存在');
  
  const buildChecks = ['appId', 'productName', 'files', 'directories'];
  for (const check of buildChecks) {
    if (packageJson.build[check]) {
      console.log(`    ✅ ${check}`);
    } else {
      console.log(`    ⚠️ ${check} 未配置`);
    }
  }
} else {
  console.log('  ❌ build 配置不存在');
}

// 8. 检查 node_modules
console.log('\n8. 检查依赖...');
if (fs.existsSync('node_modules')) {
  console.log('  ✅ node_modules/ 存在');
  
  const criticalDeps = ['electron', 'react', 'react-dom', 'lucide-react', 'vite'];
  for (const dep of criticalDeps) {
    const depPath = path.join('node_modules', dep);
    if (fs.existsSync(depPath)) {
      console.log(`    ✅ ${dep}`);
    } else {
      console.log(`    ❌ ${dep} 未安装`);
    }
  }
} else {
  console.log('  ❌ node_modules/ 不存在');
  console.log('     请运行: npm install');
}

console.log('\n=== 诊断完成 ===\n');

// 总结
console.log('📋 常见问题排查:');
console.log('');
console.log('问题 1: 图标空白');
console.log('  - 检查图标文件是否存在');
console.log('  - 检查 package.json 中的 icon 配置');
console.log('  - 重新构建: npm run build:electron');
console.log('');
console.log('问题 2: 侧边栏手柄消失');
console.log('  - 检查 Rail 组件是否正确加载');
console.log('  - 检查窗口是否被创建: createHandleWindow()');
console.log('  - 检查窗口位置和大小');
console.log('  - 开发模式运行: npm run dev');
console.log('  - 打开开发者工具查看错误');
console.log('');
console.log('问题 3: 窗口渲染问题');
console.log('  - 检查 dist/ 目录是否存在');
console.log('  - 重新构建前端: npm run build');
console.log('  - 检查 App.tsx 路由配置');
console.log('  - 检查控制台错误信息');
console.log('');
console.log('💡 建议操作:');
console.log('  1. npm run dev  # 开发模式运行，查看控制台');
console.log('  2. 按 F12 打开开发者工具');
console.log('  3. 查看 Console 和 Network 标签');
console.log('  4. 检查是否有 404 或其他错误');
console.log('');
