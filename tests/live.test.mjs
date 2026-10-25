import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createTutorServer } from '../server.mjs';
import { LIVE_MODEL, initialScene, validateScene, liveConfig } from '../live.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function providerMock({ setup = true, error, resumeBeforeResolve = false } = {}) {
  const calls = [], inputs = [], tools = [];
  let closes = 0;
  const client = { live: { connect: async request => {
    calls.push(request);
    if (error) throw error;
    if (setup) request.callbacks.onmessage({ setupComplete: {} });
    if (resumeBeforeResolve) request.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'EARLY_INITIAL_HANDLE' } });
    return { sendClientContent(value) { inputs.push({ client: value }); },
      sendRealtimeInput(value) { inputs.push({ realtime: value }); },
      sendToolResponse(value) { tools.push(value); }, close() { closes++; } };
  } } };
  return { client, calls, inputs, tools, get closes() { return closes; } };
}
async function setup(t, options = {}) {
  const mock = providerMock(options.provider);
  const app = createTutorServer({ client: mock.client, runtimeDir: false, liveOptions: options.liveOptions });
  const address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());
  async function connect(headers = { Origin: base }) {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/live`, { headers });
    const messages = [];
    socket.on('message', raw => messages.push(JSON.parse(raw)));
    socket.on('error', () => {});
    await once(socket, 'open');
    t.after(() => socket.terminate());
    async function wait(type) {
      for (let i = 0; i < 200; i++) {
        const index = messages.findIndex(message => message.type === type);
        if (index !== -1) return messages.splice(index, 1)[0];
        await sleep(2);
      }
      throw new Error(`No ${type} message`);
    }
    const send = value => socket.send(JSON.stringify(value));
    async function start(extra = {}) {
      send({ type: 'start', adultConfirmed: true, cloudConsent: true, ...extra }); return wait('ready');
    }
    return { socket, messages, send, wait, start };
  }
  return { app, mock, base, connect };
}

test('Live configuration preserves source facts, adult scope and no appearance inference', () => {
  const config = liveConfig();
  assert.equal(config.responseModalities[0], 'AUDIO');
  assert.ok(config.inputAudioTranscription); assert.ok(config.outputAudioTranscription);
  assert.equal(config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Charon');
  assert.equal(config.enableAffectiveDialog, undefined);
  assert.equal(config.realtimeInputConfig.turnCoverage, 'TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO');
  assert.ok(config.contextWindowCompression.slidingWindow);
  assert.match(config.systemInstruction.parts[0].text, /60-metre/);
  assert.match(config.systemInstruction.parts[0].text, /36-metre/);
  assert.match(config.systemInstruction.parts[0].text, /NEVER identify a person/);
  assert.match(config.systemInstruction.parts[0].text, /correct number alone does not prove/);
  assert.deepEqual(liveConfig(undefined, 'opaque-handle').sessionResumption, { handle: 'opaque-handle' });
  assert.equal(config.tools[0].functionDeclarations[0].name, 'set_lesson_scene');
});

test('scene tool validates exact bounded mathematical presentation only', () => {
  assert.deepEqual(validateScene({ nodeId: 'closure', focusGap: 9, visibleGaps: 10, visibleShrubs: 0, reveal: true }),
    { nodeId: 'closure', focusGap: 9, visibleGaps: 10, visibleShrubs: 0, reveal: true });
  assert.deepEqual(validateScene({ nodeId: 'transfer' }, { nodeId: 'closure', focusGap: 9, visibleGaps: 10, visibleShrubs: 20, reveal: true }),
    { nodeId: 'transfer', focusGap: null, visibleGaps: 0, visibleShrubs: 0, reveal: false });
  for (const invalid of [null, [], { nodeId: 'arbitrary' }, { nodeId: 'closure', html: 'bad' },
    { nodeId: 'closure', focusGap: 10 }, { nodeId: 'gaps', visibleGaps: 11 }, { nodeId: 'gaps', visibleGaps: 1.5 },
    { nodeId: 'transfer', visibleShrubs: 13 }, { nodeId: 'transfer', focusGap: 6 }, { nodeId: 'pairs', reveal: 'yes' }]) {
    assert.throws(() => validateScene(invalid));
  }
});

test('WebSocket requires same-origin loopback host and rejects cross-site upgrades', async t => {
  const { base } = await setup(t), wsUrl = base.replace('http:', 'ws:');
  for (const headers of [{}, { Origin: 'https://evil.invalid' }, { Origin: base, Host: 'evil.invalid' }, { Origin: base, 'Sec-Fetch-Site': 'cross-site' }]) {
    const socket = new WebSocket(`${wsUrl}/api/live`, { headers });
    const status = await new Promise(resolve => {
      socket.on('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); });
      socket.on('error', () => {});
    });
    assert.equal(status, 403); socket.terminate();
  }
});

test('adult/cloud consent is mandatory before any live provider request', async t => {
  const { connect, mock } = await setup(t);
  for (const body of [{ adultConfirmed: false, cloudConsent: true }, { adultConfirmed: true }, { adultConfirmed: 'true', cloudConsent: true }]) {
    const browser = await connect(); browser.send({ type: 'start', ...body });
    assert.match((await browser.wait('error')).message, /18 or older/);
    assert.equal(mock.calls.length, 0);
  }
});

test('setup handshake, bounded text, PCM audio and end-of-stream map to Live SDK', async t => {
  const { connect, mock, base } = await setup(t), browser = await connect();
  const ready = await browser.start();
  assert.equal(ready.model, LIVE_MODEL); assert.deepEqual(ready.scene, initialScene()); assert.equal(ready.videoEnabled, false);
  assert.equal(mock.calls.length, 1); assert.equal(mock.calls[0].model, LIVE_MODEL);
  const health = await (await fetch(`${base}/api/health`)).json(); assert.equal(health.liveAvailable, true); assert.equal(health.liveModel, LIVE_MODEL);
  browser.send({ type: 'text', text: '  Why not eleven trees?  ' });
  browser.send({ type: 'audio', data: Buffer.alloc(3200).toString('base64'), mimeType: 'audio/pcm;rate=16000' });
  browser.send({ type: 'audio-end' });
  await sleep(15);
  assert.equal(mock.inputs[0].client.turns[0].parts[0].text, 'Why not eleven trees?');
  assert.equal(mock.inputs[0].client.turnComplete, true);
  assert.equal(mock.inputs[1].realtime.audio.mimeType, 'audio/pcm;rate=16000');
  assert.equal(mock.inputs[2].realtime.audioStreamEnd, true);
  browser.send({ type: 'stop' }); await browser.wait('ended'); await sleep(5);
  assert.equal(mock.closes, 1);
});

test('an initial handle issued before connect resolves does not falsely mark the initial session resumed', async t => {
  const { connect, mock } = await setup(t, { provider: { resumeBeforeResolve: true } }), browser = await connect();
  const ready = await browser.start();
  assert.equal(ready.resumed, false);
  assert.deepEqual(mock.calls[0].config.sessionResumption, {});
  mock.calls[0].callbacks.onclose({}); await browser.wait('reconnecting'); await sleep(520);
  assert.equal((await browser.wait('ready')).resumed, true);
  assert.equal(mock.calls[1].config.sessionResumption.handle, 'EARLY_INITIAL_HANDLE');
});

test('forwards only public audio/transcripts/turns, strips thoughts and private resume handles', async t => {
  const { connect, mock } = await setup(t), browser = await connect(); await browser.start();
  mock.calls[0].callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'PRIVATE_HANDLE' },
    usageMetadata: { secret: 'NOT_FOR_BROWSER' }, serverContent: {
      modelTurn: { parts: [{ thought: true, text: 'PRIVATE_REASONING' }, { inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] },
      outputTranscription: { text: 'The final gap returns to the start.', finished: true },
      inputTranscription: { text: 'Eleven?', finished: false }, turnComplete: true, interrupted: true,
    } });
  assert.equal((await browser.wait('audio')).mimeType, 'audio/pcm;rate=24000');
  assert.equal((await browser.wait('caption')).text, 'The final gap returns to the start.');
  assert.equal((await browser.wait('input-transcription')).text, 'Eleven?');
  await browser.wait('interrupted'); await browser.wait('turn-complete');
  const publicMessages = JSON.stringify(browser.messages);
  assert.ok(!publicMessages.includes('PRIVATE')); assert.ok(!publicMessages.includes('NOT_FOR_BROWSER'));
});

test('handles scene functions server-side and rejects arbitrary tool actions without executing them', async t => {
  const { connect, mock } = await setup(t), browser = await connect(); await browser.start();
  mock.calls[0].callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'scene-call', name: 'set_lesson_scene',
    args: { nodeId: 'closure', focusGap: 9, visibleGaps: 10, reveal: true } }] } });
  const { scene } = await browser.wait('scene'); assert.equal(scene.focusGap, 9);
  assert.equal(mock.tools[0].functionResponses[0].id, 'scene-call');
  assert.equal(mock.tools[0].functionResponses[0].response.fixedFacts.distinctWillows, 10);
  assert.equal(mock.tools[0].functionResponses[0].response.fixedFacts.shrubCount, 20);
  mock.calls[0].callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'no', name: 'execute_code', args: {} },
    { id: 'bad-count', name: 'set_lesson_scene', args: { nodeId: 'closure', visibleGaps: 11 } }] } });
  assert.ok(mock.tools[1].functionResponses.every(item => item.response.error));
  assert.equal(browser.messages.filter(item => item.type === 'scene').length, 0);
});

test('camera defaults off, requires explicit consent, acknowledges toggle and stops sharing on revoke', async t => {
  const { connect, mock } = await setup(t);
  const noConsent = await connect(); await noConsent.start();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  noConsent.send({ type: 'image', data: jpeg });
  assert.match((await noConsent.wait('error')).message, /Enable camera sharing/);
  assert.equal(mock.inputs.length, 0);
  const browser = await connect(); await browser.start();
  browser.send({ type: 'video-consent', enabled: true }); assert.equal((await browser.wait('video-consent')).enabled, true);
  browser.send({ type: 'image', data: jpeg, mimeType: 'image/jpeg' }); await sleep(10);
  assert.equal(mock.inputs[0].realtime.video.mimeType, 'image/jpeg');
  browser.send({ type: 'video-consent', enabled: false }); assert.equal((await browser.wait('video-consent')).enabled, false);
  browser.send({ type: 'image', data: jpeg }); assert.match((await browser.wait('error')).message, /Enable camera sharing/);
  assert.equal(mock.inputs.length, 1);
});

test('camera frame rate and media byte/sample bounds are enforced', async t => {
  const { connect, mock } = await setup(t);
  const browser = await connect(); await browser.start({ videoConsent: true });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  browser.send({ type: 'image', data: jpeg }); browser.send({ type: 'image', data: jpeg });
  assert.match((await browser.wait('error')).message, /one camera frame/);
  assert.equal(mock.inputs.length, 1);
  const audio = await connect(); await audio.start(); audio.send({ type: 'audio', data: Buffer.from([1]).toString('base64') });
  assert.match((await audio.wait('error')).message, /complete 16-bit/);
  const oversized = await connect(); await oversized.start(); oversized.send({ type: 'audio', data: Buffer.alloc(32770).toString('base64') });
  assert.match((await oversized.wait('error')).message, /Invalid audio/);
});

test('typed questions include only a fresh consented camera frame in the same ordered turn', async t => {
  const { connect, mock } = await setup(t), browser = await connect(); await browser.start();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  browser.send({ type: 'text', text: 'Before camera sharing.' }); await sleep(5);
  assert.deepEqual(mock.inputs[0].client.turns[0].parts, [{ text: 'Before camera sharing.' }]);
  browser.send({ type: 'video-consent', enabled: true }); await browser.wait('video-consent');
  browser.send({ type: 'image', data: jpeg }); browser.send({ type: 'text', text: 'Read this calculation.' }); await sleep(5);
  assert.deepEqual(mock.inputs[2].client.turns[0].parts, [
    { inlineData: { data: jpeg, mimeType: 'image/jpeg' } }, { text: 'Read this calculation.' },
  ]);
  browser.send({ type: 'video-consent', enabled: false }); await browser.wait('video-consent');
  browser.send({ type: 'text', text: 'Camera is now off.' }); await sleep(5);
  assert.deepEqual(mock.inputs[3].client.turns[0].parts, [{ text: 'Camera is now off.' }]);
  browser.send({ type: 'video-consent', enabled: true }); await browser.wait('video-consent');
  browser.send({ type: 'text', text: 'No new frame yet.' }); await sleep(5);
  assert.deepEqual(mock.inputs[4].client.turns[0].parts, [{ text: 'No new frame yet.' }]);
});

test('stale camera frames are not attached to typed questions', async t => {
  const { connect, mock } = await setup(t, { liveOptions: { frameFreshMs: 10 } }), browser = await connect();
  await browser.start({ videoConsent: true });
  browser.send({ type: 'image', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }); await sleep(20);
  browser.send({ type: 'text', text: 'A later question.' }); await sleep(5);
  assert.deepEqual(mock.inputs[1].client.turns[0].parts, [{ text: 'A later question.' }]);
});

test('provider failures never expose raw errors or credentials', async t => {
  const { connect } = await setup(t, { provider: { error: new Error('Invalid KEY_SECRET sdk request payload') } });
  const browser = await connect(); browser.send({ type: 'start', adultConfirmed: true, cloudConsent: true });
  const error = await browser.wait('error'); assert.ok(!error.message.includes('KEY_SECRET')); assert.match(error.message, /could not be completed/);
});

test('start timeout and session duration cap close the provider and clear active relay state', async t => {
  const { connect, app, mock } = await setup(t, { liveOptions: { limitMs: 30 } });
  const browser = await connect(); await browser.start();
  assert.match((await browser.wait('ended')).message, /15-minute/);
  assert.equal(mock.closes, 1); assert.equal(app.liveRelay.sockets.size, 0);
});

test('a provider without setup completion times out and releases its session', async t => {
  const { connect, app, mock } = await setup(t, { provider: { setup: false }, liveOptions: { startTimeoutMs: 25 } });
  const browser = await connect(); browser.send({ type: 'start', adultConfirmed: true, cloudConsent: true });
  assert.match((await browser.wait('error')).message, /did not start in time/);
  assert.equal(mock.closes, 1); assert.equal(app.liveRelay.sockets.size, 0);
});

test('provider connection refresh resumes the same session without exposing the handle', async t => {
  const { connect, mock } = await setup(t), browser = await connect(); await browser.start();
  mock.calls[0].callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'PRIVATE_RESUMPTION' } });
  mock.calls[0].callbacks.onclose({}); await browser.wait('reconnecting');
  await browser.wait('notice');
  await sleep(520);
  assert.equal((await browser.wait('ready')).resumed, true);
  assert.equal(mock.calls[1].config.sessionResumption.handle, 'PRIVATE_RESUMPTION');
  assert.ok(!JSON.stringify(browser.messages).includes('PRIVATE_RESUMPTION'));
});

test('reconnection clears a previously consented frame before the next typed question', async t => {
  const { connect, mock } = await setup(t), browser = await connect(); await browser.start({ videoConsent: true });
  browser.send({ type: 'image', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }); await sleep(5);
  mock.calls[0].callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'PRIVATE_RESUMPTION' } });
  mock.calls[0].callbacks.onclose({}); await browser.wait('reconnecting'); await sleep(520); await browser.wait('ready');
  browser.send({ type: 'text', text: 'Question after reconnecting.' }); await sleep(5);
  assert.deepEqual(mock.inputs[1].client.turns[0].parts, [{ text: 'Question after reconnecting.' }]);
});

test('closing the local server also closes active provider sessions immediately', async t => {
  const { connect, app, mock } = await setup(t), browser = await connect(); await browser.start();
  await app.close(); assert.equal(mock.closes, 1); assert.equal(app.liveRelay.sockets.size, 0);
});

test('serves only allowlisted local Three modules without exposing arbitrary dependencies', async t => {
  const { base } = await setup(t);
  for (const name of ['three.module.js', 'three.core.js']) {
    const response = await fetch(`${base}/vendor/three/build/${name}`);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/); assert.ok(Number(response.headers.get('content-length')) > 1000);
    await response.arrayBuffer();
  }
  assert.equal((await fetch(`${base}/vendor/three/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/vendor/ws/index.js`)).status, 404);
});
