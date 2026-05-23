/**
 * 修复现有贴纸的置顶设置
 * 将所有贴纸的 alwaysOnTop 设置为 false
 */

const fs = require('fs');
const path = require('path');

const userDataPath = process.env.APPDATA || process.env.HOME;
const stickerPath = path.join(userDataPath, 'TidyDesk', 'stickers');
const statePath = path.join(stickerPath, 'stickers.json');

console.log('=== 修复现有贴纸配置 ===\n');

if (!fs.existsSync(statePath)) {
  console.log('❌ 未找到贴纸配置文件:', statePath);
  console.log('   可能还没有创建过贴纸，无需修复。');
  process.exit(0);
}

try {
  // 读取现有配置
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  console.log('📊 当前贴纸数量:', state.stickers?.length || 0);
  
  if (!state.stickers || state.stickers.length === 0) {
    console.log('✅ 没有贴纸需要修复');
    process.exit(0);
  }

  // 备份原配置
  const backupPath = path.join(stickerPath, `stickers.backup.${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(state, null, 2));
  console.log('💾 已备份原配置到:', backupPath);

  // 修复所有贴纸
  let fixedCount = 0;
  for (const sticker of state.stickers) {
    if (sticker.alwaysOnTop === true) {
      sticker.alwaysOnTop = false;
      fixedCount++;
      console.log(`  ✅ 修复贴纸: ${sticker.id}`);
    }
  }

  if (fixedCount === 0) {
    console.log('✅ 所有贴纸配置正常，无需修复');
    process.exit(0);
  }

  // 保存修复后的配置
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`\n✅ 成功修复 ${fixedCount} 个贴纸`);
  console.log('   所有贴纸的 alwaysOnTop 已设置为 false');
  console.log('   重启应用后生效');
  
} catch (error) {
  console.error('❌ 修复失败:', error.message);
  process.exit(1);
}
