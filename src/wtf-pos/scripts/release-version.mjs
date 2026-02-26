import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const VALID_BUMPS = new Set(['major', 'minor', 'patch']);
const GIT_BIN = (() => {
  if (process.platform !== 'win32') {
    return 'git';
  }

  const candidates = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return 'git.exe';
})();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();
    const details = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${details ? `\n${details}` : ''}`);
  }

  return (result.stdout || '').trim();
}

function bumpVersion(version, bumpType) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (bumpType === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpType === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

function buildCommitMessage(oldVersion, newVersion) {
  return (
    `Bump version to ${newVersion}\n\n` +
    'Prepare the next patch release by updating the POS package version\n' +
    `from ${oldVersion} to ${newVersion}.\n`
  );
}

function findRepoRoot(startDir) {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error('Could not locate git repository root.');
    }

    current = parent;
  }
}

async function main() {
  const bumpType = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!VALID_BUMPS.has(bumpType)) {
    throw new Error('Usage: node scripts/release-version.mjs <major|minor|patch> [--dry-run]');
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const projectDir = resolve(scriptDir, '..');
  const packageJsonPath = resolve(projectDir, 'package.json');
  const packageLockPath = resolve(projectDir, 'package-lock.json');
  const packageJsonRaw = await readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonRaw);
  const oldVersion = String(packageJson.version || '').trim();

  if (!oldVersion) {
    throw new Error('package.json version is missing.');
  }

  const newVersion = bumpVersion(oldVersion, bumpType);
  const tagName = `v${newVersion}`;
  const repoRoot = findRepoRoot(projectDir);
  const relativePackageJson = 'src/wtf-pos/package.json';
  const relativePackageLock = 'src/wtf-pos/package-lock.json';

  if (dryRun) {
    console.log(`Current version: ${oldVersion}`);
    console.log(`Next version: ${newVersion}`);
    console.log(`Tag: ${tagName}`);
    return;
  }

  if (run(GIT_BIN, ['tag', '--list', tagName], { cwd: repoRoot }) === tagName) {
    throw new Error(`Tag ${tagName} already exists.`);
  }

  packageJson.version = newVersion;
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');

  try {
    const packageLockRaw = await readFile(packageLockPath, 'utf8');
    const packageLock = JSON.parse(packageLockRaw);
    if (packageLock.version) {
      packageLock.version = newVersion;
      await writeFile(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n', 'utf8');
    }
  } catch {
    // package-lock update is optional for this tool.
  }

  run(GIT_BIN, ['add', relativePackageJson, relativePackageLock], { cwd: repoRoot });

  const tempDir = await mkdtemp(join(tmpdir(), 'wtf-release-'));
  const commitMsgPath = join(tempDir, 'commit-msg.txt');

  try {
    await writeFile(commitMsgPath, buildCommitMessage(oldVersion, newVersion), 'utf8');
    run(
      GIT_BIN,
      ['commit', '--only', relativePackageJson, relativePackageLock, '-F', commitMsgPath],
      {
        cwd: repoRoot,
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  run(GIT_BIN, ['tag', tagName], { cwd: repoRoot });
  console.log(`Bumped ${oldVersion} -> ${newVersion}, committed, and tagged ${tagName}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
