import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createTutorServer } from '../server.mjs';
import { liveConfig } from '../live.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function setup(t, options = {}) {
  const app = createTutorServer({ runtimeDir: false, pollMs: 1, ...options });
  const { port } = await app.listen(0), base = `http://127.0.0.1:${port}`;
  t.after(() => app.close());
  const req = (route, body, headers = {}) => fetch(`${base}${route}`, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body) });
  const start = async (extra = {}) => {
    const response = await req('/api/blitz/session', { questId: 'pond-loop', tutorId: 'pip', adultConfirmed: true, cloudConsent: false, ...extra });
    assert.equal(response.status, 201); return response.json();
  };
  return { app, base, req, start };
}

test('catalog, adult gate, allowlists and local practice work without Gemini credentials', async t => {
  const { req, start, app } = await setup(t);
  const catalog = await (await req('/api/blitz/catalog')).json();
  assert.equal(catalog.quests.length, 4); assert.equal(catalog.tutors.length, 4); assert.equal(catalog.models.liveAvailable, false);
  assert.ok(!JSON.stringify(catalog).includes('problems'));
  assert.equal((await req('/api/blitz/session', { questId: 'pond-loop', adultConfirmed: false })).status, 403);
  assert.equal((await req('/api/blitz/session', { questId: 'history', adultConfirmed: true })).status, 400);
  assert.equal((await req('/api/blitz/session', { questId: 'pond-loop', tutorId: 'wrong', adultConfirmed: true })).status, 400);
  assert.equal((await req('/api/blitz/session', { questId: 'pond-loop', adultConfirmed: true, cloudConsent: 'yes' })).status, 400);
  const session = await start(); assert.equal(session.provider, 'verified-local');
  assert.equal(app.blitzSessions.size, 1); assert.equal(session.question.awardEligible, true);
  assert.equal((await req('/api/tutor', { sessionId: session.sessionId, nodeId: 'gaps', action: 'answer', answer: '10' })).status, 400);
});

test('server ignores client stars, enforces active tokens and awards three verified distinct answers only', async t => {
  const { req, start } = await setup(t), session = await start();
  let question = session.question, last;
  for (const [index, answer] of ['10', '20', '6'].entries()) {
    const token = question.id;
    const response = await req('/api/blitz/answer', { sessionId: session.sessionId, questionId: token, answer, stars: 999, correct: true, streak: 3 });
    assert.equal(response.status, 200); last = await response.json();
    assert.equal(last.progress.stars, index + 1); question = last.nextQuestion;
    assert.equal((await req('/api/blitz/answer', { sessionId: session.sessionId, questionId: token, answer })).status, 409);
  }
  assert.equal(last.completed, true); assert.equal(last.nextQuestion, null); assert.equal(last.progress.correct, 3);
  assert.equal((await req('/api/blitz/session/end', { sessionId: session.sessionId })).status, 200);
  assert.equal((await req('/api/blitz/answer', { sessionId: session.sessionId, questionId: 'stale', answer: '10' })).status, 401);
});

test('hints and uncertainty do not award; incorrect resets streak and best is retained', async t => {
  const { req, start } = await setup(t), session = await start();
  const answer = async (question, value) => (await req('/api/blitz/answer', { sessionId: session.sessionId, questionId: question.id, answer: value })).json();
  const first = await answer(session.question, '10'), uncertain = await answer(first.nextQuestion, 'maybe 20');
  assert.equal(uncertain.progress.streak, 0); assert.equal(uncertain.progress.stars, 1); assert.equal(uncertain.progress.answered, 1);
  const hint = await (await req('/api/blitz/hint', { sessionId: session.sessionId, questionId: first.nextQuestion.id })).json();
  assert.equal(hint.question.awardEligible, false);
  const coached = await answer(hint.question, '20'); assert.equal(coached.progress.stars, 1); assert.equal(coached.progress.streak, 0);
  const wrong = await answer(coached.nextQuestion, '100'); assert.equal(wrong.correct, false); assert.equal(wrong.progress.stars, 1);
});

test('Blitz cloud reasoning requires explicit consent, uses selected problem and returns pollable Argon job', async t => {
  const calls = [], result = { feedback: 'Let’s separate the steps.', explanation: 'Count equal groups before combining them.', checkQuestion: 'What does each group represent?' };
  const client = { interactions: { create: async request => { calls.push(request); return { id: 'blitz-argon-test', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(result) }] }] }; } } };
  const { req, start } = await setup(t, { client }), session = await start({ questId: 'equal-groups', tutorId: 'nova' });
  const body = { sessionId: session.sessionId, questionId: session.question.id, message: 'Why multiply here?' };
  assert.equal((await req('/api/blitz/tutor', body)).status, 403); assert.equal(calls.length, 0);
  const response = await req('/api/blitz/tutor', { ...body, cloudConsent: true });
  assert.equal(response.status, 202); const job = await response.json();
  assert.equal(job.question.awardEligible, false); assert.equal(job.coached, true);
  let done;
  for (let index = 0; index < 50; index++) {
    done = await (await req(`/api/jobs/${job.jobId}?sessionId=${session.sessionId}`)).json();
    if (done.status === 'completed') break; await sleep(2);
  }
  assert.equal(done.status, 'completed'); assert.equal(done.result.checkQuestion, result.checkQuestion);
  assert.equal(done.result.questionId, session.question.id); assert.equal(done.result.progress.stars, 0);
  assert.equal(calls[0].model, 'gemini-4-argon'); assert.equal(calls[0].background, true); assert.equal(calls[0].store, true);
  assert.match(JSON.stringify(calls[0]), /trays/); assert.match(JSON.stringify(calls[0]), /Nova/);
  assert.equal((await req('/api/blitz/session/end', { sessionId: session.sessionId })).status, 200);
  assert.equal((await req(`/api/jobs/${job.jobId}?sessionId=${session.sessionId}`)).status, 401);
});

test('unavailable provider never silently replaces Gemini with a local generated response', async t => {
  const { req, start } = await setup(t), session = await start();
  const response = await req('/api/blitz/tutor', { sessionId: session.sessionId, questionId: session.question.id, message: 'Help', cloudConsent: true });
  assert.equal(response.status, 503); assert.match((await response.json()).error, /local practice still works/);
});

test('oversized tutor messages are rejected before hint/streak mutation or provider requests', async t => {
  const calls = [], client = { interactions: { create: async request => { calls.push(request); throw new Error('Must not be called'); } } };
  const { req, start, app } = await setup(t, { client }), session = await start();
  const response = await req('/api/blitz/tutor', { sessionId: session.sessionId, questionId: session.question.id, message: 'x'.repeat(2001), cloudConsent: true });
  assert.equal(response.status, 400); assert.equal(calls.length, 0);
  assert.equal(app.blitzSessions.get(session.sessionId).hinted, false);
  assert.equal(app.blitzSessions.get(session.sessionId).streak, 0);
});

test('tutor selection preserves progress, validates allowlist and cannot change during active coaching', async t => {
  const { req, start, app } = await setup(t), session = await start();
  const first = await (await req('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer: '10' })).json();
  const changed = await req('/api/blitz/tutor-selection', { sessionId: session.sessionId, tutorId: 'nova' });
  assert.equal(changed.status, 200); const result = await changed.json();
  assert.equal(result.tutor.id, 'nova'); assert.equal(result.progress.stars, 1); assert.equal(result.progress.streak, 1);
  assert.equal(app.blitzSessions.get(session.sessionId).questionId, first.nextQuestion.id);
  assert.equal((await req('/api/blitz/tutor-selection', { sessionId: session.sessionId, tutorId: 'bad' })).status, 400);
  app.blitzSessions.get(session.sessionId).coachingActive = 1;
  assert.equal((await req('/api/blitz/tutor-selection', { sessionId: session.sessionId, tutorId: 'sage' })).status, 409);
});

test('quest sessions expire and same-origin protections cover new endpoints', async t => {
  const { req, start, app } = await setup(t, { sessionTtlMs: 20 }), session = await start();
  assert.equal((await req('/api/blitz/catalog', undefined, { Origin: 'https://hostile.invalid' })).status, 403);
  await sleep(30);
  assert.equal((await req('/api/blitz/hint', { sessionId: session.sessionId, questionId: session.question.id })).status, 401);
  assert.equal(app.blitzSessions.size, 0); assert.equal(app.sessions.size, 0);
});

test('selected Live tutor has distinct style/voice and non-pond quest omits pond tools/facts', () => {
  const config = liveConfig(undefined, undefined, { questId: 'fractions', tutorId: 'nova' });
  assert.equal(config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
  assert.match(config.systemInstruction.parts[0].text, /Nova/); assert.match(config.systemInstruction.parts[0].text, /fractions|fraction/);
  assert.equal(config.tools, undefined); assert.ok(!config.systemInstruction.parts[0].text.includes('60-metre'));
  assert.match(config.systemInstruction.parts[0].text, /NEVER identify a person/);
  assert.throws(() => liveConfig(undefined, undefined, { questId: 'unknown' }));
});

test('Live start validates quest/tutor/session before provider call and keeps current/future coached questions ineligible', async t => {
  const calls = [], responses = [];
  const client = { live: { connect: async request => { calls.push(request); request.callbacks.onmessage({ setupComplete: {} }); return { close() {}, sendToolResponse(value) { responses.push(value); } }; } } };
  const { base, req, start, app } = await setup(t, { client });
  async function socket() {
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/live`, { headers: { Origin: base } }), messages = [];
    ws.on('message', raw => messages.push(JSON.parse(raw))); ws.on('error', () => {}); t.after(() => ws.terminate()); await once(ws, 'open');
    const wait = async type => { for (let i = 0; i < 100; i++) { const found = messages.find(message => message.type === type); if (found) return found; await sleep(2); } throw new Error(`Missing ${type}`); };
    return { ws, wait };
  }
  const invalid = await socket(); invalid.ws.send(JSON.stringify({ type: 'start', adultConfirmed: true, cloudConsent: true, questId: 'not-a-quest', tutorId: 'pip' }));
  assert.match((await invalid.wait('error')).message, /supported quest/); assert.equal(calls.length, 0);
  const unbound = await socket(); unbound.ws.send(JSON.stringify({ type: 'start', adultConfirmed: true, cloudConsent: true, questId: 'equal-groups', tutorId: 'sage' }));
  assert.match((await unbound.wait('error')).message, /current quest/); assert.equal(calls.length, 0);
  const session = await start({ questId: 'equal-groups', tutorId: 'sage' });
  const valid = await socket(); valid.ws.send(JSON.stringify({ type: 'start', adultConfirmed: true, cloudConsent: true, questId: 'equal-groups', tutorId: 'sage', questSessionId: session.sessionId, questionId: session.question.id }));
  const ready = await valid.wait('ready'); assert.equal(ready.questId, 'equal-groups'); assert.equal(ready.tutorId, 'sage');
  assert.equal(calls[0].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Fenrir');
  assert.equal(app.blitzSessions.get(session.sessionId).coachingActive, 1);
  const coachedFirst = await (await req('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer: '12' })).json();
  assert.equal(coachedFirst.correct, true); assert.equal(coachedFirst.progress.stars, 0);
  assert.equal(coachedFirst.nextQuestion.awardEligible, false);
  calls[0].callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'bad', name: 'set_lesson_scene', args: { nodeId: 'gaps' } }] } });
  assert.ok(responses[0].functionResponses[0].response.error);
  valid.ws.send(JSON.stringify({ type: 'stop' })); await valid.wait('ended');
  assert.equal(app.blitzSessions.get(session.sessionId).coachingActive, 0);
  const coachedSecond = await (await req('/api/blitz/answer', { sessionId: session.sessionId, questionId: coachedFirst.nextQuestion.id, answer: '20' })).json();
  assert.equal(coachedSecond.correct, true); assert.equal(coachedSecond.progress.stars, 0);
  assert.equal(coachedSecond.nextQuestion.awardEligible, true);
});
