const fs = require('fs');
const path = require('path');
const { loadReleaseEnvFromWindowsUserEnv } = require('./tauri-release-env.cjs');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeGitHubRepository(owner, repo) {
  if (!owner || !repo) return null;
  return {
    owner: owner.trim(),
    repo: repo.trim()
  };
}

function parseGitHubRepositoryFromUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(
    /github\.com[/:](?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/i
  );
  if (!match?.groups) return null;
  return normalizeGitHubRepository(match.groups.owner, match.groups.repo);
}

function getTargetKey() {
  const triple = process.env.TAURI_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || '';
  if (triple.includes('aarch64') && triple.includes('windows')) return 'windows-aarch64';
  if (triple.includes('i686') && triple.includes('windows')) return 'windows-i686';
  if (process.platform === 'win32' && process.arch === 'arm64') return 'windows-aarch64';
  if (process.platform === 'win32' && process.arch === 'ia32') return 'windows-i686';
  return 'windows-x86_64';
}

function findFirstMatchingFile(directory, matcher) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && matcher(entry.name)) {
      return path.join(directory, entry.name);
    }
  }
  return null;
}

function normalizeBaseUrl(pkg) {
  if (process.env.TIDYDESK_UPDATER_BASE_URL) {
    return process.env.TIDYDESK_UPDATER_BASE_URL.replace(/\/$/, '');
  }

  const publishRepository = normalizeGitHubRepository(
    pkg.build?.publish?.owner,
    pkg.build?.publish?.repo
  );
  if (publishRepository) {
    return `https://github.com/${publishRepository.owner}/${publishRepository.repo}/releases/download/v${pkg.version}`;
  }

  const envRepository = parseGitHubRepositoryFromUrl(
    process.env.GITHUB_REPOSITORY
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
      : ''
  );
  if (envRepository) {
    return `https://github.com/${envRepository.owner}/${envRepository.repo}/releases/download/v${pkg.version}`;
  }

  const repositoryValue = typeof pkg.repository === 'string'
    ? pkg.repository
    : pkg.repository?.url;
  const packageRepository = parseGitHubRepositoryFromUrl(repositoryValue);
  if (packageRepository) {
    return `https://github.com/${packageRepository.owner}/${packageRepository.repo}/releases/download/v${pkg.version}`;
  }

  throw new Error(
    'Missing updater base URL. Set TIDYDESK_UPDATER_BASE_URL or provide a GitHub repository via package.json build.publish or repository.url.'
  );
}

function main() {
  loadReleaseEnvFromWindowsUserEnv();
  const projectRoot = path.resolve(__dirname, '..');
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const pkg = readJson(packageJsonPath);
  const bundleDir = path.join(projectRoot, 'src-tauri', 'target', 'release', 'bundle', 'nsis');

  if (!fs.existsSync(bundleDir)) {
    throw new Error(`NSIS bundle directory not found: ${bundleDir}`);
  }

  const installerPath = findFirstMatchingFile(
    bundleDir,
    fileName => fileName.endsWith('.exe') && !fileName.endsWith('.exe.sig')
  );

  if (!installerPath) {
    throw new Error(`No NSIS installer found in ${bundleDir}`);
  }

  const signaturePath = `${installerPath}.sig`;
  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Updater signature not found: ${signaturePath}`);
  }

  const installerName = path.basename(installerPath);
  const signature = fs.readFileSync(signaturePath, 'utf8').trim();
  const baseUrl = normalizeBaseUrl(pkg);
  const targetKey = getTargetKey();
  const notes = process.env.TIDYDESK_UPDATER_NOTES || '';
  const manifest = {
    version: pkg.version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      [targetKey]: {
        signature,
        url: `${baseUrl}/${encodeURIComponent(installerName)}`
      }
    }
  };

  const outputDir = process.env.TIDYDESK_UPDATER_MANIFEST_DIR
    ? path.resolve(projectRoot, process.env.TIDYDESK_UPDATER_MANIFEST_DIR)
    : path.join(projectRoot, 'release-tauri');
  const outputPath = path.join(outputDir, 'latest.json');

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('[TAURI-UPDATER] generated manifest:', {
    outputPath,
    installerName,
    targetKey,
    baseUrl
  });
}

main();
