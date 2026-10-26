// Gemini Live uses little-endian mono PCM16 at 16 kHz in / 24 kHz out.
// No audio is persisted; capture starts only after an explicit microphone action.
export function decodePCM(base64) {
  if (typeof base64 !== 'string' || base64.length > 2_000_000) throw new Error('Invalid audio packet.');
  const binary = atob(base64);
  if (binary.length % 2) throw new Error('Incomplete audio packet.');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const pcm = new Float32Array(bytes.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true) / 32768;
  return pcm;
}

export function base64PCM(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export class Speaker {
  constructor({ onStateChange = () => {}, maxQueuedSeconds = 20 } = {}) {
    this.onStateChange = onStateChange;
    this.maxQueuedSeconds = maxQueuedSeconds;
    this.sources = new Set();
    this.next = 0;
  }
  async init() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ sampleRate: 24000 });
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.5;
      this.analyser.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  enqueue(base64, rate = 24000) {
    if (!this.context || this.context.state !== 'running') throw new Error('Audio is paused. Click the conversation input to enable sound.');
    if (!Number.isFinite(rate) || rate < 8000 || rate > 48000) throw new Error('Unsupported audio sample rate.');
    const pcm = decodePCM(base64);
    if (!pcm.length) return;
    const at = Math.max(this.next, this.context.currentTime + 0.025);
    if (at + pcm.length / rate - this.context.currentTime > this.maxQueuedSeconds) {
      this.stop();
      throw new Error('Speech fell behind. Ask Alex to repeat the last part.');
    }
    const buffer = this.context.createBuffer(1, pcm.length, rate);
    buffer.copyToChannel(pcm, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (!this.playing) this.onStateChange(false);
    };
    source.start(at);
    this.next = at + buffer.duration;
    this.onStateChange(true);
  }
  stop() {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch {}
      source.disconnect();
    }
    this.sources.clear();
    this.next = 0;
    this.onStateChange(false);
  }
  get playing() { return this.sources.size > 0; }
  async dispose() {
    this.stop();
    this.analyser?.disconnect();
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
}

export class Microphone {
  constructor() { this.epoch = 0; this.enabled = false; }
  async start(onPacket) {
    const epoch = ++this.epoch;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone is unavailable in this browser. You can still type.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const release = () => { for (const track of stream.getTracks()) track.stop(); };
    if (epoch !== this.epoch) { release(); return false; }
    let context;
    try {
      context = new AudioContext({ sampleRate: 16000 });
      await context.audioWorklet.addModule(new URL('./input-worklet.js', import.meta.url));
      if (epoch !== this.epoch) { release(); await context.close(); return false; }
      this.stream = stream; this.context = context;
      this.source = context.createMediaStreamSource(stream);
      this.filter = context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = Math.min(7200, context.sampleRate * 0.45);
      this.worklet = new AudioWorkletNode(context, 'microphone-pcm');
      this.silent = context.createGain(); this.silent.gain.value = 0;
      this.source.connect(this.filter).connect(this.worklet).connect(this.silent).connect(context.destination);
      this.enabled = true;
      this.worklet.port.onmessage = event => { if (this.enabled && epoch === this.epoch) onPacket(base64PCM(event.data)); };
      await context.resume();
      if (epoch !== this.epoch) { release(); if (context.state !== 'closed') await context.close(); return false; }
      return true;
    } catch (error) {
      release();
      if (context && context.state !== 'closed') await context.close();
      if (epoch === this.epoch) { this.stream = null; this.context = null; this.enabled = false; }
      throw error;
    }
  }
  async stop() {
    this.epoch++;
    this.enabled = false;
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
    this.worklet?.disconnect(); this.source?.disconnect(); this.filter?.disconnect(); this.silent?.disconnect();
    const context = this.context; this.context = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
