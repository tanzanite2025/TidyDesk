const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readCargoVersion(filePath) {
  const contents = fs.readFileSync(filePath, 'utf8');
  const match = contents.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not find package version in ${filePath}`);
  }
  return match[1];
}

const projectRoot = path.resolve(__dirname, '..');
const packageVersion = readJson(path.join(projectRoot, 'package.json')).version;
const cargoVersion = readCargoVersion(path.join(projectRoot, 'src-tauri', 'Cargo.toml'));
const releaseTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || '';
const expectedTag = `v${packageVersion}`;
const errors = [];

if (cargoVersion !== packageVersion) {
  errors.push(`package.json version ${packageVersion} does not match src-tauri/Cargo.toml version ${cargoVersion}`);
}

if (releaseTag && releaseTag !== expectedTag) {
  errors.push(`release tag ${releaseTag} does not match expected tag ${expectedTag}`);
}

if (errors.length > 0) {
  console.error('[TAURI-UPDATER] release version check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('[TAURI-UPDATER] release version check passed', {
  version: packageVersion,
  tag: releaseTag || expectedTag
});
