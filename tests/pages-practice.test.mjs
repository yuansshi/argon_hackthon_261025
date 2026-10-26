import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm, lstat, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as engine from '../quests.mjs';
import { createPracticeApi } from '../public/practice-api.js';
import { buildPages, PUBLIC_FILES } from '../scripts/build-pages.mjs';

const start = (api, extra = {}) => api('/api/blitz/session', { questId: 'pond-loop', tutorId: 'pip', adultConfirmed: true, cloudConsent: false, ...extra });
const status = code => error => error.status === code;
const normalize = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'sessionId' || (key === 'id' && /^[0-9a-f-]{36}$/.test(item)) ? '<token>' : item));

test('Pages catalog and health disclose browser-only practice without cloud credentials', async () => {
  const api = createPracticeApi(engine), health = await api('/api/health'), catalog = await api('/api/blitz/catalog');
  assert.equal(health.staticPractice, true); assert.equal(health.configured, false); assert.equal(health.liveAvailable, false);
  assert.equal(health.adultOnly, true); assert.equal(catalog.staticPractice, true);
  assert.deepEqual(catalog.quests, engine.questCatalog().quests); assert.equal(catalog.tutors.length, 4);
  assert.equal(catalog.models.reasoning, null); assert.match(catalog.achievements, /in your browser/);
  assert.equal(catalog.quests[0].problems, undefined); assert.equal(catalog.tutors[0].style, undefined);
  catalog.quests[0].title = 'Changed in caller';
  assert.notEqual((await api('/api/blitz/catalog')).quests[0].title, 'Changed in caller');
});

test('Pages sessions preserve the same authored engine behavior for every quest and problem', async () => {
  for (const quest of engine.QUESTS) {
    const api = createPracticeApi(engine), response = await start(api, { questId: quest.id }), session = engine.createQuestSession({ questId: quest.id, tutorId: 'pip' });
    assert.deepEqual(normalize(response), normalize(engine.publicQuestSession(session)));
    let question = response.question;
    for (const problem of quest.problems) {
      const actualHint = await api('/api/blitz/hint', { sessionId: response.sessionId, questionId: question.id });
      assert.deepEqual(normalize(actualHint), normalize(engine.hintQuest(session, session.questionId)));
      const actual = await api('/api/blitz/answer', { sessionId: response.sessionId, questionId: question.id, answer: String(problem.answer) });
      assert.deepEqual(normalize(actual), normalize(engine.answerQuest(session, session.questionId, String(problem.answer))));
      question = actual.nextQuestion;
    }
    assert.equal(question, null);
  }
});

test('Pages stars require three distinct fresh answers and reject replay and client score fields', async () => {
  const api = createPracticeApi(engine), session = await start(api);
  let question = session.question, result;
  for (const [index, answer] of ['10', '20', '6'].entries()) {
    const body = { sessionId: session.sessionId, questionId: question.id, answer, stars: 9000, streak: 3, correct: true };
    result = await api('/api/blitz/answer', body);
    assert.equal(result.progress.stars, index + 1); assert.equal(result.progress.answered, index + 1);
    await assert.rejects(api('/api/blitz/answer', body), status(409));
    question = result.nextQuestion;
  }
  assert.equal(result.completed, true); assert.equal(result.progress.threeStarGoalReached, true);
  assert.equal(result.nextQuestion, null);
  await assert.rejects(api('/api/blitz/hint', { sessionId: session.sessionId, questionId: session.question.id }), status(409));
});

test('Pages hints, uncertainty and errors preserve best stars without awarding coached answers', async () => {
  const api = createPracticeApi(engine), session = await start(api);
  const first = await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer: '10' });
  const uncertain = await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: first.nextQuestion.id, answer: 'maybe 20' });
  assert.equal(uncertain.understanding, 'uncertain'); assert.equal(uncertain.progress.streak, 0); assert.equal(uncertain.progress.stars, 1);
  assert.equal(uncertain.nextQuestion.id, first.nextQuestion.id);
  const hint = await api('/api/blitz/hint', { sessionId: session.sessionId, questionId: first.nextQuestion.id });
  assert.equal(hint.question.awardEligible, false); assert.equal(hint.progress.streak, 0);
  const coached = await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: hint.question.id, answer: '20' });
  assert.equal(coached.correct, true); assert.equal(coached.progress.stars, 1); assert.equal(coached.progress.streak, 0);
  const wrong = await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: coached.nextQuestion.id, answer: '7' });
  assert.equal(wrong.correct, false); assert.equal(wrong.progress.stars, 1); assert.equal(wrong.progress.streak, 0);
});

test('Pages accepts equivalent fractions and rejects zero-denominator or ambiguous input', async () => {
  for (const answer of ['1/4', '2/8', '.25', 'one quarter']) {
    const api = createPracticeApi(engine), session = await start(api, { questId: 'fractions' });
    assert.equal((await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer })).correct, true);
  }
  const api = createPracticeApi(engine), session = await start(api, { questId: 'fractions' });
  for (const answer of ['1/0', '1/4 or 3/4']) {
    const result = await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer });
    assert.equal(result.correct, null); assert.equal(result.progress.answered, 0); assert.equal(result.progress.stars, 0);
  }
});

test('Pages tutor changes and session end validate identity without resetting progress', async () => {
  const api = createPracticeApi(engine), session = await start(api), other = await start(api);
  const first = await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer: '10' });
  const changed = await api('/api/blitz/tutor-selection', { sessionId: session.sessionId, tutorId: 'sage' });
  assert.equal(changed.tutor.id, 'sage'); assert.equal(changed.progress.stars, 1); assert.equal(changed.tutor.style, undefined);
  await assert.rejects(api('/api/blitz/tutor-selection', { sessionId: session.sessionId, tutorId: '__proto__' }), status(400));
  await assert.rejects(api('/api/blitz/answer', { sessionId: session.sessionId, questionId: other.question.id, answer: '20' }), status(409));
  assert.equal((await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: first.nextQuestion.id, answer: '20' })).progress.stars, 2);
  assert.equal((await api('/api/blitz/session/end', { sessionId: session.sessionId })).ended, true);
  await assert.rejects(api('/api/blitz/hint', { sessionId: session.sessionId, questionId: first.nextQuestion.id }), status(401));
  await assert.rejects(api('/api/blitz/session/end', { sessionId: session.sessionId }), status(401));
  assert.equal((await api('/api/blitz/hint', { sessionId: other.sessionId, questionId: other.question.id })).progress.stars, 0);
});

test('Pages rejects malformed requests before changing active scores', async () => {
  const api = createPracticeApi(engine);
  for (const body of [undefined, null, [], 'start', 3, new Date()]) await assert.rejects(api('/api/blitz/session', body), status(400));
  const cycle = {}; cycle.self = cycle;
  await assert.rejects(api('/api/blitz/session', cycle), status(400));
  await assert.rejects(start(api, { adultConfirmed: false }), status(403));
  await assert.rejects(start(api, { adultConfirmed: 'true' }), status(403));
  await assert.rejects(start(api, { questId: 'history' }), status(400));
  await assert.rejects(start(api, { tutorId: 'real-person' }), status(400));
  await assert.rejects(start(api, { cloudConsent: 'true' }), status(400));
  await assert.rejects(start(api, { padding: 'x'.repeat(20_000) }), status(413));
  const session = await start(api);
  for (const answer of ['', 10, null, 'x'.repeat(2001)]) await assert.rejects(api('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer }), status(400));
  const answer = await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer: '10' });
  assert.equal(answer.progress.stars, 1); assert.equal(answer.progress.answered, 1);
  await assert.rejects(api('/api/blitz/answer', { sessionId: {} }), status(401));
  await assert.rejects(api('/api/health', {}), status(405));
  await assert.rejects(api('/api/blitz/catalog', {}), status(405));
});

test('Pages rejects unavailable cloud routes without fetching or requesting camera/microphone', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Static practice must not fetch'); };
  try {
    const api = createPracticeApi(engine), session = await start(api, { cloudConsent: true });
    for (const route of ['/api/blitz/tutor', '/api/live', '/api/session', '/api/tutor', '/api/speech', '/api/transcribe', '/api/jobs/fake', '/api/jobs/fake/resume']) {
      await assert.rejects(api(route, { sessionId: session.sessionId, message: 'Help', cloudConsent: true }), error => error.status === 503 && /unavailable in this hosted demo/.test(error.message));
    }
    for (const route of ['/api/unknown', '//api/blitz/catalog', '/api/blitz/answer?x=1', null, {}, 'https://example.invalid/api/health']) await assert.rejects(api(route), status(404));
    const result = await api('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer: '10' });
    assert.equal(result.progress.stars, 1);
  } finally { globalThis.fetch = original; }
});

test('Pages limits retained tab sessions and bounds rapid requests', async () => {
  const api = createPracticeApi(engine), sessions = [];
  for (let i = 0; i < 30; i++) sessions.push(await start(api));
  await assert.rejects(start(api), status(429));
  await api('/api/blitz/session/end', { sessionId: sessions[0].sessionId });
  assert.ok((await start(api)).sessionId);
  const session = sessions[1];
  for (let i = 0; i < 60; i++) await api('/api/blitz/hint', { sessionId: session.sessionId, questionId: session.question.id });
  await assert.rejects(api('/api/blitz/hint', { sessionId: session.sessionId, questionId: session.question.id }), status(429));
});

async function tempRoot(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'blitz-pages-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function filesIn(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) files.push(...await filesIn(root, relative)); else files.push(relative);
  }
  return files.sort();
}

test('Pages build includes only allowlisted public files, browser engine and demo', async t => {
  const outputRoot = await tempRoot(t), { outputDir, fileCount } = await buildPages({ outputRoot });
  assert.equal(outputDir, path.join(outputRoot, 'dist-pages'));
  const expected = [...PUBLIC_FILES, 'quest-engine.js', '.nojekyll', 'vendor/three/build/three.module.js', 'vendor/three/build/three.core.js', 'vendor/three/LICENSE', 'demo/blitz-learning-60s.mp4'].sort();
  assert.deepEqual(await filesIn(outputDir), expected); assert.equal(fileCount, expected.length);
  assert.ok((await lstat(path.join(outputDir, 'demo/blitz-learning-60s.mp4'))).size > 2_000_000);
  const index = await readFile(path.join(outputDir, 'index.html'), 'utf8');
  assert.match(index, /<meta name="blitz-deployment" content="static-practice">/);
  const browserEngine = await readFile(path.join(outputDir, 'quest-engine.js'), 'utf8');
  assert.ok(browserEngine.includes('globalThis.crypto.randomUUID()')); assert.ok(!browserEngine.includes('node:'));
  const builtEngine = await import(`data:text/javascript;base64,${Buffer.from(browserEngine).toString('base64')}`);
  assert.deepEqual(builtEngine.questCatalog(), engine.questCatalog());
  const session = await start(createPracticeApi(builtEngine));
  assert.equal(session.question.prompt, engine.QUESTS[0].problems[0].prompt);
  for (const filename of expected.filter(file => /\.(?:js|html|css|json|svg)$/.test(file))) {
    const source = await readFile(path.join(outputDir, filename), 'utf8');
    assert.doesNotMatch(source, /(?:AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|\/Users\/yuansshi|access_info\.md)/);
    assert.doesNotMatch(source, /\b(?:from|import)\s*['"]node:|\bimport\s*\(\s*['"]node:/);
  }
});

test('Pages rebuild replaces only its named generated folder and refuses a symlink target', async t => {
  const outputRoot = await tempRoot(t), kept = path.join(outputRoot, 'keep.txt');
  await writeFile(kept, 'untouched');
  const { outputDir } = await buildPages({ outputRoot });
  await writeFile(path.join(outputDir, 'stale.txt'), 'remove generated stale file');
  await buildPages({ outputRoot });
  assert.equal(await readFile(kept, 'utf8'), 'untouched');
  assert.ok(!(await filesIn(outputDir)).includes('stale.txt'));
  const other = await tempRoot(t), protectedDir = path.join(other, 'protected');
  await mkdir(protectedDir); await writeFile(path.join(protectedDir, 'keep.txt'), 'safe');
  await symlink(protectedDir, path.join(other, 'dist-pages'));
  await assert.rejects(buildPages({ outputRoot: other }), /symlink dist-pages/);
  assert.equal(await readFile(path.join(protectedDir, 'keep.txt'), 'utf8'), 'safe');
});
