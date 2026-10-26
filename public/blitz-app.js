import { Speaker, Microphone } from './audio.js';
import { TutorAvatar, tutorArtwork } from './tutor-avatar.js';
import { PondStage } from './pond-stage.js';
import { appendDelta, shortCaption, maySendMedia } from './studio-state.js';
import { PROGRESS_KEY, cleanProgress, mergeBestStars, starsMarkup, questArtwork, mathVisual } from './blitz-state.js';

const $ = id => document.getElementById(id);
// Only the Pages build adds this marker. A failed local backend never silently
// changes a Gemini lesson into a static practice session.
const STATIC_PRACTICE = document.querySelector('meta[name="blitz-deployment"]')?.content === 'static-practice';
const staticApi = STATIC_PRACTICE
  ? Promise.all([import('./practice-api.js'), import('./quest-engine.js')]).then(([{ createPracticeApi }, engine]) => createPracticeApi(engine))
  : null;
const state = { catalog: null, tutorId: 'pip', session: null, question: null, progress: null, nextQuestion: null, completed: false, busy: false, best: {}, requestEpoch: 0, jobEpoch: 0, jobId: null, jobPending: false, pendingCloudAction: null, socket: null, liveEpoch: 0, connecting: false, connected: false, liveAvailable: false, reasoningAvailable: false, cameraStream: null, cameraEpoch: 0, cameraAck: false, cameraBusy: false, micBusy: false, captureBusy: false, cameraTimer: null, lastFrame: -Infinity, caption: '', heard: '', newTurn: true, suppressed: false };
try { state.best = cleanProgress(JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}')); } catch { state.best = {}; }
const avatar = new TutorAvatar($('active-avatar'), state.tutorId);
const microphone = new Microphone();
const speaker = new Speaker({ onStateChange(playing) { avatar.setAudio(speaker.analyser, playing); if (!playing && state.connected) setLiveStatus(microphone.enabled ? 'Listening. Microphone is shared.' : 'Your turn. Type a question or share your microphone.'); } });
let pondStage = null, connectTimer, cameraAckWaiter, previewQuestId;

function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function showError(message = '', id = 'lesson-error') { $(id).textContent = message; $(id).hidden = !message; }
function tutor() { return state.catalog?.tutors.find(item => item.id === state.tutorId); }
function tutorKind(item) { return ({ alex: 'Static AI portrait', nova: 'Astral explorer', pip: 'Robot guide', sage: 'Thoughtful fox' })[item.id] || item.kind; }
async function api(path, body, options = {}) {
  if (STATIC_PRACTICE) return (await staticApi)(path, body);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), ...options, signal: controller.signal });
    let result; try { result = await response.json(); } catch { throw new Error('The local server returned an unreadable response. Retry your last action.'); }
    if (!response.ok) throw new Error(result.error || result.message || `Request failed (${response.status}).`);
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The local server took too long. Check that it is running, then try again.');
    if (error instanceof TypeError) throw new Error('The local server is unavailable. Start Blitz Learning, then retry.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function setBusy(value) { state.busy = value; $('lesson-view').setAttribute('aria-busy', String(value)); controls(); }
function controls() {
  const answered = Boolean(state.nextQuestion || state.completed);
  const locked = state.busy || state.jobPending || state.connecting || !state.session || answered;
  $('answer-input').disabled = locked;
  $('check-answer').disabled = locked;
  $('hint-button').disabled = locked;
  $('ask-button').disabled = locked || STATIC_PRACTICE;
  $('next-question').hidden = !answered;
  $('next-question').disabled = state.busy;
  $('next-question').firstChild.textContent = state.completed ? 'See your results ' : 'Next question ';
  $('connect-tutor').disabled = STATIC_PRACTICE || locked || state.connecting || !state.liveAvailable;
  $('connect-tutor').hidden = state.connected;
  $('connect-tutor').textContent = STATIC_PRACTICE ? 'Gemini voice · local app only' : state.connecting ? 'Connecting…' : state.liveAvailable ? 'Talk with Gemini' : 'Voice unavailable';
  $('connect-tutor').title = STATIC_PRACTICE ? 'This hosted demo offers practice only. Use the local Node app for Gemini.' : state.liveAvailable ? 'Start an optional Gemini Live conversation' : 'Configure project Gemini access to enable live voice. Local practice is available.';
  $('media-controls').hidden = !state.connected;
  $('mic-button').disabled = !microphone.enabled && (!state.connected || state.micBusy || locked);
  $('camera-button').disabled = !state.cameraStream && (!state.connected || state.cameraBusy || locked);
  $('mic-button').setAttribute('aria-pressed', String(microphone.enabled));
  $('mic-button').setAttribute('aria-label', microphone.enabled ? 'Stop sharing microphone' : 'Share microphone with Gemini');
  $('camera-button').setAttribute('aria-pressed', String(Boolean(state.cameraStream)));
  $('camera-button').setAttribute('aria-label', state.cameraStream ? 'Stop sharing camera' : 'Share written work with Gemini using camera');
  $('camera-preview').hidden = !state.cameraStream;
  $('live-indicator').classList.toggle('connected', state.connected);
  $('live-indicator').textContent = STATIC_PRACTICE ? 'Authored practice guide' : state.connected ? 'Gemini Live connected' : state.connecting ? 'Connecting…' : state.jobPending ? 'Gemini is thinking…' : 'Ready to help';
  $('change-tutor').disabled = state.jobPending || state.busy || state.connecting;
  document.querySelectorAll('.tutor-option').forEach(button => { button.disabled = state.jobPending || state.busy || state.connecting; });
  $('check-answer').firstChild.textContent = state.connected ? 'Send to tutor ' : 'Check answer ';
  const askText = $('ask-button').lastChild;
  if (askText?.nodeType === Node.TEXT_NODE) askText.textContent = state.resumableJob?.questionId === state.question?.id ? 'Retrieve explanation' : 'Ask tutor';
}
function setLiveStatus(message) { $('live-status').textContent = message; }
function updateProgress(progress) {
  if (!progress) return;
  state.progress = progress;
  $('lesson-stars').innerHTML = starsMarkup(progress.stars);
  $('lesson-stars').setAttribute('aria-label', `${progress.stars} of 3 best stars`);
  $('streak-label').textContent = `${progress.streak} in a row · best ${progress.bestStreak}`;
  if (state.session) {
    state.best = mergeBestStars(state.best, state.session.quest.id, progress.stars);
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.best)); } catch { /* Local storage is optional. */ }
  }
  $('total-stars').textContent = Object.values(state.best).reduce((sum, value) => sum + value, 0);
}
function feedback(title, message = '', result = 'hint') {
  const box = $('answer-feedback'); box.replaceChildren(el('strong', '', title), el('p', '', message)); box.dataset.result = result; box.hidden = false;
}
function renderTutors() {
  for (const id of ['tutor-grid', 'modal-tutor-grid']) {
    $(id).replaceChildren(...state.catalog.tutors.map(item => {
      const button = el('button', 'tutor-option'); button.type = 'button'; button.setAttribute('aria-pressed', String(item.id === state.tutorId)); button.setAttribute('aria-label', `Choose ${item.name}, ${tutorKind(item)}`);
      const picture = el('span', 'tutor-mini'); picture.innerHTML = tutorArtwork(item.id);
      const info = el('span'); info.append(el('strong', '', item.name), el('small', '', tutorKind(item)));
      const check = el('span', 'selection-check'); check.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';
      button.append(picture, info, check); button.addEventListener('click', () => selectTutor(item.id)); return button;
    }));
  }
}
function renderQuests() {
  if (!state.catalog) return;
  $('quest-grid').replaceChildren(...state.catalog.quests.map((quest, index) => {
    const button = el('button', 'quest-card'); button.type = 'button'; button.dataset.quest = quest.id;
    const number = el('span', 'quest-number', String(index + 1));
    const art = el('span', 'quest-art'); art.innerHTML = questArtwork(quest.id);
    const foot = el('span', 'quest-card-footer'), stars = el('span', 'stars'); stars.innerHTML = starsMarkup(state.best[quest.id]); stars.setAttribute('aria-label', `${state.best[quest.id] || 0} of 3 best stars`);
    foot.append(el('span', '', `${quest.problemCount} problems · ${quest.minutes} min`), stars);
    button.append(number, art, el('h3', '', quest.title), el('p', '', quest.subtitle), foot); button.addEventListener('click', () => previewQuest(quest.id)); return button;
  }));
  $('total-stars').textContent = Object.values(state.best).reduce((sum, value) => sum + value, 0);
}
async function selectTutor(id) {
  if (state.busy || state.jobPending) return;
  const epoch = state.requestEpoch; setBusy(true);
  try {
    await endLive('Tutor changed. Camera and microphone are off.');
    if (state.session) await api('/api/blitz/tutor-selection', { sessionId: state.session.sessionId, tutorId: id });
    if (epoch !== state.requestEpoch) return;
    state.tutorId = id; avatar.setTutor(id); renderTutors();
    $('active-tutor-name').textContent = tutor().name; $('active-tutor-kind').textContent = tutorKind(tutor());
    $('tutor-caption').textContent = 'Give it a try. I’m here if you need a different way to see it.';
    if ($('tutor-dialog').open) $('tutor-dialog').close();
  } catch (error) { if (epoch === state.requestEpoch) showError(error.message); }
  finally { if (epoch === state.requestEpoch) setBusy(false); }
}
function previewQuest(id) {
  const quest = state.catalog.quests.find(item => item.id === id); if (!quest) return;
  previewQuestId = id; $('preview-title').textContent = quest.title; $('preview-description').textContent = quest.description;
  $('preview-detail').textContent = `${quest.problemCount} problems. About ${quest.minutes} minutes, at your own pace.`;
  $('preview-icon').innerHTML = questArtwork(id); $('adult-consent').checked = false; $('begin-quest').disabled = true; showError('', 'preview-error'); $('quest-dialog').showModal();
}
async function beginQuest() {
  if (!$('adult-consent').checked || state.busy) return;
  $('begin-quest').disabled = true; $('begin-quest').textContent = 'Opening quest…';
  try {
    await endSession();
    const epoch = state.requestEpoch; setBusy(true);
    const session = await api('/api/blitz/session', { questId: previewQuestId, tutorId: state.tutorId, adultConfirmed: true, cloudConsent: false });
    if (epoch !== state.requestEpoch || !$('quest-dialog').open) { api('/api/blitz/session/end', { sessionId: session.sessionId }).catch(() => {}); return; }
    state.session = session; state.question = session.question; state.completed = false; state.nextQuestion = null;
    $('quest-title').textContent = session.quest.title; $('quest-category').textContent = 'Math quest · Foundation';
    $('active-tutor-name').textContent = tutor().name; $('active-tutor-kind').textContent = tutorKind(tutor()); avatar.setTutor(state.tutorId);
    $('home-view').hidden = true; $('lesson-view').hidden = false; $('quest-dialog').close(); window.scrollTo({ top: 0 });
    updateProgress(session.progress); renderQuestion(session.question); $('answer-input').focus();
  } catch (error) { showError(error.message, 'preview-error'); }
  finally { setBusy(false); $('begin-quest').textContent = 'Start quest'; $('begin-quest').disabled = !$('adult-consent').checked; }
}
function renderQuestion(question) {
  state.question = question; state.nextQuestion = null; state.completed = false; state.jobId = null; state.jobPending = false;
  $('question-number').textContent = `Question ${question.number} of ${question.total}`;
  $('question-title').textContent = question.title; $('question-prompt').textContent = question.prompt;
  $('answer-input').value = ''; $('answer-input').placeholder = question.inputPlaceholder || 'Type your answer';
  $('answer-feedback').hidden = true; showError(); $('practice-mode').textContent = question.awardEligible ? 'Local practice' : 'Coached practice · no star';
  $('question-note').textContent = 'Hints reset your streak. Best stars stay. Coached questions don’t earn stars.';
  const visual = mathVisual(question.visual); $('visual-caption').textContent = visual.description; $('math-visual').innerHTML = visual.markup;
  const usePond = question.visual.type === 'pond' && [36, 60].includes(question.visual.circumference);
  $('pond-canvas').hidden = !usePond; $('math-visual').hidden = usePond;
  if (usePond) {
    if (!pondStage) pondStage = new PondStage($('pond-canvas'), { onError: () => { $('pond-canvas').hidden = true; $('math-visual').hidden = false; } });
    pondStage.setScene({ nodeId: question.visual.circumference === 36 ? 'transfer' : question.visual.nodeId || 'gaps', visibleShrubs: question.visual.shrubsPerGap > 0 ? question.visual.shrubsPerGap : 0, reveal: false }); pondStage.setPaused(document.hidden);
    requestAnimationFrame(() => pondStage.resize());
  } else pondStage?.setPaused(true);
  controls();
}
async function checkAnswer(event) {
  event.preventDefault(); const answer = $('answer-input').value.trim();
  if (!answer || state.busy || state.jobPending || !state.question || state.nextQuestion || state.completed) return;
  if (state.connected) {
    speaker.stop(); avatar.stop(); state.suppressed = false; state.newTurn = true; state.heard = '';
    if (socketSend({ type: 'text', text: answer })) { $('heard').textContent = `You: ${shortCaption(answer,150)}`; $('heard').hidden = false; $('answer-input').value = ''; setLiveStatus('Your message was sent to Gemini Live. End the conversation to check a numeric answer.'); }
    return;
  }
  const epoch = state.requestEpoch, questionId = state.question.id; setBusy(true); showError();
  try {
    await endLive('Conversation paused while your answer is checked.');
    const result = await api('/api/blitz/answer', { sessionId: state.session.sessionId, questionId, answer });
    if (epoch !== state.requestEpoch) return;
    updateProgress(result.progress); feedback(result.feedback, result.explanation, result.understanding);
    if (result.understanding !== 'uncertain') { state.nextQuestion = result.nextQuestion; state.completed = result.completed; }
    $('question-note').textContent = result.understanding === 'uncertain' ? 'Try a number or fraction. Your current question is still open.' : 'Read the explanation, then continue when you’re ready.';
    $('tutor-caption').textContent = result.correct === true ? 'Nice work. Before the next step, can you explain why that answer makes sense?' : 'A wrong turn is useful information. Look at the diagram and find the step that changed your answer.';
  } catch (error) { if (epoch === state.requestEpoch) showError(error.message); }
  finally { if (epoch === state.requestEpoch) { setBusy(false); if (!state.nextQuestion && !state.completed) $('answer-input').focus(); else $('next-question').focus(); } }
}
async function markHinted({ show = false } = {}) {
  const epoch = state.requestEpoch, sessionId = state.session?.sessionId, questionId = state.question?.id;
  if (!sessionId || !questionId) throw new Error('Open a quest before asking for help.');
  const result = await api('/api/blitz/hint', { sessionId, questionId });
  if (epoch !== state.requestEpoch || state.session?.sessionId !== sessionId || state.question?.id !== questionId) throw new Error('That question is no longer active.');
  state.question = result.question; updateProgress(result.progress); $('practice-mode').textContent = 'Coached practice · no star';
  $('question-note').textContent = 'Coaching resets this streak, not your best stars. This question is practice; a fresh question can start a new streak.';
  if (show) feedback('One helpful step', result.hint, 'hint');
  return result;
}
async function hint() {
  if (state.busy || state.jobPending) return; setBusy(true); showError();
  try { await markHinted({ show: true }); } catch (error) { showError(error.message); } finally { setBusy(false); }
}
async function nextQuestion() {
  await endLive('New question. Microphone and camera are off.');
  state.jobEpoch++; state.jobPending = false;
  if (state.completed) { showResults(); return; }
  if (state.nextQuestion) { renderQuestion(state.nextQuestion); $('tutor-caption').textContent = 'A new situation, the same idea. What carries over?'; $('answer-input').focus(); }
}
function showResults() {
  const stars = state.progress.stars; $('complete-stars').innerHTML = starsMarkup(stars); $('complete-stars').setAttribute('aria-label', `${stars} of 3 stars earned`);
  $('complete-title').textContent = stars === 3 ? 'That’s a three-star breakthrough.' : 'Every attempt builds understanding.';
  $('complete-summary').textContent = `${state.progress.correct} of ${state.progress.answered} answers correct. Best streak: ${state.progress.bestStreak}. ${stars === 3 ? 'You solved three fresh problems in a row.' : 'Practice again or explore another quest. There’s no penalty for taking your time.'}`;
  $('complete-dialog').showModal();
}
async function endSession() {
  const sessionId = state.session?.sessionId; state.requestEpoch++; state.jobEpoch++; state.jobPending = false;
  await endLive(); state.session = null; state.question = null; state.busy = false; state.resumableJob = null;
  if (sessionId) api('/api/blitz/session/end', { sessionId }).catch(() => {});
}
async function home() {
  if ($('complete-dialog').open) $('complete-dialog').close();
  await endSession(); pondStage?.setPaused(true); $('lesson-view').hidden = true; $('home-view').hidden = false; renderQuests(); window.scrollTo({ top: 0 }); $('home-title').tabIndex = -1; $('home-title').focus();
}
function requestCloud(action) {
  if (STATIC_PRACTICE) { showError('Gemini chat, voice, and camera require the local Node app. Hints and answer checking work in this hosted demo.'); return; }
  if (!state.session || state.busy || state.jobPending || state.nextQuestion || state.completed) return;
  if (action === 'reasoning' && !state.reasoningAvailable) { showError('Gemini explanations are not configured. Set up project Gemini access and reload; local practice and hints still work.'); return; }
  state.pendingCloudAction = action; $('cloud-consent').checked = false; $('start-live').disabled = true;
  $('start-live').textContent = action === 'reasoning' ? 'Ask Gemini' : 'Start conversation';
  showError('', 'cloud-error'); $('cloud-dialog').showModal();
}
async function confirmCloud() {
  if (STATIC_PRACTICE) return;
  if (!$('cloud-consent').checked) return;
  const action = state.pendingCloudAction; $('cloud-dialog').close();
  if (action === 'reasoning') await askReasoning(); else await startLive();
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function askReasoning() {
  if (STATIC_PRACTICE) return;
  if (!state.session || state.jobPending || state.busy) return;
  const epoch = ++state.jobEpoch, sessionId = state.session.sessionId, questionId = state.question.id;
  const message = $('answer-input').value.trim() || 'Help me understand the first step without giving away the final answer. Ask me one useful check question.';
  state.jobPending = true; controls(); showError(); $('tutor-caption').textContent = 'Gemini is thinking through your question…';
  setLiveStatus('Gemini Argon is preparing a deeper explanation. You can leave this quest to cancel.');
  try {
    await endLive('Preparing a focused explanation.');
    const retained = state.resumableJob;
    let job = retained?.sessionId === sessionId && retained.questionId === questionId
      ? await api(`/api/jobs/${encodeURIComponent(retained.id)}?sessionId=${encodeURIComponent(sessionId)}`)
      : await api('/api/blitz/tutor', { sessionId, questionId, message, cloudConsent: true });
    if (epoch !== state.jobEpoch) return;
    state.jobId = job.jobId; if (job.question) state.question = job.question; updateProgress(job.progress); $('practice-mode').textContent = 'Coached practice · no star'; $('answer-input').value = '';
    $('question-note').textContent = 'Coaching resets this streak, not your best stars. This question is practice; a fresh question can start a new streak.';
    state.resumableJob = { id: job.jobId, sessionId, questionId };
    const started = Date.now();
    while (epoch === state.jobEpoch && ['queued', 'in_progress'].includes(job.status)) {
      if (Date.now() - started > 180000) {
        state.jobPending = false; $('tutor-caption').textContent = 'This explanation is still running. Click Ask tutor to retrieve the same job; your request won’t be duplicated.';
        state.resumableJob = { id: job.jobId, sessionId, questionId }; controls(); return;
      }
      await delay(1500); if (epoch !== state.jobEpoch) return;
      job = await api(`/api/jobs/${encodeURIComponent(job.jobId)}?sessionId=${encodeURIComponent(sessionId)}`);
      if (job.resumable && ['queued','in_progress'].includes(job.status)) job = await api(`/api/jobs/${encodeURIComponent(job.jobId)}/resume`, { sessionId });
    }
    if (epoch !== state.jobEpoch) return;
    if (job.status !== 'completed' || !job.result) { state.resumableJob = null; throw new Error(job.error || `Gemini stopped with ${job.status}. No AI explanation was substituted.`); }
    const result = job.result;
    if (state.session?.sessionId !== sessionId || state.question?.id !== questionId || (result.questionId && result.questionId !== questionId)) return;
    state.resumableJob = null; updateProgress(result.progress);
    $('tutor-caption').textContent = [result.feedback, result.explanation, result.checkQuestion].filter(Boolean).join('\n\n');
    setLiveStatus('Explanation by Gemini Argon. Local answer checking still decides your score.');
  } catch (error) { if (epoch === state.jobEpoch) { showError(error.message); $('tutor-caption').textContent = 'The explanation couldn’t be retrieved. Your local practice still works. No model response was invented.'; } }
  finally { if (epoch === state.jobEpoch) { state.jobPending = false; controls(); } }
}

function socketSend(message) { if (STATIC_PRACTICE || state.socket?.readyState !== WebSocket.OPEN) return false; state.socket.send(JSON.stringify(message)); return true; }
function canSendMedia() { return !STATIC_PRACTICE && maySendMedia({ connected: state.connected, providerReady: state.connected, hidden: document.hidden, socketOpen: state.socket?.readyState === WebSocket.OPEN, bufferedAmount: state.socket?.bufferedAmount }); }
async function stopCamera() {
  state.cameraEpoch++; clearInterval(state.cameraTimer); state.cameraTimer = null;
  for (const track of state.cameraStream?.getTracks() || []) track.stop();
  state.cameraStream = null; state.cameraAck = false; state.captureBusy = false; state.lastFrame = -Infinity; $('camera-video').srcObject = null;
  if (state.connected) socketSend({ type: 'video-consent', enabled: false });
  if (cameraAckWaiter) { cameraAckWaiter.reject(new Error('Camera sharing cancelled.')); cameraAckWaiter = null; }
  controls();
}
async function stopMic() { if (state.connected) socketSend({ type: 'audio-end' }); await microphone.stop(); controls(); }
async function endLive(message = 'Camera and microphone are off.') {
  state.liveEpoch++; clearTimeout(connectTimer); state.connecting = false; state.connected = false;
  socketSend({ type: 'stop' }); const socket = state.socket;
  const socketClosed = socket && socket.readyState !== WebSocket.CLOSED ? new Promise(resolve => {
    const timer = setTimeout(resolve, 700);
    socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
  }) : Promise.resolve();
  state.socket = null; socket?.close(); speaker.stop(); avatar.stop();
  await Promise.all([stopMic(), stopCamera()]); state.caption = ''; state.heard = ''; state.newTurn = true; state.suppressed = false;
  $('heard').textContent = ''; $('heard').hidden = true; setLiveStatus(message); controls(); await socketClosed;
}
async function startLive() {
  if (STATIC_PRACTICE) return;
  if (!state.session || state.connecting || state.connected || !state.liveAvailable) return;
  const epoch = ++state.liveEpoch;
  state.connecting = true; controls(); showError(); setLiveStatus('Connecting to Gemini Live…');
  try {
    await markHinted(); await speaker.init();
    if (epoch !== state.liveEpoch || !state.connecting) return;
    if (!state.session || document.hidden) { await endLive(); return; }
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`); state.socket = socket;
    connectTimer = setTimeout(() => { if (epoch === state.liveEpoch) { endLive('Connection timed out. Local practice still works.'); showError('Gemini Live did not connect. Try again, or use Ask tutor for a written explanation.'); } }, 25000);
    socket.onopen = () => { if (epoch === state.liveEpoch) socketSend({ type: 'start', adultConfirmed: true, cloudConsent: true, videoConsent: false, questSessionId: state.session.sessionId, questionId: state.question.id, questId: state.session.quest.id, tutorId: state.tutorId }); else socket.close(); };
    socket.onmessage = event => { if (epoch !== state.liveEpoch) return; try { handleLive(JSON.parse(event.data), epoch).catch(error => showError(error.message)); } catch { showError('A Gemini Live response could not be read. End and reconnect the conversation.'); } };
    socket.onerror = () => { if (epoch === state.liveEpoch) setLiveStatus('Connection failed. Check Gemini access and retry.'); };
    socket.onclose = () => { if (epoch === state.liveEpoch) endLive('Disconnected. Your local practice is still available.'); };
  } catch (error) {
    if (epoch !== state.liveEpoch) return;
    await endLive('Couldn’t connect. Local practice still works.'); showError(error.message);
  }
}
async function handleLive(message, epoch) {
  if (epoch !== state.liveEpoch) return;
  if (message.type === 'ready') {
    clearTimeout(connectTimer); state.connected = true; state.connecting = false; controls(); setLiveStatus('Connected. Microphone and camera are off until you enable them.');
    socketSend({ type: 'text', text: `Current practice question: ${state.question.prompt}\nPlease help me reason through one step, without assuming I have answered yet. Ask one short question.` }); return;
  }
  if (message.type === 'reconnecting') { await endLive('Connection interrupted. Camera and microphone released; reconnect to continue.'); return; }
  if (message.type === 'video-consent') { state.cameraAck = Boolean(message.enabled); if (state.cameraAck && cameraAckWaiter) { cameraAckWaiter.resolve(); cameraAckWaiter = null; } return; }
  if (message.type === 'error' || message.type === 'ended') { const text = message.message || 'The conversation ended. You can reconnect.'; await endLive(text); showError(text); return; }
  if (message.type === 'notice') { showError(message.message || 'Check the connection before continuing.'); return; }
  if (message.type === 'scene') return; // Authored quest visuals, not the model, own the active diagram.
  if (message.type === 'interrupted') { speaker.stop(); avatar.stop(); state.newTurn = true; state.suppressed = false; return; }
  if (message.type === 'input-transcription') { state.heard = appendDelta(state.heard, message.text); $('heard').textContent = `You: ${shortCaption(state.heard,150)}`; $('heard').hidden = false; return; }
  if (message.type === 'caption' && !state.suppressed) { if (state.newTurn) { state.caption = ''; state.newTurn = false; } state.caption = appendDelta(state.caption, message.text); $('tutor-caption').textContent = state.caption; }
  if (message.type === 'audio' && !state.suppressed && !document.hidden) { try { speaker.enqueue(message.data, Number(message.mimeType?.match(/rate=(\d+)/)?.[1] || 24000)); } catch (error) { speaker.stop(); showError(error.message); } }
  if (message.type === 'turn-complete') { state.newTurn = true; state.heard = ''; }
}
async function enableMicrophone() {
  if (STATIC_PRACTICE) return;
  if (!state.connected || state.micBusy) return;
  const epoch = state.liveEpoch; state.micBusy = true; controls(); showError();
  try {
    await speaker.init(); await microphone.start(packet => { if (canSendMedia()) socketSend({ type: 'audio', data: packet }); });
    if (epoch !== state.liveEpoch || document.hidden || !state.connected) { await microphone.stop(); return; }
    for (const track of microphone.stream?.getTracks() || []) track.addEventListener('ended', () => stopMic(), { once: true });
    setLiveStatus('Microphone shared with Gemini. Click the microphone again to stop.');
  } catch (error) { showError(error.name === 'NotAllowedError' ? 'Microphone permission was denied. You can keep typing, or allow it in browser settings.' : error.message); }
  finally { state.micBusy = false; controls(); }
}
function waitCameraConsent() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (cameraAckWaiter?.resolve === accept) { cameraAckWaiter = null; reject(new Error('Camera sharing was not acknowledged. Try again.')); } }, 5000);
    function accept() { clearTimeout(timer); resolve(); }
    function decline(error) { clearTimeout(timer); reject(error); }
    cameraAckWaiter = { resolve: accept, reject: decline }; if (!socketSend({ type: 'video-consent', enabled: true })) decline(new Error('The conversation is not ready.'));
  });
}
async function enableCamera() {
  if (STATIC_PRACTICE) return;
  if (!state.connected || state.cameraBusy) return;
  if (!navigator.mediaDevices?.getUserMedia) { showError('Camera is unavailable in this browser. Type or speak instead.'); return; }
  const epoch = ++state.cameraEpoch, liveEpoch = state.liveEpoch; state.cameraBusy = true; controls(); showError();
  try {
    await waitCameraConsent(); if (epoch !== state.cameraEpoch || liveEpoch !== state.liveEpoch) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' } });
    if (epoch !== state.cameraEpoch || liveEpoch !== state.liveEpoch || document.hidden || !state.connected) { stream.getTracks().forEach(track => track.stop()); return; }
    state.cameraStream = stream; $('camera-video').srcObject = stream; await $('camera-video').play();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Camera images cannot be prepared in this browser.');
    const capture = async () => {
      const video = $('camera-video'); if (state.captureBusy || epoch !== state.cameraEpoch || !state.cameraAck || !canSendMedia() || video.readyState < 2) return;
      state.captureBusy = true;
      try {
        const scale = Math.min(1,640/(video.videoWidth || 640),480/(video.videoHeight || 480)); canvas.width = Math.round((video.videoWidth || 640)*scale); canvas.height = Math.round((video.videoHeight || 480)*scale); context.drawImage(video,0,0,canvas.width,canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.65)); if (!blob || blob.size > 256*1024 || epoch !== state.cameraEpoch || !canSendMedia()) return;
        const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const at = performance.now(); if (epoch === state.cameraEpoch && state.cameraAck && canSendMedia() && at-state.lastFrame >= 1100 && socketSend({ type:'image',data:btoa(binary) })) state.lastFrame = at;
      } catch { showError('A camera image couldn’t be shared. Turn the camera off and retry.'); }
      finally { if (epoch === state.cameraEpoch) state.captureBusy = false; }
    };
    state.cameraTimer = setInterval(capture,1100); stream.getTracks().forEach(track => track.addEventListener('ended', () => stopCamera(), { once:true }));
    setLiveStatus('Camera shared with Gemini. Point it at your written work. No attention or emotion inference.'); controls();
  } catch (error) { if (epoch === state.cameraEpoch) { await stopCamera(); showError(error.name === 'NotAllowedError' ? 'Camera permission was denied. You can keep typing or speaking.' : error.message); } }
  finally { state.cameraBusy = false; controls(); }
}
async function loadCatalog() {
  $('catalog-status').hidden = false; $('catalog-status').textContent = 'Loading your quests…'; $('retry-catalog').hidden = true;
  try {
    state.catalog = await api('/api/blitz/catalog'); if (!Array.isArray(state.catalog.quests) || !Array.isArray(state.catalog.tutors)) throw new Error('The quest catalogue is incomplete. Retry loading it.');
    renderQuests(); renderTutors(); $('catalog-status').hidden = true;
    const health = await api('/api/health'); state.liveAvailable = !STATIC_PRACTICE && Boolean(health.liveAvailable); state.reasoningAvailable = !STATIC_PRACTICE && Boolean(health.configured);
    setLiveStatus(STATIC_PRACTICE ? 'Gemini chat, voice, and camera are unavailable in this hosted demo. Practice and authored hints work here.' : state.liveAvailable ? 'Optional voice and camera. Both start off.' : 'Live voice is not configured. Local practice still works; Ask tutor needs project Gemini access.'); controls();
  } catch (error) { $('catalog-status').textContent = error.message; $('retry-catalog').hidden = false; }
}

$('brand-home').addEventListener('click', home);
$('back-home').addEventListener('click', home);
$('nav-quests').addEventListener('click', async () => { if (!$('lesson-view').hidden) await home(); $('quest-section').scrollIntoView({ behavior: 'smooth' }); });
$('nav-tutors').addEventListener('click', async () => { if (!$('lesson-view').hidden) { await endLive('Tutor selection opened. Camera and microphone are off.'); $('tutor-dialog').showModal(); } else $('tutor-section').scrollIntoView({ behavior: 'smooth' }); });
$('hero-start').addEventListener('click', () => $('quest-section').scrollIntoView({ behavior: 'smooth' }));
$('math-subject').addEventListener('click', () => $('quest-section').scrollIntoView({ behavior: 'smooth' }));
$('retry-catalog').addEventListener('click', loadCatalog);
$('adult-consent').addEventListener('change', () => { $('begin-quest').disabled = !$('adult-consent').checked; });
$('begin-quest').addEventListener('click', beginQuest);
$('answer-form').addEventListener('submit', checkAnswer);
$('hint-button').addEventListener('click', hint);
$('ask-button').addEventListener('click', () => requestCloud('reasoning'));
$('connect-tutor').addEventListener('click', () => requestCloud('live'));
$('cloud-consent').addEventListener('change', () => { $('start-live').disabled = !$('cloud-consent').checked; });
$('start-live').addEventListener('click', confirmCloud);
$('next-question').addEventListener('click', nextQuestion);
$('change-tutor').addEventListener('click', async () => { await endLive('Tutor selection opened. Camera and microphone are off.'); $('tutor-dialog').showModal(); });
$('complete-home').addEventListener('click', home);
$('replay-quest').addEventListener('click', async () => { const id=state.session.quest.id; $('complete-dialog').close(); await home(); previewQuest(id); });
$('mic-button').addEventListener('click', () => microphone.enabled ? stopMic() : enableMicrophone());
$('camera-button').addEventListener('click', () => state.cameraStream ? stopCamera() : enableCamera());
$('end-button').addEventListener('click', () => endLive('Conversation ended. Camera and microphone released.'));
$('answer-input').addEventListener('beforeinput', () => { if (speaker.playing) { speaker.stop(); avatar.stop(); socketSend({ type:'interrupt' }); } });
document.addEventListener('visibilitychange', () => { pondStage?.setPaused(document.hidden || $('lesson-view').hidden); avatar.setPaused(document.hidden); if (document.hidden && (state.connected || state.connecting || state.cameraStream || microphone.enabled)) endLive('Paused while the tab was hidden. Camera and microphone released.'); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && (state.connected || state.connecting)) endLive('Conversation stopped. Camera and microphone released.'); });
window.addEventListener('pagehide', () => { state.requestEpoch++; state.jobEpoch++; state.liveEpoch++; socketSend({ type:'stop' }); state.socket?.close(); microphone.stop(); stopCamera(); speaker.dispose(); avatar.dispose(); pondStage?.dispose(); if (state.session) api('/api/blitz/session/end', {sessionId:state.session.sessionId}, {keepalive:true}).catch(() => {}); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
$('adult-consent').checked = false; $('cloud-consent').checked = false;
if (STATIC_PRACTICE) {
  $('pages-home-notice').hidden = false; $('pages-lesson-notice').hidden = false; $('pages-ai-note').hidden = false;
  $('ask-button').setAttribute('aria-describedby', 'pages-ai-note'); $('connect-tutor').setAttribute('aria-describedby', 'pages-ai-note');
  $('answer-label').textContent = 'Your answer';
  document.querySelector('#quest-dialog .privacy-note').textContent = 'Answers are checked in your browser, not sent to an AI service. This hosted demo has no Gemini connection.';
  $('home-privacy').textContent = 'This hosted practice demo is an experimental learning tool for adults 18+. Answers stay in this browser; only aggregate best-star counts are saved on this device.';
  $('reasoning-capability').textContent = 'Local Node app only · Gemini Argon';
  $('live-capability').textContent = 'Local Node app only · Gemini Live';
  $('reasoning-description').textContent = 'In the local Node app, Gemini Argon can explain a step or explore your reasoning. This capability is not available in this hosted demo.';
  $('live-description').textContent = 'The local Node app supports spoken discussion and optional camera sharing of written work. This hosted demo does not connect to Gemini or request your microphone or camera.';
  $('tutor-caption').textContent = 'Try an answer or choose an authored hint. I’m an illustrated practice guide here, not a live AI conversation.';
}
await loadCatalog();
