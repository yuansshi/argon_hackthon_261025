import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { packageNas, validateNasOptions } from '../scripts/package-nas.mjs';
import { PUBLIC_FILES } from '../scripts/build-pages.mjs';

const exec = promisify(execFile);
const valid = { bindIp: '192.168.50.20', port: '18080', release: 'test-2026-10-25' };
const read = file => readFile(new URL(`../deploy/nas/${file}`, import.meta.url), 'utf8');
async function temporary(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'blitz-nas-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('NAS package requires a private host, unprivileged port and safe explicit release label', () => {
  assert.deepEqual(validateNasOptions(valid), { ...valid, port: 18080 });
  for (const bindIp of [undefined, '', '0.0.0.0', '127.0.0.1', '8.8.8.8', '169.254.1.2', '192.168.50.0', '192.168.50.255', '192.168.050.20', '10.0.0.256', '172.32.0.2', '::', '192.168.1.2\nports:']) assert.throws(() => validateNasOptions({ ...valid, bindIp }));
  for (const port of [undefined, '', '80', '1023', '65536', '18080:80', '018080', '18080\n']) assert.throws(() => validateNasOptions({ ...valid, port }));
  for (const release of [undefined, '', '../unsafe', '-bad', 'UPPER', 'has space', 'valid\n', 'a'.repeat(65)]) assert.throws(() => validateNasOptions({ ...valid, release }));
  for (const bindIp of ['10.0.0.8', '172.16.5.2', '172.31.0.6']) assert.equal(validateNasOptions({ ...valid, bindIp }).bindIp, bindIp);
});

test('NAS runtime is isolated static Caddy with no backend, keys, broad bind or host mounts', async () => {
  const compose = await read('compose.yaml'), caddy = await read('Caddyfile'), proxy = await read('proxy-site.Caddyfile');
  assert.match(compose, /image: caddy:2\.11\.4-alpine/);
  assert.match(compose, /user: "1000:1000"/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /"@@BIND_IP@@:@@PORT@@:8080"/);
  assert.match(compose, /.\/site:\/srv:ro/);
  for (const control of ['mem_limit:', 'cpus:', 'pids_limit:', 'max-size:', 'max-file:', 'tmpfs:']) assert.ok(compose.includes(control));
  assert.match(compose, /test: \["CMD", "wget", "-q", "-O", "\/dev\/null", "http:\/\/127\.0\.0\.1:8080\/"\]/);
  assert.match(compose, /interval: 30s\s+timeout: 3s\s+retries: 3\s+start_period: 5s/);
  assert.doesNotMatch(compose, /privileged:|network_mode:|build:|env_file:|docker\.sock|0\.0\.0\.0|GEMINI|access_info|node_modules|server\.mjs/);
  for (const directive of ['auto_https off', 'admin off', 'persist_config off', 'root * /srv', 'file_server', 'respond @api 404']) assert.ok(caddy.includes(directive));
  assert.match(caddy, /camera=\(\), microphone=\(\)/);
  assert.match(caddy, /connect-src 'none'/);
  assert.doesNotMatch(caddy, /try_files|reverse_proxy|includeSubDomains|preload/);
  assert.match(proxy, /^blitz\.bespoke3d\.ai \{/m);
  assert.match(proxy, /disable_http_challenge/);
  assert.match(proxy, /reverse_proxy @@BIND_IP@@:@@PORT@@/);
});

test('NAS archive contains only the static allowlist and rendered release files, with no overwrite', async t => {
  const outputRoot = await temporary(t), result = await packageNas({ ...valid, outputRoot });
  const { stdout } = await exec('tar', ['-tzf', result.archive]);
  const files = stdout.trim().split('\n').filter(name => !name.endsWith('/')).map(name => name.replace(`${result.name}/`, '')).sort();
  const site = [...PUBLIC_FILES, 'quest-engine.js', '.nojekyll', 'vendor/three/build/three.module.js', 'vendor/three/build/three.core.js', 'vendor/three/LICENSE', 'demo/blitz-learning-60s.mp4'];
  assert.deepEqual(files, ['compose.yaml', 'Caddyfile', 'proxy-site.Caddyfile', 'release.json', ...site.map(name => `site/${name}`)].sort());
  assert.equal(result.fileCount, site.length);
  const compose = await readFile(path.join(result.releaseRoot, 'compose.yaml'), 'utf8');
  assert.match(compose, /"192\.168\.50\.20:18080:8080"/);
  assert.doesNotMatch(compose, /@@/);
  const manifest = JSON.parse(await readFile(path.join(result.releaseRoot, 'release.json'), 'utf8'));
  assert.equal(manifest.geminiEnabled, false);
  assert.equal(manifest.hostname, 'blitz.bespoke3d.ai');
  assert.equal(manifest.files.length, 19);
  assert.deepEqual(manifest.files.map(file => file.path).sort(), site.sort());
  for (const file of manifest.files) {
    const contents = await readFile(path.join(result.releaseRoot, 'site', file.path));
    assert.equal(file.bytes, contents.length);
    assert.equal(file.sha256, createHash('sha256').update(contents).digest('hex'));
  }
  await assert.rejects(packageNas({ ...valid, outputRoot }), /already exists/);
  assert.equal((await readdir(outputRoot)).filter(name => name.endsWith('.tar.gz')).length, 1);
  const index = await readFile(path.join(result.releaseRoot, 'site/index.html'), 'utf8');
  assert.match(index, /content="static-practice"/);
  assert.doesNotMatch(files.join('\n'), /credentials|server\.mjs|package-lock|node_modules|\.env|\.git\//);
});

test('NAS package refuses a symlink output directory', async t => {
  const root = await temporary(t), target = await temporary(t), link = path.join(root, 'linked');
  await symlink(target, link);
  await assert.rejects(packageNas({ ...valid, outputRoot: link }), /symlink/);
  assert.deepEqual(await readdir(target), []);
});
