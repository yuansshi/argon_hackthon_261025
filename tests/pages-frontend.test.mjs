import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
const [app, html, css, audio, photo, pond] = await Promise.all(['blitz-app.js', 'index.html', 'styles.css', 'audio.js', 'photo-avatar.js', 'pond-stage.js'].map(read));
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

test('static practice is explicit, dynamically loaded, and never a backend fallback', () => {
  assert.match(app, /document\.querySelector\('meta\[name="blitz-deployment"\]'\)\?\.content === 'static-practice'/);
  assert.match(app, /STATIC_PRACTICE\s*\? Promise\.all\(\[import\('\.\/practice-api\.js'\), import\('\.\/quest-engine\.js'\)\]/);
  assert.match(app, /createPracticeApi\(engine\)/);
  assert.doesNotMatch(html, /name="blitz-deployment"/); // Added only to the built Pages artifact.
});

test('static API requests bypass fetch including end-session lifecycle', async () => {
  const calls = [];
  const api = new Function('STATIC_PRACTICE', 'staticApi', 'fetch', `return (${between('async function api(', 'function setBusy(')});`)(
    true,
    Promise.resolve(async (path, body) => { calls.push({ path, body }); return { ok: true }; }),
    () => { throw new Error('Static practice must not fetch a backend.'); },
  );
  assert.deepEqual(await api('/api/blitz/session/end', { sessionId: 'practice-session' }, { keepalive: true }), { ok: true });
  assert.deepEqual(calls, [{ path: '/api/blitz/session/end', body: { sessionId: 'practice-session' } }]);
  const onHide = between("window.addEventListener('pagehide'", "window.addEventListener('pageshow'");
  assert.match(onHide, /api\('\/api\/blitz\/session\/end'/);
  assert.doesNotMatch(onHide, /fetch\(/);
});

test('static cloud, microphone, camera, and Live entry points return before reading state', async () => {
  const inaccessibleState = new Proxy({}, { get() { throw new Error('Static media entry point must return before reading state.'); } });
  for (const [start, end] of [
    ['async function confirmCloud()', 'const delay'],
    ['async function askReasoning()', 'function socketSend'],
    ['async function startLive()', 'async function handleLive'],
    ['async function enableMicrophone()', 'function waitCameraConsent'],
    ['async function enableCamera()', 'async function loadCatalog'],
  ]) {
    const action = new Function('STATIC_PRACTICE', 'state', `return (${between(start, end)});`)(true, inaccessibleState);
    await action();
  }
  assert.match(app, /\$\('ask-button'\)\.disabled = locked \|\| STATIC_PRACTICE/);
  assert.match(app, /\$\('connect-tutor'\)\.disabled = STATIC_PRACTICE/);
  assert.match(app, /function socketSend\(message\) \{ if \(STATIC_PRACTICE \|\|/);
});

test('Pages capabilities are visibly explained on home and lesson, not tooltip-only', () => {
  assert.match(html, /id="pages-home-notice"[\s\S]*?Hosted practice demo/);
  assert.match(html, /id="pages-lesson-notice"[\s\S]*?AI chat, voice, and camera require the local Node app/);
  assert.match(html, /id="pages-ai-note"[\s\S]*?Ask tutor and Gemini voice are unavailable/);
  assert.match(app, /setAttribute\('aria-describedby', 'pages-ai-note'\)/);
  assert.match(app, /Local Node app only · Gemini Argon/);
  assert.match(app, /Local Node app only · Gemini Live/);
  assert.equal((html.match(/href="\.\/demo\/blitz-learning-60s\.mp4"/g) || []).length, 2);
  assert.match(html, /https:\/\/github\.com\/yuansshi\/argon_hackthon_261025#try-it-locally/);
  assert.match(css, /\.deployment-notice/);
});

test('frontend entry points and visual/media assets remain safe under a Pages subpath', () => {
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/blitz-app\.js"/);
  assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/);
  assert.doesNotMatch(css, /url\(['"]?\/(?!\/)/);
  assert.match(photo, /new URL\('\.\/assets\/alex-photo-atlas\.png', import\.meta\.url\)/);
  assert.match(audio, /new URL\('\.\/input-worklet\.js', import\.meta\.url\)/);
  assert.match(pond, /import\('\.\/vendor\/three\/build\/three\.module\.js'\)/);
});
