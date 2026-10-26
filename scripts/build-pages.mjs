import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PUBLIC_FILES = Object.freeze([
  'index.html', 'styles.css', 'blitz-app.js', 'blitz-state.js', 'practice-api.js',
  'audio.js', 'input-worklet.js', 'pond-stage.js', 'studio-state.js', 'tutor-avatar.js',
  'assets/alex-photo-atlas.png', 'assets/alex-provenance.json', 'assets/synthetic-math-card.svg',
]);
const VENDOR_FILES = ['three.module.js', 'three.core.js'];
const NODE_CRYPTO_IMPORT = "import { randomUUID } from 'node:crypto';";

async function fileOnly(source) {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Build input must be an ordinary file: ${path.basename(source)}`);
}
async function safeOutput(outputRoot) {
  const parent = path.resolve(outputRoot);
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) throw new Error('Pages output parent must be an existing, non-symlink directory.');
  const output = path.join(parent, 'dist-pages');
  const existing = await lstat(output).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Refusing to replace a non-directory or symlink dist-pages target.');
  return output;
}

/** Output is always a dedicated dist-pages child; tests can supply a temporary parent. */
export async function buildPages({ outputRoot = ROOT } = {}) {
  const output = await safeOutput(outputRoot);
  const inputs = [
    ...PUBLIC_FILES.map(name => [path.join(ROOT, 'public', name), name]),
    ...VENDOR_FILES.map(name => [path.join(ROOT, 'node_modules/three/build', name), `vendor/three/build/${name}`]),
    [path.join(ROOT, 'node_modules/three/LICENSE'), 'vendor/three/LICENSE'],
    [path.join(ROOT, 'demo/blitz-learning-60s.mp4'), 'demo/blitz-learning-60s.mp4'],
  ];
  // Validate the complete allowlist before replacing a previous generated build.
  await Promise.all(inputs.map(([source]) => fileOnly(source)));
  await fileOnly(path.join(ROOT, 'quests.mjs'));
  const engine = await readFile(path.join(ROOT, 'quests.mjs'), 'utf8');
  if (engine.split(NODE_CRYPTO_IMPORT).length !== 2) throw new Error('The quest engine crypto import changed; review the browser build transform.');
  const browserEngine = engine.replace(NODE_CRYPTO_IMPORT, 'const randomUUID = () => globalThis.crypto.randomUUID();');
  if (/\bfrom\s*['"]node:|\bimport\s*\(\s*['"]node:/.test(browserEngine)) throw new Error('The browser quest engine contains an unsupported Node import.');
  const index = await readFile(path.join(ROOT, 'public/index.html'), 'utf8');
  if (!/<head\s*>/.test(index) || index.includes('name="blitz-deployment"')) throw new Error('Review the static deployment meta transform.');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const [source, destination] of inputs) {
    const target = path.join(output, destination);
    await mkdir(path.dirname(target), { recursive: true });
    if (destination === 'index.html') await writeFile(target, index.replace(/<head\s*>/, '<head>\n  <meta name="blitz-deployment" content="static-practice">'));
    else await copyFile(source, target);
  }
  await writeFile(path.join(output, 'quest-engine.js'), browserEngine);
  await writeFile(path.join(output, '.nojekyll'), '');
  return { outputDir: output, fileCount: inputs.length + 2 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Run build-pages.mjs without path arguments. It writes only dist-pages.');
  const result = await buildPages();
  console.log(`Built ${result.fileCount} public files in dist-pages.`);
}
