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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listInstallerFiles(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`NSIS bundle directory does not exist: ${directory}`);
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.exe') && !entry.name.endsWith('.exe.sig'))
    .map(entry => entry.name)
    .sort();
}

function selectInstallerArtifact(bundleDir, version, productName = 'TidyDesk') {
  const normalizedVersion = String(version || '').trim();
  if (!normalizedVersion) {
    throw new Error('Package version is required to locate the NSIS installer.');
  }

  const installers = listInstallerFiles(bundleDir);
  if (installers.length === 0) {
    throw new Error(`No NSIS installer found in ${bundleDir}`);
  }

  const versionPattern = new RegExp(`(?:^|[_-])${escapeRegExp(normalizedVersion)}(?:[_.-]|\\.exe$)`, 'i');
  const versionMatches = installers.filter(fileName => versionPattern.test(fileName));

  if (versionMatches.length === 0) {
    throw new Error(
      `No NSIS installer matching version ${normalizedVersion} found in ${bundleDir}. Found: ${installers.join(', ')}`
    );
  }

  let selectedName;
  if (versionMatches.length === 1) {
    selectedName = versionMatches[0];
  } else {
    const expectedPrefix = `${productName}_${normalizedVersion}_`.toLowerCase();
    const preferredMatches = versionMatches.filter(name => name.toLowerCase().startsWith(expectedPrefix));
    if (preferredMatches.length === 1) {
      selectedName = preferredMatches[0];
    } else {
      throw new Error(
        `Multiple NSIS installers match version ${normalizedVersion} in ${bundleDir}: ${versionMatches.join(', ')}`
      );
    }
  }

  const installerPath = path.join(bundleDir, selectedName);
  const signaturePath = `${installerPath}.sig`;
  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Updater signature not found: ${signaturePath}`);
  }

  const signature = fs.readFileSync(signaturePath, 'utf8').trim();
  if (!signature) {
    throw new Error(`Updater signature file is empty: ${signaturePath}`);
  }

  return {
    installerName: selectedName,
    installerPath,
    signaturePath,
    signature
  };
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

function resolveBundleDir(projectRoot) {
  const candidates = [];
  const triple = (process.env.CARGO_BUILD_TARGET || process.env.TAURI_TARGET_TRIPLE || '').trim();
  if (triple) {
    candidates.push(path.join(projectRoot, 'src-tauri', 'target', triple, 'release', 'bundle', 'nsis'));
  }
  candidates.push(path.join(projectRoot, 'src-tauri', 'target', 'release', 'bundle', 'nsis'));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`NSIS bundle directory not found. Checked: ${candidates.join(', ')}`);
}

function buildUpdaterManifest({ version, installerName, signature, targetKey, baseUrl, notes = '', pubDate = new Date().toISOString() }) {
  if (!version || !String(version).trim()) {
    throw new Error('Updater manifest requires a valid version.');
  }
  if (!signature || !String(signature).trim()) {
    throw new Error('Updater manifest requires a non-empty signature.');
  }
  if (!targetKey || !String(targetKey).trim()) {
    throw new Error('Updater manifest requires a valid targetKey.');
  }

  const artifactUrl = `${String(baseUrl).replace(/\/$/, '')}/${encodeURIComponent(installerName)}`;
  new URL(artifactUrl);

  return {
    version: String(version).trim(),
    notes: String(notes ?? ''),
    pub_date: pubDate,
    platforms: {
      [targetKey]: {
        signature: String(signature).trim(),
        url: artifactUrl
      }
    }
  };
}

function main() {
  loadReleaseEnvFromWindowsUserEnv();
  const projectRoot = path.resolve(__dirname, '..');
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const pkg = readJson(packageJsonPath);
  const tauriConfPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
  const tauriConf = fs.existsSync(tauriConfPath) ? readJson(tauriConfPath) : null;
  const productName = tauriConf?.productName || 'TidyDesk';

  const bundleDir = resolveBundleDir(projectRoot);
  const { installerName, signature } = selectInstallerArtifact(bundleDir, pkg.version, productName);

  const baseUrl = normalizeBaseUrl(pkg);
  const targetKey = getTargetKey();
  const notes = (process.env.TIDYDESK_UPDATER_NOTES || '').trim();
  const manifest = buildUpdaterManifest({
    version: pkg.version,
    installerName,
    signature,
    targetKey,
    baseUrl,
    notes
  });

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

if (require.main === module) {
  main();
}

module.exports = {
  buildUpdaterManifest,
  getTargetKey,
  normalizeBaseUrl,
  resolveBundleDir,
  selectInstallerArtifact
};
