const fs = require('fs');
const path = require('path');
const { computeAndroidVersionCode } = require('./sync-mobile-android.cjs');

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

function readGradleVersion(filePath) {
  const contents = fs.readFileSync(filePath, 'utf8');
  const codeMatch = contents.match(/\bversionCode\s+(\d+)/);
  const nameMatch = contents.match(/\bversionName\s+"([^"]+)"/);
  if (!codeMatch || !nameMatch) {
    throw new Error(`Could not find versionCode/versionName in ${filePath}`);
  }
  return { versionCode: Number(codeMatch[1]), versionName: nameMatch[1] };
}

const projectRoot = path.resolve(__dirname, '..');
const packageVersion = readJson(path.join(projectRoot, 'package.json')).version;
const cargoVersion = readCargoVersion(path.join(projectRoot, 'src-tauri', 'Cargo.toml'));
const mobilePkgVersion = readJson(path.join(projectRoot, 'mobile-android', 'package.json')).version;
const gradleVersion = readGradleVersion(
  path.join(projectRoot, 'mobile-android', 'android', 'app', 'build.gradle')
);
const expectedAndroidCode = computeAndroidVersionCode(packageVersion);
const releaseTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || '';
const expectedTag = `v${packageVersion}`;
const errors = [];

if (cargoVersion !== packageVersion) {
  errors.push(`package.json version ${packageVersion} does not match src-tauri/Cargo.toml version ${cargoVersion}`);
}

if (mobilePkgVersion !== packageVersion) {
  errors.push(
    `package.json version ${packageVersion} does not match mobile-android/package.json version ${mobilePkgVersion}`
  );
}

if (gradleVersion.versionName !== packageVersion) {
  errors.push(
    `package.json version ${packageVersion} does not match mobile-android/android/app/build.gradle versionName ${gradleVersion.versionName}`
  );
}

if (gradleVersion.versionCode !== expectedAndroidCode) {
  errors.push(
    `mobile-android/android/app/build.gradle versionCode ${gradleVersion.versionCode} does not match expected ${expectedAndroidCode}`
  );
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
  androidVersionCode: expectedAndroidCode,
  tag: releaseTag || expectedTag
});
