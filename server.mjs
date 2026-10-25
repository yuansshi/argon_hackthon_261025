import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LESSON, getNode, assessAnswer } from './lesson.mjs';
import { loadProjectCredential } from './credentials.mjs';
import { LIVE_MODEL, attachLiveRelay } from './live.mjs';
import { QuestError, questCatalog, createQuestSession, publicQuestSession, answerQuest, hintQuest, getQuest, getTutor, publicTutor, questProgress } from './quests.mjs';
import { blitzTutorRequest, validateBlitzTutorResult } from './blitz-gemini.mjs';
import { MODEL, TTS_MODEL, TRANSCRIBE_MODEL, createGeminiClient, tutorRequest, speechRequest,
  transcribeRequest, fullText, validateTutorResult, extractAudio, safeProviderError } from './gemini.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(ROOT, '../output/recreated_planting_trees_example_5_grade2/01_planting_trees_example_5_grade2_en.mp4');
const SESSION_TTL = 2 * 60 * 60 * 1000;
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
const TERMINAL = new Set(['completed', 'failed', 'incomplete', 'requires_action', 'cancelled']);

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function requestGuard(req, port) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowed.has(req.headers.host)) throw new HttpError(403, 'Only this local application host is allowed.');
  if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) throw new HttpError(403, 'Cross-origin requests are not allowed.');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
}

async function readJson(req, max = 16_384) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Use application/json.');
  if (Number(req.headers['content-length'] ?? 0) > max) { req.resume(); throw new HttpError(413, 'Request is too large.'); }
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new HttpError(400, 'A JSON object is required.'); }
}

function boundedText(value, max, name, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new HttpError(400, `${name} must be text${required ? ' and nonempty' : ''}, up to ${max} characters.`);
  return value.trim();
}

function demoReply(node, action, assessment) {
  const uncertain = { understanding: 'uncertain', misconception: null, explanation: 'This is a local demonstration, not Gemini reasoning. Try a checkpoint choice to test the lesson flow.' };
  const check = action === 'answer' ? assessment : uncertain;
  return {
    feedback: check.understanding === 'correct' ? 'That matches this checkpoint.' : check.understanding === 'incorrect' ? 'Let’s revisit the key step.' : 'Let’s work through one step at a time.',
    understanding: check.understanding, misconception: check.misconception,
    nextAction: check.understanding === 'correct' ? 'continue' : 'retry',
    followUpQuestion: node.checkpoint.prompt, explanation: check.explanation,
    diagramMode: node.diagram.mode, adjustment: 'Local demo only: no request was sent to Gemini.',
    provider: 'local-demo',
  };
}

/** Dependency injection keeps every automated test offline and credential-free. */
export function createTutorServer(options = {}) {
  const credential = options.credential ?? null;
  const apiKey = typeof credential === 'string' ? credential : credential?.apiKey;
  const client = options.client ?? (apiKey ? createGeminiClient(apiKey) : null);
  const configured = Boolean(client);
  const lesson = options.lesson ?? LESSON;
  const nodeFor = options.getNode ?? getNode, grade = options.assessAnswer ?? assessAnswer;
  const publicDir = options.publicDir ?? path.join(ROOT, 'public');
  const sourceVideo = options.sourceVideo ?? SOURCE;
  const runtimeDir = options.runtimeDir === false ? null : options.runtimeDir ?? path.join(ROOT, 'runtime');
  const pollMs = options.pollMs ?? 1500, deadlineMs = options.deadlineMs ?? 15 * 60 * 1000;
  const sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL;
  const sessions = new Map(), jobs = new Map(), audios = new Map(), blitzSessions = new Map();
  let audioBytes = 0, closing = false;

  function purgeSession(id) {
    const session = sessions.get(id);
    if (session) session.history.length = 0;
    sessions.delete(id);
    blitzSessions.delete(id);
    for (const [audioId, audio] of audios) if (audio.sessionId === id) { audioBytes -= audio.buffer.length; audios.delete(audioId); }
    for (const [jobId, job] of jobs) if (job.sessionId === id) {
      if (!TERMINAL.has(job.status) && job.interactionId && !job.cancellationRequested && typeof client?.interactions?.cancel === 'function') {
        job.cancellationRequested = true;
        void client.interactions.cancel(job.interactionId).catch(() => {});
      }
      delete job.result; delete job.request; delete job.finalize; jobs.delete(jobId);
    }
  }
  function purgeExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of sessions) if (now - session.lastSeen > sessionTtlMs) purgeSession(id);
    for (const [id, session] of blitzSessions) if (now - session.lastSeen > sessionTtlMs) blitzSessions.delete(id);
  }
  const sweeper = setInterval(purgeExpiredSessions, Math.max(10, Math.min(60_000, sessionTtlMs / 2)));
  sweeper.unref();

  function requireSession(id, allowBlitz = false) {
    if (typeof id !== 'string') throw new HttpError(401, 'Start a consenting adult session first.');
    const session = sessions.get(id);
    if (!session || Date.now() - session.lastSeen > sessionTtlMs) { purgeSession(id); throw new HttpError(401, 'The session expired. Start a new session.'); }
    if (session.scope === 'blitz' && !allowBlitz) throw new HttpError(400, 'Use the Blitz Learning endpoint for this quest session.');
    session.lastSeen = Date.now();
    return session;
  }
  function requireBlitzSession(id) {
    const session = typeof id === 'string' ? blitzSessions.get(id) : null;
    if (!session || Date.now() - session.lastSeen > sessionTtlMs) {
      blitzSessions.delete(id); throw new HttpError(401, 'This quest session expired. Start a new quest.');
    }
    session.lastSeen = Date.now();
    session.requests = session.requests.filter(time => Date.now() - time < 60_000);
    if (session.requests.length >= 60) throw new HttpError(429, 'Please pause before submitting another quest request.');
    session.requests.push(Date.now());
    return session;
  }
  function rateLimit(session, excludeJobId) {
    const now = Date.now();
    session.requests = session.requests.filter(t => now - t < 60_000);
    if (session.requests.length >= 15) throw new HttpError(429, 'Please wait before submitting another request.');
    if ([...jobs.values()].filter(j => j.id !== excludeJobId && j.sessionId === session.id && !TERMINAL.has(j.status)).length >= 2) throw new HttpError(429, 'Please wait for your current requests to finish.');
    session.requests.push(now);
  }
  async function persist(job) {
    if (!runtimeDir) return;
    // Deliberately excludes session bearer IDs, prompts, answers, transcripts, generated replies and keys.
    const record = { jobId: job.id, type: job.type, model: job.model, status: job.status,
      interactionId: job.interactionId ?? null, createdAt: job.createdAt, updatedAt: new Date().toISOString(),
      resumable: Boolean(job.interactionId && job.resumable) };
    await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(runtimeDir, `job-${job.id}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  }
  function publicJob(job) {
    return { jobId: job.id, status: job.status, provider: job.provider, ...(job.interactionId ? { interactionId: job.interactionId } : {}),
      ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}),
      // A paused job is resumable only after its current worker has released ownership.
      // Publishing this during the asynchronous metadata write can lose an immediate resume.
      ...(job.resumable && !job.running ? { resumable: true } : {}) };
  }
  function newJob(session, type, model) {
    const job = { id: randomUUID(), sessionId: session.id, type, model, status: 'queued', provider: session.mode === 'demo' ? 'local-demo' : 'gemini', createdAt: new Date().toISOString() };
    jobs.set(job.id, job);
    // Bound completed jobs and their private result text to a single ephemeral session lifetime.
    for (const [id, old] of jobs) if (jobs.size > 300 && TERMINAL.has(old.status)) jobs.delete(id);
    return job;
  }
  async function runInteraction(job, request, finalize, resume = false) {
    if (job.running || closing) return;
    job.running = true; job.resumable = false; delete job.error;
    const started = Date.now();
    try {
      let interaction = resume ? await client.interactions.get(job.interactionId) : await client.interactions.create(request);
      if (interaction.id) job.interactionId = interaction.id;
      job.status = ['queued', 'in_progress'].includes(interaction.status) ? interaction.status : 'in_progress';
      await persist(job);
      while (['queued', 'in_progress'].includes(interaction.status)) {
        if (!sessions.has(job.sessionId)) {
          if (job.interactionId && !job.cancellationRequested && typeof client.interactions.cancel === 'function') await client.interactions.cancel(job.interactionId).catch(() => {});
          job.status = 'cancelled'; job.resumable = false; await persist(job); return;
        }
        if (closing || Date.now() - started >= deadlineMs) {
          job.status = interaction.status; job.resumable = Boolean(job.interactionId);
          job.error = 'This background request is still running. Its interaction ID is retained; resume this job rather than submitting it again.';
          await persist(job); return;
        }
        if (!job.interactionId) throw new Error('MISSING_INTERACTION_ID');
        await sleep(pollMs);
        interaction = await client.interactions.get(job.interactionId);
        job.status = ['queued', 'in_progress'].includes(interaction.status) ? interaction.status : 'in_progress'; await persist(job);
      }
      if (interaction.status === 'completed') {
        if (!sessions.has(job.sessionId)) { job.status = 'cancelled'; job.resumable = false; await persist(job); return; }
        try { job.result = await finalize(interaction); job.status = 'completed'; }
        catch { job.status = 'failed'; job.error = 'Gemini returned an invalid or unsupported response. No local fallback was used.'; }
      } else {
        job.status = ['failed', 'incomplete', 'cancelled', 'requires_action'].includes(interaction.status) ? interaction.status : 'failed';
        job.error = job.status === 'requires_action' ? 'Gemini requested an unsupported tool action. No tool was executed.' : `Gemini ended this request with status ${job.status}. No local fallback was used.`;
      }
      // Release private request/finalizer references before publishing any terminal state.
      delete job.request; delete job.finalize;
      await persist(job);
    } catch (error) {
      if (job.interactionId && request?.background !== false) {
        job.status = 'in_progress'; job.resumable = true;
        job.error = 'The connection was interrupted. The interaction ID is retained; resume this job to retrieve its result.';
      } else {
        job.status = 'failed'; job.error = safeProviderError(error);
        delete job.request; delete job.finalize;
      }
      await persist(job).catch(() => {});
    } finally {
      job.running = false;
      if (!job.resumable) { delete job.request; delete job.finalize; }
    }
  }
  function cacheAudio(session, audio) {
    const id = randomUUID();
    const maxBytes = 40 * 1024 * 1024;
    if (audio.buffer.length > maxBytes) throw new Error('AUDIO_TOO_LARGE');
    while (audios.size >= 20 || audioBytes + audio.buffer.length > maxBytes) {
      const [oldId, old] = audios.entries().next().value;
      audioBytes -= old.buffer.length; audios.delete(oldId);
    }
    audios.set(id, { ...audio, sessionId: session.id }); audioBytes += audio.buffer.length;
    return `/api/audio/${id}?sessionId=${encodeURIComponent(session.id)}`;
  }

  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port ?? Number(process.env.PORT ?? 8791);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
    try {
      requestGuard(req, port);
      purgeExpiredSessions();
      if (req.method === 'OPTIONS') throw new HttpError(405, 'Cross-origin access is disabled.');
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { configured, model: MODEL, ttsModel: TTS_MODEL, transcribeModel: TRANSCRIBE_MODEL, liveModel: LIVE_MODEL, liveAvailable: liveRelay.available, demoAvailable: !configured, adultOnly: true });
      if (req.method === 'GET' && url.pathname === '/api/blitz/catalog') return json(res, 200, {
        ...questCatalog(), models: { reasoning: MODEL, live: LIVE_MODEL, tts: TTS_MODEL, liveAvailable: liveRelay.available },
        audience: 'Adults 18+', achievements: 'Three consecutive distinct, unhinted correct answers earn three stars. Scores are checked on the server.',
      });
      if (req.method === 'POST' && url.pathname === '/api/blitz/session') {
        const body = await readJson(req);
        if (body.adultConfirmed !== true) throw new HttpError(403, 'Blitz Learning is currently for adults aged 18 and over.');
        if (body.cloudConsent !== undefined && typeof body.cloudConsent !== 'boolean') throw new HttpError(400, 'Cloud consent must be true or false.');
        if (sessions.size >= 30) throw new HttpError(429, 'Too many active local quest sessions. End another session first.');
        const session = { ...createQuestSession(body), scope: 'blitz', mode: 'local-practice', history: [] };
        blitzSessions.set(session.id, session); sessions.set(session.id, session);
        return json(res, 201, publicQuestSession(session));
      }
      if (req.method === 'POST' && url.pathname === '/api/blitz/answer') {
        const body = await readJson(req), session = requireBlitzSession(body.sessionId);
        return json(res, 200, answerQuest(session, body.questionId, body.answer));
      }
      if (req.method === 'POST' && url.pathname === '/api/blitz/hint') {
        const body = await readJson(req), session = requireBlitzSession(body.sessionId);
        return json(res, 200, hintQuest(session, body.questionId));
      }
      if (req.method === 'POST' && url.pathname === '/api/blitz/tutor-selection') {
        const body = await readJson(req), session = requireBlitzSession(body.sessionId), tutor = getTutor(body.tutorId);
        if (!tutor) throw new HttpError(400, 'Choose a supported tutor.');
        if (session.coachingActive || [...jobs.values()].some(job => job.sessionId === session.id && !TERMINAL.has(job.status))) throw new HttpError(409, 'End live coaching and wait for your current tutor response before changing tutors.');
        session.tutorId = tutor.id;
        return json(res, 200, { tutor: publicTutor(tutor), progress: questProgress(session) });
      }
      if (req.method === 'POST' && url.pathname === '/api/blitz/tutor') {
        const body = await readJson(req), session = requireBlitzSession(body.sessionId);
        if (body.cloudConsent !== true) throw new HttpError(403, 'Explicit consent to send this question and message to Gemini is required.');
        if (!configured) throw new HttpError(503, 'No project-designated Gemini credential is configured. Verified local practice still works.');
        const message = boundedText(body.message, 2000, 'Tutor message', true);
        if ([...jobs.values()].some(job => job.sessionId === session.id && !TERMINAL.has(job.status))) throw new HttpError(409, 'Wait for your current tutor response before asking again.');
        const guidance = hintQuest(session, body.questionId), quest = getQuest(session.questId);
        session.cloudConsent = true; session.mode = 'gemini';
        const job = newJob(session, 'blitz-tutor', MODEL);
        job.request = blitzTutorRequest({ quest, tutor: getTutor(session.tutorId), problem: quest.problems[session.index], message });
        job.finalize = async interaction => ({ ...validateBlitzTutorResult(JSON.parse(fullText(interaction))), provider: 'gemini', questionId: body.questionId, coached: true, progress: questProgress(session) });
        void runInteraction(job, job.request, job.finalize);
        return json(res, 202, { ...publicJob(job), question: guidance.question, progress: guidance.progress, coached: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/blitz/session/end') {
        const body = await readJson(req), session = requireBlitzSession(body.sessionId);
        purgeSession(session.id);
        return json(res, 200, { ended: true, note: 'Local quest answers and session progress cleared. Keep only aggregate best stars on your device if desired.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/lesson') return json(res, 200, lesson);
      if (req.method === 'POST' && url.pathname === '/api/session') {
        const body = await readJson(req);
        if (body.adultConfirmed !== true) throw new HttpError(403, 'This application is only for adults aged 18 and over.');
        const mode = body.mode ?? 'gemini';
        if (!['gemini', 'demo'].includes(mode)) throw new HttpError(400, 'Unknown session mode.');
        if (mode === 'gemini' && body.cloudConsent !== true) throw new HttpError(403, 'Consent to sending lesson answers and requested microphone recordings to Gemini is required.');
        if (mode === 'gemini' && !configured) throw new HttpError(503, 'No project-designated Gemini credential is configured. Choose explicit local demo mode or configure the project credential.');
        if (mode === 'demo' && configured) throw new HttpError(409, 'Gemini is configured. The local demonstration mode is disabled.');
        if (sessions.size >= 30) throw new HttpError(429, 'Too many local sessions. Restart the application to clear expired sessions.');
        const id = randomUUID(); sessions.set(id, { id, mode, lastSeen: Date.now(), requests: [], history: [] });
        return json(res, 201, { sessionId: id, mode, provider: mode === 'demo' ? 'local-demo' : 'gemini' });
      }
      if (req.method === 'POST' && url.pathname === '/api/session/end') {
        const body = await readJson(req), session = requireSession(body.sessionId, true);
        purgeSession(session.id);
        return json(res, 200, { ended: true, note: 'Local session, answers and generated audio cleared. Previously submitted Gemini interactions follow Google retention settings.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/tutor') {
        const body = await readJson(req), session = requireSession(body.sessionId);
        const node = nodeFor(body.nodeId);
        if (!node) throw new HttpError(400, 'Unknown lesson checkpoint.');
        if (!['answer', 'question', 'hint', 'explain', 'start'].includes(body.action)) throw new HttpError(400, 'Unknown tutor action.');
        const answer = boundedText(body.answer, 3000, 'Answer', body.action === 'answer' || body.action === 'question');
        const helpTopic = boundedText(body.helpTopic, 100, 'Help topic');
        // Only original checkpoint answers are locally graded. A diagnostic reply has a different question.
        const assessment = body.action === 'answer' ? grade(node.id, answer) : null;
        rateLimit(session);
        if ([...jobs.values()].some(j => j.sessionId === session.id && j.type === 'tutor' && !TERMINAL.has(j.status))) throw new HttpError(409, 'Wait for your current tutor response before sending another answer.');
        const job = newJob(session, 'tutor', MODEL);
        const finalize = async interaction => {
          const result = validateTutorResult(JSON.parse(fullText(interaction)));
          if (assessment && assessment.understanding !== 'uncertain') {
            result.understanding = assessment.understanding;
            result.misconception = assessment.misconception;
            if (assessment.understanding === 'incorrect') {
              result.nextAction = 'reteach'; result.feedback = 'Let’s revisit this step before moving on.';
              result.explanation = assessment.explanation;
              result.followUpQuestion = result.followUpQuestion || 'Which part of this step feels unclear?';
            }
          }
          if (result.understanding !== 'correct' && result.nextAction === 'continue') result.nextAction = 'diagnose';
          result.provider = 'gemini';
          session.history.push({ nodeId: node.id, action: body.action, helpTopic, learner: answer, tutor: result });
          session.history = session.history.slice(-8);
          return result;
        };
        if (session.mode === 'demo') {
          job.result = demoReply(node, body.action, assessment); job.status = 'completed';
        } else {
          job.request = tutorRequest({ lesson, node, answer, action: body.action, helpTopic, history: session.history, assessment });
          job.finalize = finalize;
          void runInteraction(job, job.request, finalize);
        }
        return json(res, 202, publicJob(job));
      }
      if (req.method === 'POST' && (url.pathname === '/api/speech' || url.pathname === '/api/transcribe')) {
        const transcribe = url.pathname.endsWith('transcribe');
        const body = await readJson(req, transcribe ? 4_300_000 : 16_384), session = requireSession(body.sessionId);
        if (session.mode === 'demo') throw new HttpError(503, 'Gemini audio is unavailable in local demo mode.');
        let request;
        if (transcribe) {
          const data = body.data ?? body.audio;
          const mimeType = body.mimeType ?? body.mime_type;
          if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0 || Buffer.byteLength(data, 'base64') > 3 * 1024 * 1024) throw new HttpError(400, 'Provide a base64 audio recording of at most 3 MiB.');
          if (!['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/m4a', 'audio/mpeg'].includes(mimeType)) throw new HttpError(400, 'Unsupported recording format.');
          request = transcribeRequest(data, mimeType);
        } else request = speechRequest(boundedText(body.text, 2200, 'Speech text', true));
        rateLimit(session);
        const job = newJob(session, transcribe ? 'transcribe' : 'speech', transcribe ? TRANSCRIBE_MODEL : TTS_MODEL);
        job.request = request;
        job.finalize = async interaction => transcribe ? { text: fullText(interaction).slice(0, 6000), provider: 'gemini' }
          : { audioUrl: cacheAudio(session, extractAudio(interaction)), provider: 'gemini', mimeType: 'audio/wav' };
        void runInteraction(job, request, job.finalize);
        return json(res, 202, publicJob(job));
      }
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/resume)?$/);
      if (jobMatch) {
        const body = req.method === 'POST' ? await readJson(req) : {};
        const session = requireSession(body.sessionId ?? url.searchParams.get('sessionId'), true);
        const job = jobs.get(jobMatch[1]);
        if (!job || job.sessionId !== session.id) throw new HttpError(404, 'Job not found in this session.');
        if (req.method === 'POST' && jobMatch[2]) {
          if (job.running) throw new HttpError(409, 'This job is still finishing its current poll. Wait for resumable status before resuming.');
          if (!job.resumable || !job.interactionId || !job.finalize) throw new HttpError(409, 'This job cannot be resumed.');
          rateLimit(session, job.id); void runInteraction(job, job.request, job.finalize, true);
          return json(res, 202, publicJob(job));
        }
        if (req.method === 'GET' && !jobMatch[2]) return json(res, 200, publicJob(job));
      }
      const audioMatch = url.pathname.match(/^\/api\/audio\/([a-f0-9-]{36})$/);
      if (req.method === 'GET' && audioMatch) {
        const session = requireSession(url.searchParams.get('sessionId'), true), audio = audios.get(audioMatch[1]);
        if (!audio || audio.sessionId !== session.id) throw new HttpError(404, 'Audio expired or not found.');
        res.writeHead(200, { 'Content-Type': audio.mimeType, 'Content-Length': audio.buffer.length, 'Cache-Control': 'no-store' });
        return res.end(audio.buffer);
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Unknown API endpoint.');
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
      if (url.pathname === '/media/source.mp4') return await streamFile(req, res, sourceVideo, 'video/mp4');
      // Local official Three.js modules only. Never expose an arbitrary node_modules path.
      const vendorFiles = {
        '/vendor/three/build/three.module.js': 'three.module.js',
        '/vendor/three/build/three.core.js': 'three.core.js',
      };
      if (url.pathname in vendorFiles) return await streamFile(req, res, path.join(ROOT, 'node_modules/three/build', vendorFiles[url.pathname]), 'text/javascript; charset=utf-8');
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Invalid path.'); }
      if (decoded.includes('\0') || decoded.includes('\\')) throw new HttpError(400, 'Invalid path.');
      const candidate = path.resolve(publicDir, decoded === '/' ? 'index.html' : `.${decoded}`);
      let actual, base;
      try { [actual, base] = await Promise.all([realpath(candidate), realpath(publicDir)]); } catch { throw new HttpError(404, 'File not found.'); }
      if (!actual.startsWith(`${base}${path.sep}`)) throw new HttpError(403, 'File is outside the public directory.');
      return await streamFile(req, res, actual, CONTENT_TYPES[path.extname(actual)] ?? 'application/octet-stream');
    } catch (error) {
      if (res.headersSent) return res.destroy();
      json(res, error instanceof HttpError || error instanceof QuestError ? error.status : 500, { error: error instanceof HttpError || error instanceof QuestError ? error.message : 'The local server could not complete this request.' });
    }
  });
  const liveRelay = attachLiveRelay(server, { client, lesson, ...(options.liveOptions ?? {}), authorizeBlitzStart: ({ questSessionId, questionId, questId, tutorId }) => {
    const session = requireBlitzSession(questSessionId);
    if (session.questId !== questId || session.tutorId !== tutorId) throw new HttpError(400, 'The live tutor must match the active quest and selected tutor.');
    hintQuest(session, questionId);
    session.coachingActive++;
    let released = false;
    return () => { if (!released) { released = true; session.coachingActive = Math.max(0, session.coachingActive - 1); } };
  } });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  server.on('close', () => {
    closing = true; clearInterval(sweeper); liveRelay.close();
    for (const session of sessions.values()) session.history.length = 0;
    for (const job of jobs.values()) { delete job.result; delete job.request; delete job.finalize; }
    sessions.clear(); blitzSessions.clear(); jobs.clear(); audios.clear(); audioBytes = 0;
  });
  return { server, configured, jobs, sessions, blitzSessions, liveRelay, listen: (port = 8791) => new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server.address()))),
    close: () => new Promise(resolve => { closing = true; liveRelay.close(); server.close(resolve); server.closeIdleConnections(); }) };
}

async function streamFile(req, res, file, mimeType) {
  let info;
  try { info = await stat(file); } catch { throw new HttpError(404, 'File not found.'); }
  if (!info.isFile()) throw new HttpError(404, 'File not found.');
  const total = info.size, range = req.headers.range;
  let start = 0, end = total - 1, status = 200;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
    if (!match[1]) { start = Math.max(0, total - Number(match[2])); }
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
    status = 206;
  }
  const headers = { 'Content-Type': mimeType, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file, { start, end }); stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy()); stream.pipe(res);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8791);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
  let credential;
  try { credential = loadProjectCredential(); } catch { console.error('Project credential configuration could not be loaded. Check the designated credential source.'); process.exit(1); }
  const app = createTutorServer({ credential });
  app.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Local port ${port} is already in use.` : 'The local server could not start.'); process.exitCode = 1; });
  await app.listen(port);
  console.log(`Blitz Learning: http://127.0.0.1:${port} (${app.configured ? 'Gemini configured' : 'verified local practice available; Gemini not configured'})`);
}
