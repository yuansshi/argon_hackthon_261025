import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';
import { liveConfig } from '../live.mjs';

// Opt-in, billable provider smoke. Uses synthetic adult text only: no key access,
// microphone, camera, user media, or saved transcripts/audio.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.BLITZ_SMOKE_BASE ?? 'http://127.0.0.1:8792';
const parsedBase = new URL(base);
assert.ok(['127.0.0.1', 'localhost'].includes(parsedBase.hostname) && parsedBase.protocol === 'http:', 'Use a loopback HTTP server.');
const pendingFile = path.join(root, '.runtime/smoke-blitz-pending.json');
const reportFile = path.join(root, 'reports/blitz-provider-smoke.json');
const startedAt = Date.now(), owned = new Set(), retained = new Set();
const report = { app: 'Blitz Learning', scope: 'Synthetic adult math practice; no camera or microphone', startedAt: new Date().toISOString(), checks: {}, models: {}, provider: {} };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, value, detail) => { report.checks[name] = { passed: Boolean(value), ...(detail === undefined ? {} : { detail }) }; assert.ok(value, `CHECK_FAILED:${name}`); };
async function request(route, body) {
  const response = await fetch(`${base}${route}`, body === undefined ? { signal: AbortSignal.timeout(15_000) } : { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const json = await response.json(); return { status: response.status, json };
}
async function post(route, body, expected = 200) {
  const response = await request(route, body); assert.equal(response.status, expected, `LOCAL_HTTP_${response.status}`); return response.json;
}
async function start(questId, tutorId = 'pip') {
  const session = await post('/api/blitz/session', { questId, tutorId, adultConfirmed: true, cloudConsent: false }, 201);
  owned.add(session.sessionId); return session;
}
async function savePending(state) {
  await mkdir(path.dirname(pendingFile), { recursive: true, mode: 0o700 });
  await writeFile(pendingFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}
async function localChecks() {
  const { json: catalog, status } = await request('/api/blitz/catalog');
  check('catalog', status === 200 && catalog.quests.length === 4 && catalog.tutors.length === 4);
  report.models = { reasoning: catalog.models.reasoning, live: catalog.models.live, tts: catalog.models.tts };
  check('providerConfigured', catalog.models.liveAvailable === true);
  const streak = await start('pond-loop'); let question = streak.question, last, firstToken;
  for (const answer of ['10', '20', '6']) {
    firstToken ??= question.id;
    last = await post('/api/blitz/answer', { sessionId: streak.sessionId, questionId: question.id, answer });
    question = last.nextQuestion;
  }
  check('threeDistinctCorrectEarnThreeStars', last.progress.stars === 3 && last.progress.streak === 3 && last.progress.threeStarGoalReached === true);
  const replay = await request('/api/blitz/answer', { sessionId: streak.sessionId, questionId: firstToken, answer: '10' });
  check('replayRejected', replay.status === 409);
  const reset = await start('equal-groups');
  const correct = await post('/api/blitz/answer', { sessionId: reset.sessionId, questionId: reset.question.id, answer: '12' });
  const wrong = await post('/api/blitz/answer', { sessionId: reset.sessionId, questionId: correct.nextQuestion.id, answer: '21' });
  check('wrongResetsStreakButKeepsBest', wrong.progress.streak === 0 && wrong.progress.stars === 1 && wrong.correct === false);
  const hint = await post('/api/blitz/hint', { sessionId: reset.sessionId, questionId: wrong.nextQuestion.id });
  const coached = await post('/api/blitz/answer', { sessionId: reset.sessionId, questionId: hint.question.id, answer: '6' });
  check('hintDisablesAward', hint.question.awardEligible === false && coached.correct === true && coached.progress.streak === 0 && coached.progress.stars === 1);
}
async function argonCheck() {
  const began = Date.now(); let state;
  try { state = JSON.parse(await readFile(pendingFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('PENDING_STATE_UNREADABLE'); }
  if (state) {
    assert.equal(state.base, base, 'Pending job belongs to a different server.');
    assert.ok(state.jobId, 'Submission outcome is uncertain; inspect the retained local state before another billable request.');
    owned.add(state.sessionId); retained.add(state.sessionId);
    report.provider.argonResumedExistingJob = true;
  } else {
    const session = await start('fractions');
    state = { base, sessionId: session.sessionId, questionId: session.question.id, jobId: null, status: 'submission-uncertain', createdAt: new Date().toISOString() };
    retained.add(state.sessionId); await savePending(state);
    const job = await post('/api/blitz/tutor', { sessionId: session.sessionId, questionId: session.question.id, cloudConsent: true,
      message: 'I am an adult reviewing foundational fractions. I see one highlighted part out of four equal parts. Explain why the total number of equal parts is the denominator, then ask one short question to check my reasoning. Keep it concise.' }, 202);
    state.jobId = job.jobId; state.status = job.status; await savePending(state);
    check('argonHelpMarksCoached', job.question.awardEligible === false && job.progress.stars === 0 && job.coached === true);
  }
  const deadline = Date.now() + 180_000, statuses = new Set(); let resumes = 0;
  while (Date.now() < deadline) {
    const { status, json: job } = await request(`/api/jobs/${encodeURIComponent(state.jobId)}?sessionId=${encodeURIComponent(state.sessionId)}`);
    assert.equal(status, 200, `LOCAL_JOB_HTTP_${status}`);
    statuses.add(job.status); state.status = job.status;
    if (job.interactionId) state.interactionId = job.interactionId;
    await savePending(state);
    if (job.status === 'completed') {
      const keys = ['feedback', 'explanation', 'checkQuestion'];
      check('argonStructuredTutoring', keys.every(key => typeof job.result?.[key] === 'string' && job.result[key].trim().length > 0) && job.result.provider === 'gemini');
      check('argonCannotAwardStars', job.result.progress.stars === 0 && job.result.coached === true);
      report.provider.argon = { status: 'completed', model: report.models.reasoning, durationMs: Date.now() - began, observedStatuses: [...statuses], resumptions: resumes, structuredFields: keys, outputCharacters: keys.reduce((sum, key) => sum + job.result[key].length, 0) };
      retained.delete(state.sessionId); await unlink(pendingFile); return;
    }
    if (['failed', 'incomplete', 'requires_action', 'cancelled'].includes(job.status)) {
      retained.delete(state.sessionId); await unlink(pendingFile);
      throw new Error(`ARGON_TERMINAL_${job.status.toUpperCase()}`);
    }
    if (job.resumable === true) {
      await post(`/api/jobs/${encodeURIComponent(state.jobId)}/resume`, { sessionId: state.sessionId }, 202); resumes++;
    }
    await sleep(2000);
  }
  report.provider.argon = { status: 'pending', model: report.models.reasoning, durationMs: Date.now() - began, observedStatuses: [...statuses], resumptions: resumes, resumeStateRetained: true };
  throw new Error('ARGON_DEADLINE_RESUMABLE_LOCAL_STATE_RETAINED');
}
async function liveCheck() {
  const began = Date.now(), session = await start('fractions', 'pip');
  check('nonPondLiveHasNoPondTools', liveConfig(undefined, undefined, { questId: 'fractions', tutorId: 'pip' }).tools === undefined);
  let ws, bytes = 0, audioMessages = 0, captionCharacters = 0, sceneEvents = 0, readyModel, ended = false;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
      setTimeout(() => ws?.terminate(), 250).unref();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(new Error('LIVE_OUTPUT_DEADLINE')), 30_000);
    ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/live`, { headers: { Origin: base } });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'start', questSessionId: session.sessionId, questionId: session.question.id, questId: 'fractions', tutorId: 'pip', adultConfirmed: true, cloudConsent: true, videoConsent: false })));
    ws.on('error', () => finish(new Error('LIVE_TRANSPORT_FAILED')));
    ws.on('close', () => { if (!settled) finish(new Error('LIVE_CLOSED_BEFORE_OUTPUT')); });
    ws.on('message', raw => {
      let message; try { message = JSON.parse(raw); } catch { finish(new Error('LIVE_INVALID_JSON')); return; }
      if (message.type === 'ready') {
        readyModel = message.model;
        if (message.questId !== 'fractions' || message.tutorId !== 'pip' || message.videoEnabled !== false) { finish(new Error('LIVE_SELECTION_MISMATCH')); return; }
        ws.send(JSON.stringify({ type: 'text', text: 'I am an adult practicing fractions. Explain what the denominator means in one or two short sentences, then ask one question. Do not give a lecture.' }));
      } else if (message.type === 'audio') { bytes += Buffer.byteLength(message.data, 'base64'); audioMessages++; }
      else if (message.type === 'caption') captionCharacters += typeof message.text === 'string' ? message.text.length : 0;
      else if (message.type === 'scene') sceneEvents++;
      else if (message.type === 'error') finish(new Error('LIVE_PROVIDER_OR_VALIDATION_FAILED'));
      else if (message.type === 'ended') ended = true;
      else if (message.type === 'turn-complete' && bytes > 0 && captionCharacters > 0) finish();
    });
  });
  check('liveReceivesAudioAndTranscription', bytes > 0 && captionCharacters > 0 && readyModel === report.models.live);
  check('liveUsesSelectedNonPondQuest', sceneEvents === 0);
  // Let the explicit stop release server-authoritative coaching before probing progress.
  await sleep(300);
  const coached = await post('/api/blitz/answer', { sessionId: session.sessionId, questionId: session.question.id, answer: '1/4' });
  check('liveCoachingDisablesStarsServerSide', coached.correct === true && coached.progress.stars === 0);
  report.provider.live = { status: 'completed', model: readyModel, quest: 'fractions', tutor: 'pip', audioFormat: 'PCM16 mono 24000Hz', pcmBytes: bytes, audioMessages, transcriptionCharacters: captionCharacters, sceneEvents, explicitStopAcknowledged: ended, durationMs: Date.now() - began };
}

try {
  await localChecks();
  const results = await Promise.allSettled([argonCheck(), liveCheck()]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  // Own error categories only, never raw provider payloads, diagnostics or bearer IDs.
  report.failureCategory = /^(?:CHECK_FAILED:|ARGON_|LIVE_|LOCAL_)/.test(error?.message ?? '') ? error.message : 'SMOKE_CHECK_FAILED';
  process.exitCode = 1;
} finally {
  for (const sessionId of owned) if (!retained.has(sessionId)) await request('/api/blitz/session/end', { sessionId }).catch(() => {});
  report.completedAt = new Date().toISOString(); report.durationMs = Date.now() - startedAt;
  report.pendingResumeStateRetained = retained.size > 0;
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, checks: Object.fromEntries(Object.entries(report.checks).map(([name, value]) => [name, value.passed])), durationMs: report.durationMs, pendingResumeStateRetained: report.pendingResumeStateRetained, report: 'reports/blitz-provider-smoke.json' }));
}
