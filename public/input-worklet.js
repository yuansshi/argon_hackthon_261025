class MicrophonePCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.position = 0;
    this.packet = new Int16Array(1600);
    this.packetIndex = 0;
    this.ratio = sampleRate / 16000;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    this.pending.push(...input);
    while (this.position + 1 < this.pending.length) {
      const index = Math.floor(this.position), fraction = this.position - index;
      const sample = Math.max(-1, Math.min(1, this.pending[index] * (1 - fraction) + this.pending[index + 1] * fraction));
      this.packet[this.packetIndex++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.packetIndex === this.packet.length) {
        this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
        this.packet = new Int16Array(1600); this.packetIndex = 0;
      }
      this.position += this.ratio;
    }
    const consumed = Math.min(Math.floor(this.position), this.pending.length - 1);
    this.pending.splice(0, consumed); this.position -= consumed;
    return true;
  }
}
registerProcessor('microphone-pcm', MicrophonePCM);
