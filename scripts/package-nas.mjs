import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from './build-pages.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = ['compose.yaml', 'Caddyfile', 'proxy-site.Caddyfile', 'Dockerfile', '.dockerignore'];

export function validateNasOptions({ bindIp, port, release } = {}) {
  if (typeof bindIp !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bindIp)) throw new Error('BLITZ_NAS_BIND_IP must be an explicit private LAN IPv4 address.');
  const octets = bindIp.split('.').map(Number);
  if (octets.some((value, index) => value > 255 || String(value) !== bindIp.split('.')[index])
      || !(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168))
      || octets[3] === 0 || octets[3] === 255) throw new Error('BLITZ_NAS_BIND_IP must be a private unicast LAN host address.');
  if (!/^[1-9]\d{3,4}$/.test(String(port ?? '')) || String(Number(port)) !== String(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('BLITZ_NAS_PORT must be an explicit unused port from 1024 to 65535.');
  if (typeof release !== 'string' || release.trim() !== release || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(release)) throw new Error('BLITZ_RELEASE must be a lowercase release label containing only letters, digits and hyphens.');
  return { bindIp, port: Number(port), release };
}

async function ordinaryDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('Release output parent must be an ordinary existing directory, not a symlink.');
}

async function readableTree(target) {
  const info = await lstat(target);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('A NAS release may contain only ordinary files and directories.');
  await chmod(target, info.isDirectory() ? 0o755 : 0o644);
  if (info.isDirectory()) for (const name of await readdir(target)) await readableTree(path.join(target, name));
}

async function siteInventory(root, prefix = '') {
  const files = [];
  for (const name of (await readdir(path.join(root, prefix))).sort()) {
    const relative = path.posix.join(prefix, name), target = path.join(root, relative);
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error('A NAS site inventory cannot follow symlinks.');
    if (info.isDirectory()) files.push(...await siteInventory(root, relative));
    else if (info.isFile()) {
      const bytes = await readFile(target);
      files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    } else throw new Error('A NAS site inventory may contain only ordinary files.');
  }
  return files;
}

async function archiveRelease(staging, name, archive) {
  // stdout + exclusive creation prevents overwriting an earlier release or symlink.
  const child = spawn('tar', ['-czf', '-', '-C', staging, name], {
    env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostic = '';
  child.stderr.on('data', chunk => { if (diagnostic.length < 16_384) diagnostic += chunk.toString(); });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`tar failed (${code}): ${diagnostic.trim()}`)));
  });
  try {
    await Promise.all([pipeline(child.stdout, createWriteStream(archive, { flags: 'wx', mode: 0o644 })), completion]);
  } catch (error) { child.kill(); throw error; }
}

/** Builds an architecture-neutral, credential-free static release. No NAS writes. */
export async function packageNas(options = {}) {
  const { bindIp, port, release } = validateNasOptions(options);
  const outputRoot = path.resolve(options.outputRoot ?? path.join(ROOT, '.runtime'));
  if (!options.outputRoot) await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await ordinaryDirectory(outputRoot);
  const name = `blitz-${release}`;
  const archive = path.join(outputRoot, `${name}.tar.gz`);
  if (await lstat(archive).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw new Error('That release archive already exists. Choose a new BLITZ_RELEASE; no file was replaced.');
  const staging = await mkdtemp(path.join(outputRoot, 'blitz-nas-'));
  const releaseRoot = path.join(staging, name);
  await mkdir(releaseRoot, { mode: 0o755 });
  const { outputDir, fileCount } = await buildPages({ outputRoot: releaseRoot });
  await rename(outputDir, path.join(releaseRoot, 'site'));
  for (const filename of TEMPLATES) {
    const template = path.join(ROOT, 'deploy/nas', filename);
    const info = await lstat(template);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('NAS templates must be ordinary source files.');
    const content = (await readFile(template, 'utf8')).replaceAll('@@BIND_IP@@', bindIp).replaceAll('@@PORT@@', String(port)).replaceAll('@@RELEASE@@', release);
    if (/@@[A-Z_]+@@/.test(content)) throw new Error('Unresolved NAS deployment template value.');
    const target = path.join(releaseRoot, filename);
    await writeFile(target, content, { mode: 0o644 });
    await chmod(target, 0o644);
  }
  const files = await siteInventory(path.join(releaseRoot, 'site'));
  if (files.length !== fileCount) throw new Error('NAS site inventory count does not match its allowlisted build.');
  await writeFile(path.join(releaseRoot, 'release.json'), `${JSON.stringify({ name, audience: 'public-static-practice', hostname: 'blitz.bespoke3d.ai', bindIp, port, fileCount, image: `blitz-practice:${release}`, baseImage: 'caddy:2.11.4-alpine', geminiEnabled: false, files }, null, 2)}\n`, { mode: 0o644 });
  await readableTree(releaseRoot);
  await archiveRelease(staging, name, archive);
  return { archive, releaseRoot, name, fileCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Use explicit BLITZ_NAS_BIND_IP, BLITZ_NAS_PORT and BLITZ_RELEASE environment values, without arguments.');
  const result = await packageNas({ bindIp: process.env.BLITZ_NAS_BIND_IP, port: process.env.BLITZ_NAS_PORT, release: process.env.BLITZ_RELEASE });
  console.log(JSON.stringify(result, null, 2));
}
