import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const packageJsonPath = resolve(projectDir, 'package.json');
const versionPath = resolve(projectDir, 'src', 'environments', 'version.ts');
const manifestPath = resolve(projectDir, 'public', 'manifest.webmanifest');
const indexPath = resolve(projectDir, 'src', 'index.html');

const APP_NAME = 'WTF POS';
const APP_NAME_STAGING = 'WTF POS Staging';
const APP_SHORT_NAME = 'WTF POS';
const APP_SHORT_NAME_STAGING = 'WTF POS Stg';
const APP_DESCRIPTION = 'Point of sale for WTF.';
const APP_DESCRIPTION_STAGING = 'Point of sale for WTF (staging).';

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

function isStagingMode(mode) {
  return mode === 'dev' || mode === 'staging';
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
  if (isStagingMode(mode)) {
    return `+stg.${getShortSha()}`;
  }

  return '';
}

async function updateManifest(mode) {
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const staging = isStagingMode(mode);

  manifest.name = staging ? APP_NAME_STAGING : APP_NAME;
  manifest.short_name = staging ? APP_SHORT_NAME_STAGING : APP_SHORT_NAME;
  manifest.description = staging ? APP_DESCRIPTION_STAGING : APP_DESCRIPTION;

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function updateIndexHtml(mode) {
  const raw = await readFile(indexPath, 'utf8');
  const staging = isStagingMode(mode);
  const title = staging ? APP_NAME_STAGING : APP_NAME;

  let updated = raw.replace(/<title>.*<\/title>/, `<title>${title}</title>`);
  updated = updated.replace(
    /<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/?>/,
    `<meta name="apple-mobile-web-app-title" content="${title}" />`,
  );

  await writeFile(indexPath, updated, 'utf8');
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
  await updateManifest(mode);
  await updateIndexHtml(mode);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
