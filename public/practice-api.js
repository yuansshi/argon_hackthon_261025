// GitHub Pages practice stays in this tab: no requests, credentials or media storage.
const SESSION_TTL = 2 * 60 * 60 * 1000;
const POST_ROUTES = new Set(['/api/blitz/session', '/api/blitz/answer', '/api/blitz/hint', '/api/blitz/tutor-selection', '/api/blitz/session/end']);
const CLOUD_ROUTES = new Set(['/api/blitz/tutor', '/api/live', '/api/session', '/api/tutor', '/api/speech', '/api/transcribe']);

function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function requestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || ![Object.prototype, null].includes(Object.getPrototypeOf(body))) fail(400, 'A request object is required.');
  let encoded;
  try { encoded = JSON.stringify(body); } catch { fail(400, 'Use a JSON-compatible request object.'); }
  if (new TextEncoder().encode(encoded).length > 16_384) fail(413, 'Request is too large.');
  return body;
}

/** Inject the authored quest engine; this adapter never imports a Node or cloud client. */
export function createPracticeApi(engine) {
  const sessions = new Map();
  const copy = value => structuredClone(value);
  function active(id) {
    const session = typeof id === 'string' ? sessions.get(id) : null;
    if (!session || Date.now() - session.lastSeen > SESSION_TTL) {
      sessions.delete(id); fail(401, 'This quest session expired. Start a new quest.');
    }
    const now = Date.now(); session.lastSeen = now;
    session.requests = session.requests.filter(time => now - time < 60_000);
    if (session.requests.length >= 60) fail(429, 'Please pause before submitting another quest request.');
    session.requests.push(now);
    return session;
  }
  return async function practiceApi(path, body) {
    if (typeof path !== 'string') fail(404, 'This practice route is unavailable.');
    if (path === '/api/health' || path === '/api/blitz/catalog') {
      if (body !== undefined) fail(405, 'This route is read-only.');
      if (path === '/api/health') return { configured: false, liveAvailable: false, demoAvailable: true, adultOnly: true, staticPractice: true };
      return copy({ ...engine.questCatalog(), models: { reasoning: null, live: null, tts: null, liveAvailable: false }, staticPractice: true,
        audience: 'Adults 18+', achievements: 'Three consecutive distinct, unhinted correct answers earn three stars. This public practice demo checks answers in your browser, not on a secure server.' });
    }
    if (CLOUD_ROUTES.has(path) || /^\/api\/jobs\/[^/?]+(?:\/resume)?$/.test(path)) fail(503, 'Gemini conversations, voice and camera sharing are unavailable on GitHub Pages. Local practice and authored hints still work.');
    if (!POST_ROUTES.has(path)) fail(404, 'This practice route is unavailable.');
    body = requestBody(body);
    if (path === '/api/blitz/session') {
      if (body.adultConfirmed !== true) fail(403, 'Blitz Learning is currently for adults aged 18 and over.');
      if (body.cloudConsent !== undefined && typeof body.cloudConsent !== 'boolean') fail(400, 'Cloud consent must be true or false.');
      for (const [id, session] of sessions) if (Date.now() - session.lastSeen > SESSION_TTL) sessions.delete(id);
      if (sessions.size >= 30) fail(429, 'Too many active practice sessions. End another session first.');
      const session = engine.createQuestSession({ questId: body.questId, tutorId: body.tutorId, cloudConsent: false });
      sessions.set(session.id, session);
      return copy(engine.publicQuestSession(session));
    }
    const session = active(body.sessionId);
    if (path === '/api/blitz/answer') return copy(engine.answerQuest(session, body.questionId, body.answer));
    if (path === '/api/blitz/hint') return copy(engine.hintQuest(session, body.questionId));
    if (path === '/api/blitz/tutor-selection') {
      const tutor = engine.getTutor(body.tutorId);
      if (!tutor) fail(400, 'Choose a supported tutor.');
      session.tutorId = tutor.id;
      return copy({ tutor: engine.publicTutor(tutor), progress: engine.questProgress(session) });
    }
    sessions.delete(session.id);
    return { ended: true, note: 'Practice answers and session progress cleared from this tab. Only aggregate best stars may remain on your device.' };
  };
}
