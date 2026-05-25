const hasValue = name => {
  const value = process.env[name];
  return Boolean(value && String(value).trim());
};

const missing = [];

if (!hasValue('TAURI_SIGNING_PRIVATE_KEY') && !hasValue('TAURI_SIGNING_PRIVATE_KEY_PATH')) {
  missing.push({
    name: 'TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH',
    message: 'Tauri build 需要私钥来生成 updater 签名产物，可以提供私钥内容或私钥文件路径。'
  });
}

if (!hasValue('TIDYDESK_UPDATER_PUBLIC_KEY')) {
  missing.push({
    name: 'TIDYDESK_UPDATER_PUBLIC_KEY',
    message: 'TidyDesk 会在构建时嵌入 updater 公钥，安装后的客户端才可以验证更新。'
  });
}

if (missing.length === 0) {
  console.log('[TAURI-UPDATER] release environment looks good');
  process.exit(0);
}

console.error('[TAURI-UPDATER] missing required release environment variables:');
for (const item of missing) {
  console.error(`- ${item.name}: ${item.message}`);
}
process.exit(1);
