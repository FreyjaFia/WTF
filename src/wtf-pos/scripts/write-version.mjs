import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const packageJsonPath = resolve(projectDir, 'package.json');
const versionPath = resolve(projectDir, 'src', 'environments', 'version.ts');

function readArg(name) {
  const arg = process.argv.find((value) => value.startsWith(`${name}=`));
  if (!arg) {
    return null;
  }
  return arg.split('=')[1] ?? null;
}

function getMode() {
  return readArg('--mode') ?? 'prod';
}

function getShortSha() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    return 'unknown';
  }

  return (result.stdout || '').trim() || 'unknown';
}

function buildSuffix(mode) {
  if (mode === 'dev' || mode === 'staging') {
    return `+stg.${getShortSha()}`;
  }

  return '';
}

async function main() {
  const mode = getMode();
  const packageJsonRaw = await readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonRaw);
  const baseVersion = String(packageJson.version || '').trim();

  if (!baseVersion) {
    throw new Error('package.json version is missing.');
  }

  const suffix = buildSuffix(mode);
  const version = `${baseVersion}${suffix}`;
  const contents = `export const appVersion = '${version}';\n`;
  await writeFile(versionPath, contents, 'utf8');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
