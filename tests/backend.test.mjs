import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createTutorServer } from '../server.mjs';
import { tutorRequest, fullText, validateTutorResult, extractAudio, MODEL, TTS_MODEL } from '../gemini.mjs';
import { LESSON, getNode } from '../lesson.mjs';

const answer = (overrides = {}) => ({ feedback: 'Let’s check the boundary.', understanding: 'correct', misconception: null,
  nextAction: 'continue', followUpQuestion: 'Where does the last gap end?', explanation: 'The last gap returns to the starting willow.',
  diagramMode: 'closure', adjustment: 'Use the closing interval.', ...overrides });
const completed = (result = answer(), id = 'interaction-test') => {
  const text = JSON.stringify(result), mid = Math.floor(text.length / 2);
  return { id, status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: text.slice(0, mid) }] },
    { type: 'thought', content: [{ type: 'text', text: 'DO NOT INCLUDE' }] },
    { type: 'model_output', content: [{ type: 'text', text: text.slice(mid) }] }] };
};

async function setup(t, options = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'adult-tutor-test-'));
  const publicDir = path.join(temp, 'public'); await mkdir(publicDir);
  await writeFile(path.join(publicDir, 'index.html'), '<h1>Adult tutor</h1>');
  const sourceVideo = path.join(temp, 'source.mp4'); await writeFile(sourceVideo, '0123456789');
  const app = createTutorServer({ publicDir, sourceVideo, runtimeDir: path.join(temp, 'runtime'), pollMs: 1, ...options });
  const address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await rm(temp, { recursive: true, force: true }); });
  async function req(route, body, headers = {}) {
    return fetch(`${base}${route}`, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body) });
  }
  async function session(mode = options.client ? 'gemini' : 'demo') {
    const response = await req('/api/session', { adultConfirmed: true, cloudConsent: true, mode });
    assert.equal(response.status, 201); return (await response.json()).sessionId;
  }
  async function waitJob(jobId, sessionId) {
    for (let i = 0; i < 100; i++) {
      const response = await req(`/api/jobs/${jobId}?sessionId=${sessionId}`), job = await response.json();
      if (!['queued', 'in_progress'].includes(job.status) || job.resumable) return job;
      await new Promise(r => setTimeout(r, 3));
    }
    throw new Error('Mock job did not finish');
  }
  return { app, base, temp, req, session, waitJob };
}

test('Argon request reapplies defaults, bounded history and canonical facts every turn', () => {
  const request = tutorRequest({ lesson: LESSON, node: getNode('closure'), answer: '11', action: 'answer', history: Array(20).fill({ learner: 'x' }), assessment: { understanding: 'incorrect' } });
  assert.equal(request.model, MODEL); assert.equal(request.background, true); assert.equal(request.store, true);
  assert.deepEqual(request.generation_config, { thinking_level: 'high', max_output_tokens: 1_000_000 });
  assert.ok(request.input.includes('60-metre')); assert.ok(request.input.includes('36-metre'));
  assert.equal(JSON.parse(request.input.split('\n').at(-1)).recentTurns.length, 8);
  assert.match(request.system_instruction, /explanationCriteria/); assert.match(request.system_instruction, /first hint/);
  assert.equal(request.response_format.mime_type, 'application/json');
});

test('collects every model output, excludes thought steps and validates schema locally', () => {
  assert.deepEqual(validateTutorResult(JSON.parse(fullText(completed()))), answer());
  assert.throws(() => validateTutorResult({ ...answer(), arbitraryHtml: '<script>' }));
  assert.throws(() => validateTutorResult(answer({ diagramMode: 'execute-code' })));
  assert.throws(() => validateTutorResult(answer({ explanation: 'x'.repeat(5000) })));
});

test('adult and cloud gates, explicit demo and origin/host guards', async t => {
  const { req, base } = await setup(t);
  assert.equal((await req('/api/session', { adultConfirmed: false, cloudConsent: true })).status, 403);
  assert.equal((await req('/api/session', { adultConfirmed: true })).status, 403);
  assert.equal((await req('/api/session', { adultConfirmed: true, cloudConsent: true })).status, 503);
  assert.equal((await req('/api/session', { adultConfirmed: true, mode: 'demo' })).status, 201);
  assert.equal((await req('/api/health', undefined, { Origin: 'https://evil.invalid' })).status, 403);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${base}/api/health`, { headers: { Host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await req('/api/health', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await fetch(`${base}/api/session`, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await req('/api/session', { adultConfirmed: true, padding: 'x'.repeat(20_000) })).status, 413);
});

test('serves exact source range and public-only files, blocks symlink escape', async t => {
  const { req, temp, base } = await setup(t);
  const range = await req('/media/source.mp4', undefined, { Range: 'bytes=2-5' });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await range.text(), '2345');
  assert.equal((await req('/media/source.mp4', undefined, { Range: 'bytes=90-' })).status, 416);
  assert.equal((await req('/media/source.mp4', undefined, { Range: 'bytes=0-2,5-7' })).status, 416);
  assert.equal((await req('/server.mjs')).status, 404);
  await symlink(path.join(temp, 'source.mp4'), path.join(temp, 'public', 'escape.mp4'));
  assert.equal((await req('/escape.mp4')).status, 403);
  const home = await req('/'); assert.equal(home.status, 200); assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${base}/media/source.mp4`, { method: 'HEAD' })).headers.get('content-length'), '10');
});

test('queued and in_progress poll through completion; wrong canonical answer never advances', async t => {
  let count = 0; const calls = [];
  const client = { interactions: { create: async request => { calls.push(request); return { id: 'resume-wrong', status: 'queued' }; },
    get: async id => { assert.equal(id, 'resume-wrong'); return ++count === 1 ? { id, status: 'in_progress' } : completed(answer(), id); } } };
  const { req, session, waitJob, temp } = await setup(t, { client });
  const sessionId = await session(), response = await req('/api/tutor', { sessionId, nodeId: 'closure', action: 'answer', answer: '11' });
  assert.equal(response.status, 202); const first = await response.json(), done = await waitJob(first.jobId, sessionId);
  assert.equal(done.status, 'completed'); assert.equal(done.result.understanding, 'incorrect'); assert.equal(done.result.nextAction, 'reteach');
  assert.equal(done.result.misconception, 'open-row-endpoint-rule'); assert.match(done.result.explanation, /Eleven would apply/);
  assert.equal(calls.length, 1); assert.equal(calls[0].generation_config.max_output_tokens, 1_000_000);
  const metadata = await readFile(path.join(temp, 'runtime', `job-${first.jobId}.json`), 'utf8');
  assert.ok(!metadata.includes(sessionId)); assert.ok(!metadata.includes('learner')); assert.ok(!metadata.includes('Eleven'));
});

test('teachback and diagnostic replies are not regraded as numeric checkpoint answers', async t => {
  const requests = [];
  const client = { interactions: { create: async request => { requests.push(request); return completed(answer({ explanation: 'You identified the shared start/end marker.' })); } } };
  const { req, session, waitJob, app } = await setup(t, { client }); const sessionId = await session();
  const first = await (await req('/api/tutor', { sessionId, nodeId: 'closure', action: 'question', answer: 'The last gap returns to the same starting willow.', helpTopic: 'teachback' })).json();
  const done = await waitJob(first.jobId, sessionId);
  assert.equal(done.result.understanding, 'correct');
  const context = JSON.parse(requests[0].input.split('\n').at(-1)); assert.equal(context.authoritativeAssessment, null); assert.equal(context.helpTopic, 'teachback');
  assert.ok(context.currentNode.explanationCriteria.length);
  const privateJob = app.jobs.get(first.jobId); assert.equal(privateJob.request, undefined); assert.equal(privateJob.finalize, undefined);
});

test('job access is isolated per session; node/action validation happens before provider calls', async t => {
  let calls = 0; const client = { interactions: { create: async () => { calls++; return completed(); } } };
  const { req, session, waitJob } = await setup(t, { client }); const a = await session(), b = await session();
  assert.equal((await req('/api/tutor', { sessionId: a, nodeId: 'unknown', action: 'answer', answer: 'x' })).status, 400);
  assert.equal((await req('/api/tutor', { sessionId: a, nodeId: 'closure', action: 'execute', answer: 'x' })).status, 400);
  assert.equal(calls, 0);
  const first = await (await req('/api/tutor', { sessionId: a, nodeId: 'closure', action: 'answer', answer: '10' })).json(); await waitJob(first.jobId, a);
  assert.equal((await req(`/api/jobs/${first.jobId}?sessionId=${b}`)).status, 404);
});

test('provider tool requirements and malformed results are explicit terminal failures, never a demo fallback', async t => {
  const responses = [{ id: 'requires', status: 'requires_action', steps: [{ type: 'function_call', name: 'do_something' }] },
    { id: 'malformed', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'not-json' }] }] }];
  const { req, session, waitJob } = await setup(t, { client: { interactions: { create: async () => responses.shift() } } }); const sessionId = await session();
  const one = await (await req('/api/tutor', { sessionId, nodeId: 'gaps', action: 'answer', answer: '10' })).json();
  const tool = await waitJob(one.jobId, sessionId); assert.equal(tool.status, 'requires_action'); assert.match(tool.error, /No tool was executed/);
  const two = await (await req('/api/tutor', { sessionId, nodeId: 'gaps', action: 'answer', answer: '10' })).json();
  const bad = await waitJob(two.jobId, sessionId); assert.equal(bad.status, 'failed'); assert.equal(bad.resumable, undefined); assert.equal(bad.provider, 'gemini');
});

test('redacts provider errors and never exposes raw error payloads or secrets', async t => {
  const { req, session, waitJob } = await setup(t, { client: { interactions: { create: async () => { throw Object.assign(new Error('SECRET_VALUE request.headers.api-key'), { status: 403 }); } } } });
  const sessionId = await session(), first = await (await req('/api/tutor', { sessionId, nodeId: 'gaps', action: 'answer', answer: '10' })).json();
  const done = await waitJob(first.jobId, sessionId); assert.equal(done.status, 'failed'); assert.ok(!JSON.stringify(done).includes('SECRET_VALUE')); assert.match(done.error, /project credential/);
});

test('background deadline retains ID and resumes same interaction without duplicate creation', async t => {
  let creates = 0, ready = false;
  const client = { interactions: { create: async () => { creates++; return { id: 'same-id', status: 'queued' }; }, get: async id => ready ? completed(answer(), id) : { id, status: 'in_progress' } } };
  const { req, session, waitJob } = await setup(t, { client, deadlineMs: 0 }); const sessionId = await session();
  const first = await (await req('/api/tutor', { sessionId, nodeId: 'closure', action: 'answer', answer: '10' })).json();
  const paused = await waitJob(first.jobId, sessionId); assert.equal(paused.resumable, true); assert.equal(paused.interactionId, 'same-id');
  ready = true; const resume = await req(`/api/jobs/${first.jobId}/resume`, { sessionId }); assert.equal(resume.status, 202);
  const done = await waitJob(first.jobId, sessionId); assert.equal(done.status, 'completed'); assert.equal(creates, 1);
});

test('resume is not advertised or accepted while the previous worker still owns the job', async t => {
  const { req, session, app } = await setup(t); const sessionId = await session();
  const jobId = 'aa010000-1111-2222-3333-444444444444';
  // Reproduce the real boundary between setting resumable and awaiting metadata persistence.
  app.jobs.set(jobId, { id: jobId, sessionId, type: 'tutor', provider: 'gemini', status: 'queued',
    interactionId: 'same-existing-interaction', resumable: true, running: true, finalize() {} });
  const owned = await (await req(`/api/jobs/${jobId}?sessionId=${sessionId}`)).json();
  assert.equal(owned.resumable, undefined);
  assert.equal((await req(`/api/jobs/${jobId}/resume`, { sessionId })).status, 409);
  app.jobs.get(jobId).running = false;
  const released = await (await req(`/api/jobs/${jobId}?sessionId=${sessionId}`)).json();
  assert.equal(released.resumable, true);
});

function wav() {
  const buffer = Buffer.alloc(48); buffer.write('RIFF'); buffer.writeUInt32LE(40, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(4, 40); return buffer;
}

test('speech WAV and transcribe stay server-side, are isolated and support explicit session deletion', async t => {
  const requests = [];
  const client = { interactions: { create: async request => { requests.push(request); return request.model === TTS_MODEL
    ? { id: 'speech', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: wav().toString('base64') }] }] }
    : { id: 'transcribe', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'The endpoint is the same tree.' }] }] }; } } };
  const { req, session, waitJob, app } = await setup(t, { client }); const sessionId = await session(), other = await session();
  const speech = await (await req('/api/speech', { sessionId, text: 'Count the closing gap once.' })).json(), done = await waitJob(speech.jobId, sessionId);
  assert.equal(done.status, 'completed'); assert.equal((await req(done.result.audioUrl)).status, 200);
  assert.equal((await req(done.result.audioUrl.replace(sessionId, other))).status, 404);
  const transcribe = await (await req('/api/transcribe', { sessionId, data: wav().toString('base64'), mimeType: 'audio/wav' })).json();
  assert.equal((await waitJob(transcribe.jobId, sessionId)).result.text, 'The endpoint is the same tree.');
  assert.equal(requests[1].store, false); assert.equal(requests[0].store, false); assert.equal(requests[1].generation_config.transcription_config.mode.type, 'verbatim');
  const ended = await req('/api/session/end', { sessionId }); assert.equal(ended.status, 200); assert.equal(app.sessions.has(sessionId), false);
  assert.equal([...app.jobs.values()].some(job => job.sessionId === sessionId), false);
  assert.equal((await req(done.result.audioUrl)).status, 401);
});

test('abandoned sessions expire automatically and clear jobs/private results', async t => {
  const { req, session, app } = await setup(t, { sessionTtlMs: 15 }); const sessionId = await session();
  await req('/api/tutor', { sessionId, nodeId: 'gaps', action: 'answer', answer: '10' });
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(app.sessions.size, 0); assert.equal(app.jobs.size, 0);
});

test('ending a session while Gemini is pending cannot recreate private history or generated audio', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const client = { interactions: { create: async () => pending } };
  const { req, session, app } = await setup(t, { client }); const sessionId = await session();
  await req('/api/speech', { sessionId, text: 'This should not survive ending the session.' });
  assert.equal(app.jobs.size, 1);
  assert.equal((await req('/api/session/end', { sessionId })).status, 200);
  release({ id: 'ended-speech', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: wav().toString('base64') }] }] });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(app.sessions.size, 0); assert.equal(app.jobs.size, 0);
  assert.equal((await req('/api/speech', { sessionId, text: 'no' })).status, 401);
});

test('two resumable jobs do not deadlock the resume concurrency guard', async t => {
  let next = 0, ready = false;
  const client = { interactions: { create: async () => ({ id: `id-${++next}`, status: 'queued' }),
    get: async id => ready ? completed(answer(), id) : { id, status: 'in_progress' } } };
  const { req, session, waitJob } = await setup(t, { client, deadlineMs: 0 }); const sessionId = await session();
  const tutor = await (await req('/api/tutor', { sessionId, nodeId: 'closure', action: 'answer', answer: '10' })).json();
  await waitJob(tutor.jobId, sessionId);
  const speech = await (await req('/api/speech', { sessionId, text: 'This mock request pauses.' })).json(); await waitJob(speech.jobId, sessionId);
  ready = true;
  assert.equal((await req(`/api/jobs/${tutor.jobId}/resume`, { sessionId })).status, 202);
  assert.equal((await waitJob(tutor.jobId, sessionId)).status, 'completed');
});

test('WAV merging preserves all audio blocks without duplicate RIFF headers', () => {
  const source = wav();
  const audio = extractAudio({ steps: [{ type: 'model_output', content: [1, 2].map(() => ({ type: 'audio', mime_type: 'audio/wav', data: source.toString('base64') })) }] });
  assert.equal(audio.buffer.readUInt32LE(40), 8); assert.equal(audio.buffer.length, 52);
});
