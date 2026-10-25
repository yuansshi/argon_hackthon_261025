// Fictional generated portrait; GPU-blended mouth poses, not filmed video or a voice clone.
export function audioPose(rms, low = 0, mid = 0, high = 0) {
  if (!Number.isFinite(rms) || rms < 0.012) return 0;
  if (rms > 0.17) return 1;
  if (low > mid * 1.55 && low > high * 1.45) return 3;
  if (mid > low * 1.25 || high > low * 0.8) return 2;
  return rms > 0.065 ? 1 : 5;
}

export function atlasCell(frame) {
  const index = Math.max(0, Math.min(5, Math.floor(Number(frame) || 0)));
  return [index % 3, 1 - Math.floor(index / 3)];
}

const VERTEX = `attribute vec2 aPosition;
varying vec2 vUv;
void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
const FRAGMENT = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uPortrait;
uniform vec2 uCrop;
uniform float uFrom;
uniform float uTo;
uniform float uMix;
uniform float uBlink;
vec4 pose(float frame,vec2 uv){
  vec2 cell=vec2(mod(frame,3.),1.-floor(frame/3.));
  // Half-texel inset prevents adjacent atlas cells from bleeding at their borders.
  vec2 p=(cell+mix(vec2(.0015),vec2(.9985),uv))/vec2(3.,2.);
  return texture2D(uPortrait,p);
}
void main(){
  vec2 uv=(vUv-.5)*uCrop+.5;
  vec4 base=pose(0.,uv);
  vec4 mouth=mix(pose(uFrom,uv),pose(uTo,uv),smoothstep(0.,1.,uMix));
  float mouthMask=1.-smoothstep(.75,1.,length((uv-vec2(.5,.415))/vec2(.18,.13)));
  vec4 color=mix(base,mouth,mouthMask);
  float eyeMask=1.-smoothstep(.75,1.,length((uv-vec2(.5,.615))/vec2(.265,.085)));
  color=mix(color,pose(4.,uv),eyeMask*uBlink);
  gl_FragColor=vec4(color.rgb,1.);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    throw new Error('The presenter shader could not start.');
  }
  return shader;
}

export class PhotoAvatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.analyser = null;
    this.playing = false;
    this.disposed = false;
    this.loaded = false;
    this.from = this.to = 0;
    this.changeAt = 0;
    this.nextBlink = performance.now() + 4100;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Alex, a fictional AI tutor with a generated photographic face');
    this.gl = canvas.getContext('webgl', { alpha: false, antialias: true, depth: false });
    if (!this.gl) {
      this.fallback = canvas.getContext('2d');
      canvas.dataset.renderer = 'static-fallback';
    } else {
      const gl = this.gl;
      this.vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      this.fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      this.program = gl.createProgram();
      gl.attachShader(this.program, this.vertex);
      gl.attachShader(this.program, this.fragment);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Presenter rendering is unavailable.');
      gl.useProgram(this.program);
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const attribute = gl.getAttribLocation(this.program, 'aPosition');
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
      this.uniforms = Object.fromEntries(['uPortrait','uCrop','uFrom','uTo','uMix','uBlink'].map(name => [name, gl.getUniformLocation(this.program, name)]));
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      canvas.dataset.renderer = 'webgl';
    }
    this.onLoss = event => { event.preventDefault(); this.loaded = false; canvas.dataset.renderer = 'context-lost'; };
    canvas.addEventListener('webglcontextlost', this.onLoss);
    this.image = new Image();
    this.image.onload = () => {
      if (this.disposed) return;
      if (this.gl) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
      }
      this.loaded = true;
    };
    this.image.onerror = () => { canvas.dataset.renderer = 'asset-unavailable'; };
    this.image.src = '/assets/alex-photo-atlas.png';
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.frame = requestAnimationFrame(now => this.draw(now));
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
  }
  setAudio(analyser, playing = true) {
    this.analyser = analyser || null;
    this.playing = !!playing;
    if (analyser && this.time?.length !== analyser.fftSize) {
      this.time = new Float32Array(analyser.fftSize);
      this.spectrum = new Uint8Array(analyser.frequencyBinCount);
    }
  }
  setSpeaking(rms = 0, bands = []) {
    this.manual = { rms, bands, until: performance.now() + 120 };
  }
  stop() { this.playing = false; this.manual = null; this.from = this.to = 0; }
  draw(now) {
    if (this.disposed) return;
    if (!document.hidden && this.loaded) {
      let rms = 0, low = 0, mid = 0, high = 0;
      if (this.analyser && this.playing && this.time) {
        this.analyser.getFloatTimeDomainData(this.time);
        this.analyser.getByteFrequencyData(this.spectrum);
        rms = Math.sqrt(this.time.reduce((sum, v) => sum + v * v, 0) / this.time.length);
        const band = (a,b) => {
          let sum = 0, count = 0;
          for (let i=a; i<Math.min(b,this.spectrum.length); i++) { sum += this.spectrum[i]; count++; }
          return sum / Math.max(count,1);
        };
        low=band(3,20); mid=band(20,75); high=band(75,180);
      } else if (this.manual?.until > now) {
        rms = this.manual.rms; [low=0,mid=0,high=0] = this.manual.bands;
      }
      const pose = audioPose(rms,low,mid,high);
      if (pose !== this.to && now-this.changeAt > 85) {
        this.from=this.to; this.to=pose; this.changeAt=now;
      }
      let blink = 0;
      if (!this.motion.matches && rms < .012 && now > this.nextBlink) {
        const elapsed=now-this.nextBlink;
        blink=Math.sin(Math.min(1,elapsed/170)*Math.PI);
        if (elapsed>170) this.nextBlink=now+3600+Math.random()*2400;
      }
      if (this.gl) {
        const gl=this.gl, u=this.uniforms, aspect=this.canvas.width/this.canvas.height;
        gl.viewport(0,0,this.canvas.width,this.canvas.height);
        gl.useProgram(this.program);
        gl.uniform1i(u.uPortrait,0);
        gl.uniform2f(u.uCrop,Math.min(1,aspect),Math.min(1,1/aspect));
        gl.uniform1f(u.uFrom,this.from); gl.uniform1f(u.uTo,this.to);
        gl.uniform1f(u.uMix,Math.min(1,(now-this.changeAt)/80)); gl.uniform1f(u.uBlink,blink);
        gl.drawArrays(gl.TRIANGLES,0,6);
      } else if (this.fallback) {
        const w=this.image.naturalWidth/3,h=this.image.naturalHeight/2;
        this.fallback.drawImage(this.image,0,0,w,h,0,0,this.canvas.width,this.canvas.height);
      }
    }
    this.frame=requestAnimationFrame(time=>this.draw(time));
  }
  dispose() {
    this.disposed=true; cancelAnimationFrame(this.frame); this.observer?.disconnect();
    this.canvas.removeEventListener('webglcontextlost',this.onLoss); this.stop();
    if(this.gl){const g=this.gl;g.deleteTexture(this.texture);g.deleteBuffer(this.buffer);g.deleteProgram(this.program);g.deleteShader(this.vertex);g.deleteShader(this.fragment);}
  }
}
