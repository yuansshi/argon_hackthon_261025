/** A local Three.js garden. The planting model is kept separate from its presentation. */
const TAU = Math.PI * 2;
const NODE_IDS = new Set(['situation', 'gaps', 'closure', 'pairs', 'transfer', 'solution']);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Pure, deterministic lesson geometry; one world unit represents one metre. */
export function buildPondPlan(input = {}) {
  if (typeof input === 'string') input = { nodeId: input };
  const nodeId = NODE_IDS.has(input.nodeId) ? input.nodeId : 'situation';
  const count = nodeId === 'transfer' ? 6 : 10;
  const circumference = nodeId === 'transfer' ? 36 : 60;
  const radius = circumference / TAU;
  const reveal = input.reveal === true;
  const focusSource = input.focusGap ?? input.focus;
  const focusGap = focusSource == null ? (nodeId === 'closure' ? count - 1 : 0) : clamp(Math.floor(finite(focusSource, 0)), 0, count - 1);
  const gapDefault = reveal ? count : (nodeId === 'closure' ? count - 1 : nodeId === 'situation' ? 0 : 1);
  const visibleGaps = clamp(Math.floor(finite(input.visibleGaps ?? input.tracedGaps, gapDefault)), 0, count);
  const shrubDefault = reveal ? count * 2 : ['pairs', 'solution'].includes(nodeId) ? 2 : 0;
  const visibleShrubs = clamp(Math.floor(finite(input.visibleShrubs ?? (input.shrubPairs == null ? undefined : input.shrubPairs * 2), shrubDefault)), 0, count * 2);
  const angleAt = fraction => -Math.PI / 2 + fraction * TAU;
  const positionAt = fraction => ({ x: Math.cos(angleAt(fraction)) * radius, y: 0, z: Math.sin(angleAt(fraction)) * radius });
  const trees = Array.from({ length: count }, (_, index) => ({ index, ...positionAt(index / count) }));
  const gaps = trees.map((tree, index) => ({ index, start: index, end: (index + 1) % count, startAngle: angleAt(index / count), endAngle: angleAt((index + 1) / count), length: 6 }));
  const shrubs = gaps.flatMap(gap => [1, 2].map((inside, item) => ({ index: gap.index * 2 + item, gapIndex: gap.index, fraction: inside / 3, ...positionAt((gap.index + inside / 3) / count) })));
  return { nodeId, count, circumference, radius, reveal, focusGap, visibleGaps, visibleShrubs, trees, gaps, shrubs };
}

/** Do not announce an unearned numerical answer through an accessible description. */
export function describePondPlan(plan) {
  const known = `${plan.circumference}-metre circular bank. Neighbouring willows are 6 metres apart along the curve. Two shrubs belong inside each gap.`;
  if (!plan.reveal) return `${known} The highlighted curved section connects neighbouring willows. The last section returns to the starting willow. Totals are not revealed yet.`;
  return `${known} ${plan.count} equal gaps and ${plan.count} distinct willows form the closed loop. ${plan.count * 2} shrubs fill the gaps, two in each. The closing gap ends at the original starting willow, not an extra tree.`;
}

function seeded(seed = 9137) {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}

/**
 * Rendering is asynchronous so a missing local dependency can fall back without
 * preventing the rest of the lesson from starting. No remote asset requests.
 */
export class PondStage {
  constructor(containerOrCanvas, options = {}) {
    if (!containerOrCanvas) throw new TypeError('PondStage requires a canvas or container.');
    this.options = options;
    this.canvas = containerOrCanvas.tagName?.toLowerCase() === 'canvas' ? containerOrCanvas : document.createElement('canvas');
    this.container = this.canvas === containerOrCanvas ? this.canvas.parentElement : containerOrCanvas;
    this.ownsCanvas = this.canvas !== containerOrCanvas;
    if (this.ownsCanvas) this.container.append(this.canvas);
    this.canvas.classList.add('pond-webgl-canvas');
    this.canvas.style.cssText += ';display:block;width:100%;height:100%;';
    this.canvas.setAttribute('role', 'img');
    this.plan = buildPondPlan();
    this.summary = document.createElement('p');
    this.summary.className = 'pond-accessible-summary';
    this.summary.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0';
    this.container.append(this.summary);
    this.fallback = document.createElement('p');
    this.fallback.className = 'pond-render-fallback';
    this.fallback.hidden = true;
    this.fallback.style.cssText = 'position:absolute;inset:35% 35% auto 6%;max-width:34rem;color:#183c39;background:#f4f7ed;padding:1.3rem;font:16px/1.5 system-ui;border-radius:12px;z-index:2';
    this.container.append(this.fallback);
    this.disposed = false;
    this.paused = false;
    this.contextLost = false;
    this.visible = true;
    this.speaking = 0;
    this.lastFrame = 0;
    this.time = 0;
    this.sceneTime = 0;
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this._motionChange = event => { this.reducedMotion = event.matches; this._requestFrame(); };
    this.motionQuery.addEventListener?.('change', this._motionChange);
    this._visibilityChange = () => { this.lastFrame = 0; if (!document.hidden) this._requestFrame(); };
    document.addEventListener('visibilitychange', this._visibilityChange);
    this._contextLost = event => { event.preventDefault(); this.contextLost = true; cancelAnimationFrame(this.raf); this.raf = null; this._showFallback('The 3D view paused because its graphics context was lost. The spoken lesson and input still work.'); };
    this._contextRestored = () => { this.contextLost = false; this.fallback.hidden = true; this.lastFrame = 0; this._requestFrame(); };
    this.canvas.addEventListener('webglcontextlost', this._contextLost);
    this.canvas.addEventListener('webglcontextrestored', this._contextRestored);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    if ('IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver(entries => { this.visible = entries[0]?.isIntersecting !== false; if (this.visible) { this.lastFrame = 0; this._requestFrame(); } });
      this.intersectionObserver.observe(this.canvas);
    }
    this.setScene(this.plan);
    this.ready = this._initialize().catch(error => {
      if (!this.disposed) this._showFallback('This browser could not start the WebGL 2 garden. The spoken lesson and input still work.');
      if (!this.disposed) this.options.onError?.(error?.message || 'WebGL 2 unavailable');
      return false;
    });
  }

  async _initialize() {
    const THREE = await import('/vendor/three/build/three.module.js');
    if (this.disposed) return false;
    this.THREE = THREE;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dce9e4');
    this.scene.fog = new THREE.Fog('#dce9e4', 42, 105);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 150);
    this.camera.position.set(23, 24, 32);
    this.target = new THREE.Vector3(-1, 0, 0);
    this.camera.lookAt(this.target);
    this._lighting();
    this._environment();
    this._materials();
    this._landscape();
    this._createPlanting();
    this._pointerUp = event => this._select(event);
    this.canvas.addEventListener('pointerup', this._pointerUp);
    this.resize();
    this.canvas.dataset.renderer = 'webgl';
    this.canvas.dataset.webglVersion = '2';
    this.fallback.hidden = true;
    this._requestFrame();
    return true;
  }

  _lighting() {
    const T = this.THREE;
    this.scene.add(new T.HemisphereLight('#eff6fa', '#828661', 2.1));
    const sun = new T.DirectionalLight('#fff0d2', 3.2);
    sun.position.set(-18, 30, 17);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 80 });
    sun.shadow.normalBias = 0.04;
    sun.shadow.bias = -0.0002;
    sun.shadow.radius = 3;
    this.scene.add(sun);
    const fill = new T.DirectionalLight('#d0e7e9', 0.7);
    fill.position.set(12, 10, -18);
    this.scene.add(fill);
  }

  _environment() {
    const T = this.THREE;
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 384;
    const ctx = canvas.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 0, 384);
    sky.addColorStop(0, '#9dcbd9'); sky.addColorStop(0.42, '#e4efeb'); sky.addColorStop(0.52, '#f4f1d5'); sky.addColorStop(0.6, '#9aa888'); sky.addColorStop(1, '#6d7855');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 768, 384);
    const sun = ctx.createRadialGradient(160, 110, 2, 160, 110, 95);
    sun.addColorStop(0, '#fff9df'); sun.addColorStop(0.12, '#fff3d2'); sun.addColorStop(1, '#fff3d200');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, 768, 384);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.mapping = T.EquirectangularReflectionMapping;
    const pmrem = new T.PMREMGenerator(this.renderer);
    this.environmentTarget = pmrem.fromEquirectangular(texture);
    this.scene.environment = this.environmentTarget.texture;
    texture.dispose(); pmrem.dispose();
  }

  _noiseTexture(kind) {
    const T = this.THREE;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(256, 256);
    const rng = seeded(kind === 'grass' ? 57 : 81);
    for (let index = 0; index < image.data.length; index += 4) {
      const n = rng();
      const base = kind === 'grass' ? [126, 143, 92] : [189, 179, 151];
      image.data[index] = base[0] * (0.8 + n * 0.3);
      image.data[index + 1] = base[1] * (0.8 + n * 0.3);
      image.data[index + 2] = base[2] * (0.8 + n * 0.3);
      image.data[index + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace; texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(kind === 'grass' ? 24 : 12, kind === 'grass' ? 24 : 12);
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  _materials() {
    const T = this.THREE;
    this.materials = {
      grass: new T.MeshStandardMaterial({ color: '#a4b48b', map: this._noiseTexture('grass'), roughness: 1 }),
      gravel: new T.MeshStandardMaterial({ color: '#e4ddc9', map: this._noiseTexture('gravel'), roughness: 0.96 }),
      bank: new T.MeshStandardMaterial({ color: '#a4a692', roughness: 0.88 }),
      bark: new T.MeshStandardMaterial({ color: '#736548', roughness: 0.92 }),
      leaf: new T.MeshStandardMaterial({ color: '#849e47', roughness: 0.77, side: T.DoubleSide }),
      shrub: new T.MeshStandardMaterial({ color: '#466c3c', roughness: 0.9 }),
      flower: new T.MeshStandardMaterial({ color: '#dcaaa4', roughness: 0.9 }),
      gap: new T.MeshStandardMaterial({ color: '#e5b852', emissive: '#c38522', emissiveIntensity: 0.18, roughness: 0.4 }),
      active: new T.MeshStandardMaterial({ color: '#ffe3a1', emissive: '#dba24b', emissiveIntensity: 0.55, roughness: 0.3 }),
      marker: new T.MeshStandardMaterial({ color: '#fff5d7', emissive: '#ce9c50', emissiveIntensity: 0.3 }),
    };
    this.waterMaterial = new T.MeshPhysicalMaterial({ color: '#659fa4', metalness: 0.32, roughness: 0.19, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.2 });
    this.waterUniform = { value: 0 };
    this.waterMaterial.onBeforeCompile = shader => {
      shader.uniforms.pondTime = this.waterUniform;
      shader.vertexShader = 'uniform float pondTime; varying vec3 pondPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\npondPosition = position; transformed.z += 0.018 * sin(position.x * 2.0 + pondTime * 0.6) * cos(position.y * 2.4 + pondTime * 0.45);');
      shader.fragmentShader = 'uniform float pondTime; varying vec3 pondPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat ribbon = sin(pondPosition.x * 3.4 + sin(pondPosition.y * 4.2 + pondTime * 0.3)) * sin(pondPosition.y * 4.4 - pondTime * 0.2); diffuseColor.rgb += pow(max(0.0, ribbon), 9.0) * 0.12;');
    };
    this.waterMaterial.customProgramCacheKey = () => 'pond-water-v1';
  }

  _landscape() {
    const T = this.THREE;
    this.land = new T.Group(); this.scene.add(this.land);
    const terrain = new T.PlaneGeometry(160, 160, 96, 96);
    terrain.rotateX(-Math.PI / 2);
    const position = terrain.attributes.position;
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index), z = position.getZ(index), distance = Math.hypot(x, z);
      const edge = clamp((distance - 16) / 20, 0, 1);
      position.setY(index, -0.16 + edge * (0.55 * Math.sin(x * 0.13) * Math.cos(z * 0.16) + 0.26 * Math.sin(z * 0.24)));
    }
    terrain.computeVertexNormals();
    const ground = new T.Mesh(terrain, this.materials.grass); ground.receiveShadow = true; this.land.add(ground);
    const rng = seeded(72);
    const crown = new T.IcosahedronGeometry(1, 2);
    const hillMaterial = new T.MeshStandardMaterial({ color: '#a6b39c', roughness: 1 });
    const distant = new T.InstancedMesh(crown, hillMaterial, 34);
    const distantTransform = new T.Object3D();
    // A low, hazy hedgerow is environmental scenery, well outside the planting bank.
    for (let index = 0; index < 34; index++) {
      const angle = (index / 34) * TAU;
      const radius = 40 + rng() * 14;
      distantTransform.position.set(Math.cos(angle) * radius, 1.1 + rng(), Math.sin(angle) * radius);
      distantTransform.scale.set(3 + rng() * 4, 1.8 + rng() * 2, 2.5 + rng() * 3);
      distantTransform.updateMatrix(); distant.setMatrixAt(index, distantTransform.matrix);
    }
    this.land.add(distant);
    this.water = new T.Mesh(new T.CircleGeometry(1, 192), this.waterMaterial);
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = 0.015;
    this.land.add(this.water);
    this.path = new T.Mesh(new T.RingGeometry(1, 1.17, 192), this.materials.gravel);
    this.path.rotation.x = -Math.PI / 2; this.path.position.y = -0.08; this.path.receiveShadow = true;
    this.land.add(this.path);
  }

  _mergeGeometries(geometries) {
    const T = this.THREE;
    const expanded = geometries.map(geometry => geometry.index ? geometry.toNonIndexed() : geometry);
    const combined = new T.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const size = name === 'uv' ? 2 : 3;
      const length = expanded.reduce((total, geometry) => total + (geometry.getAttribute(name)?.array.length || 0), 0);
      if (!length) continue;
      const array = new Float32Array(length); let offset = 0;
      for (const geometry of expanded) {
        const source = geometry.getAttribute(name)?.array;
        if (source) { array.set(source, offset); offset += source.length; }
      }
      combined.setAttribute(name, new T.BufferAttribute(array, size));
    }
    expanded.forEach(geometry => geometry.dispose());
    geometries.forEach(geometry => geometry.dispose());
    combined.computeBoundingSphere();
    return combined;
  }

  _willowTemplate() {
    const T = this.THREE;
    const rng = seeded(812);
    const pieces = [];
    const trunk = new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(0.05, 1.2, 0), new T.Vector3(-0.05, 2.2, 0.04), new T.Vector3(0, 2.9, 0)]);
    pieces.push(new T.TubeGeometry(trunk, 12, 0.10, 6, false));
    const leafPositions = [];
    for (let index = 0; index < 38; index++) {
      const angle = index / 38 * TAU + rng() * 0.25;
      const reach = 0.82 + rng() * 0.48;
      const tipHeight = 0.62 + rng() * 0.9;
      const branch = new T.CatmullRomCurve3([
        new T.Vector3(0, 2.15 + rng() * 0.55, 0),
        new T.Vector3(Math.cos(angle) * reach * 0.68, 3 + rng() * 0.35, Math.sin(angle) * reach * 0.68),
        new T.Vector3(Math.cos(angle) * reach, 2.30, Math.sin(angle) * reach),
        new T.Vector3(Math.cos(angle) * reach * 0.93, tipHeight, Math.sin(angle) * reach * 0.93),
      ]);
      pieces.push(new T.TubeGeometry(branch, 12, 0.014, 3, false));
      for (let leafIndex = 0; leafIndex < 20; leafIndex++) {
        const progress = 0.20 + leafIndex / 20 * 0.78;
        const point = branch.getPoint(progress);
        leafPositions.push({ position: point, angle: angle + (leafIndex % 2 ? 0.6 : -0.6), scale: 0.65 + rng() * 0.65 });
      }
    }
    const group = new T.Group();
    const bark = new T.Mesh(this._mergeGeometries(pieces), this.materials.bark);
    bark.castShadow = true; bark.receiveShadow = true; group.add(bark);
    const leafShape = new T.Shape();
    leafShape.moveTo(0, 0.15); leafShape.quadraticCurveTo(0.055, 0.03, 0, -0.18); leafShape.quadraticCurveTo(-0.055, 0.03, 0, 0.15);
    const leafGeometry = new T.ShapeGeometry(leafShape, 3);
    const foliage = new T.InstancedMesh(leafGeometry, this.materials.leaf, leafPositions.length);
    const dummy = new T.Object3D(); const color = new T.Color();
    leafPositions.forEach((leaf, index) => {
      dummy.position.copy(leaf.position); dummy.rotation.set(0.18 + rng() * 0.5, leaf.angle, (rng() - 0.5) * 0.9);
      dummy.scale.setScalar(leaf.scale); dummy.updateMatrix(); foliage.setMatrixAt(index, dummy.matrix);
      color.setHSL(0.20 + rng() * 0.045, 0.32 + rng() * 0.20, 0.25 + rng() * 0.18); foliage.setColorAt(index, color);
    });
    foliage.castShadow = true; foliage.receiveShadow = true;
    group.add(foliage);
    return group;
  }

  _shrubTemplate() {
    const T = this.THREE;
    const group = new T.Group(); const rng = seeded(903); const pieces = []; const blossoms = [];
    const transform = new T.Object3D();
    const branchGeometry = new T.IcosahedronGeometry(0.22, 1);
    for (let index = 0; index < 5; index++) {
      const angle = index / 5 * TAU;
      transform.position.set(Math.cos(angle) * 0.12, 0.24 + rng() * 0.14, Math.sin(angle) * 0.12);
      transform.scale.set(0.85, 1.2, 0.85); transform.updateMatrix();
      pieces.push(branchGeometry.clone().applyMatrix4(transform.matrix));
    }
    const flowerGeometry = new T.SphereGeometry(0.035, 5, 4);
    for (let index = 0; index < 7; index++) {
      const angle = rng() * TAU;
      transform.position.set(Math.cos(angle) * 0.21, 0.42 + rng() * 0.15, Math.sin(angle) * 0.21);
      transform.scale.setScalar(1); transform.updateMatrix();
      blossoms.push(flowerGeometry.clone().applyMatrix4(transform.matrix));
    }
    branchGeometry.dispose(); flowerGeometry.dispose();
    const foliage = new T.Mesh(this._mergeGeometries(pieces), this.materials.shrub); foliage.castShadow = true; foliage.receiveShadow = true;
    const flowers = new T.Mesh(this._mergeGeometries(blossoms), this.materials.flower);
    group.add(foliage, flowers);
    return group;
  }

  _label(text, width = 3.4) {
    const T = this.THREE;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f8f7ed'; ctx.beginPath(); ctx.roundRect(6, 6, 500, 148, 28); ctx.fill();
    ctx.strokeStyle = '#8a9476'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#253f35'; ctx.font = '500 66px Avenir Next, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 85);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, depthTest: false, toneMapped: false }));
    sprite.scale.set(width, width * 160 / 512, 1); sprite.renderOrder = 5;
    return sprite;
  }

  _createPlanting() {
    const T = this.THREE;
    const old = this.planting;
    this.planting = new T.Group(); this.scene.add(this.planting);
    if (old) { this.scene.remove(old); this._disposeObject(old); }
    this.treeTemplate ??= this._willowTemplate();
    this.shrubTemplate ??= this._shrubTemplate();
    this.trees = []; this.shrubs = []; this.gapRibbons = []; this.hitTargets = [];
    const radius = this.plan.radius;
    this.water.scale.setScalar(radius - 0.58);
    this.path.scale.setScalar(radius - 0.25);
    const bank = new T.Mesh(new T.TorusGeometry(radius - 0.48, 0.14, 8, 192), this.materials.bank);
    bank.rotation.x = Math.PI / 2; bank.position.y = -0.015; bank.castShadow = bank.receiveShadow = true; this.planting.add(bank);
    this.plan.trees.forEach(tree => {
      const object = this.treeTemplate.clone(true);
      object.position.set(tree.x, 0, tree.z); object.rotation.y = tree.index * 1.71;
      object.scale.setScalar(0.91 + (tree.index % 3) * 0.035);
      this.trees.push(object); this.planting.add(object);
    });
    this.plan.shrubs.forEach(shrub => {
      const object = this.shrubTemplate.clone(true); object.position.set(shrub.x, 0, shrub.z); object.rotation.y = shrub.index * 1.3;
      this.shrubs.push(object); this.planting.add(object);
    });
    this.plan.gaps.forEach(gap => {
      const points = Array.from({ length: 41 }, (_, index) => { const angle = gap.startAngle + (gap.endAngle - gap.startAngle) * index / 40; return new T.Vector3(Math.cos(angle) * radius, 0.075, Math.sin(angle) * radius); });
      const curve = new T.CatmullRomCurve3(points);
      const ribbon = new T.Mesh(new T.TubeGeometry(curve, 48, 0.042, 5, false), this.materials.gap);
      ribbon.userData.gapIndex = gap.index; ribbon.renderOrder = 2;
      this.gapRibbons.push(ribbon); this.planting.add(ribbon);
      const hit = new T.Mesh(new T.TubeGeometry(curve, 24, 0.45, 3, false), new T.MeshBasicMaterial({ visible: false }));
      hit.userData.gapIndex = gap.index; this.hitTargets.push(hit); this.planting.add(hit);
    });
    this.marker = new T.Mesh(new T.TorusGeometry(0.29, 0.055, 8, 40), this.materials.marker);
    this.marker.rotation.x = Math.PI / 2; this.marker.position.set(this.plan.trees[0].x, 0.08, this.plan.trees[0].z);
    this.planting.add(this.marker);
    this.distanceLabel = this._label(`${this.plan.circumference} m around`, 4.0);
    this.distanceLabel.position.set(-1, 0.5, 0.6); this.planting.add(this.distanceLabel);
    this.gapLabel = this._label('6 m', 1.8); this.planting.add(this.gapLabel);
    this.startLabel = this._label('Start', 1.7);
    this.startLabel.position.set(this.plan.trees[0].x, 0.65, this.plan.trees[0].z - 0.7); this.planting.add(this.startLabel);
    this.walkMarker = new T.Mesh(new T.SphereGeometry(0.13, 12, 8), this.materials.active); this.planting.add(this.walkMarker);
    this._applyScene();
  }

  _applyScene() {
    if (!this.scene) return;
    const plan = this.plan;
    this.shrubs.forEach((object, index) => { object.visible = index < plan.visibleShrubs; });
    this.gapRibbons.forEach((object, index) => {
      object.visible = index < plan.visibleGaps || (plan.visibleGaps > 0 && index === plan.focusGap);
      object.material = index === plan.focusGap ? this.materials.active : this.materials.gap;
    });
    this.startLabel.visible = ['closure', 'solution'].includes(plan.nodeId);
    this.marker.visible = this.startLabel.visible;
    const gap = plan.gaps[plan.focusGap];
    const mid = (gap.startAngle + gap.endAngle) / 2;
    this.gapLabel.position.set(Math.cos(mid) * (plan.radius + 1.15), 0.7, Math.sin(mid) * (plan.radius + 1.15));
    this.gapLabel.visible = plan.nodeId !== 'situation' || plan.visibleGaps > 0;
    this.walkMarker.visible = plan.visibleGaps > 0 && ['gaps', 'closure', 'solution'].includes(plan.nodeId);
    this.sceneTime = 0;
    this.resize();
    this._requestFrame();
  }

  setScene(input = {}) {
    const next = buildPondPlan(input);
    const changedSize = this.plan?.count !== next.count;
    this.plan = next;
    const description = describePondPlan(next);
    this.summary.textContent = description;
    this.canvas.setAttribute('aria-label', description);
    this.canvas.dataset.lessonScene = next.nodeId;
    if (this.scene) { if (changedSize) this._createPlanting(); else this._applyScene(); }
    if (!this.fallback.hidden) this.fallback.textContent = `The 3D view is unavailable. The spoken lesson and input still work. ${description}`;
  }

  updateScene(input) { this.setScene(input); }
  setSpeaking(amplitude = 0) { this.speaking = clamp(finite(amplitude, 0), 0, 1); this._requestFrame(); }
  setTalking(amplitude) { this.setSpeaking(amplitude); }
  setPaused(paused) { this.paused = Boolean(paused); this.lastFrame = 0; this._requestFrame(); }

  resize() {
    if (!this.renderer || this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width)); const height = Math.max(1, Math.round(rect.height));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Leave a quiet right-hand third for the presenter. Narrow screens place the
    // presenter above the input and keep the entire planting loop visible.
    const compact = this.camera.aspect < 0.95;
    const radius = this.plan.radius;
    const distance = compact ? 4.8 : this.camera.aspect < 1.4 ? 4.3 : 3.7;
    this.camera.position.set(radius * 1.65, radius * 1.9, radius * distance);
    // In landscape, leave the lower strip clear for the spoken caption/input.
    this.target.set(compact ? 0 : radius * 0.72, this.camera.aspect >= 1.4 ? -2 : 0.55, 0);
    this.camera.lookAt(this.target);
    this._requestFrame();
  }

  _select(event) {
    if (!this.renderer || this.disposed || !this.options.onSelect) return;
    const T = this.THREE; const rect = this.canvas.getBoundingClientRect();
    const pointer = new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new T.Raycaster(); raycaster.setFromCamera(pointer, this.camera);
    const hit = raycaster.intersectObjects(this.hitTargets, false)[0];
    if (hit) this.options.onSelect({ gapIndex: hit.object.userData.gapIndex, nodeId: this.plan.nodeId });
  }

  _showFallback(message) {
    this.fallback.textContent = `${message} ${describePondPlan(this.plan)}`;
    this.fallback.hidden = false;
    this.canvas.dataset.renderer = 'fallback';
  }

  _requestFrame() {
    if (!this.renderer || this.disposed || this.contextLost || this.raf || document.hidden || !this.visible) return;
    this.raf = requestAnimationFrame(timestamp => this._frame(timestamp));
  }

  _frame(timestamp) {
    this.raf = null;
    if (this.disposed || this.contextLost || document.hidden || !this.visible) return;
    const dt = this.lastFrame ? Math.min((timestamp - this.lastFrame) / 1000, 0.05) : 0;
    this.lastFrame = timestamp;
    if (!this.paused && !this.reducedMotion) { this.time += dt; this.sceneTime += dt; }
    this.waterUniform.value = this.time;
    if (!this.paused && !this.reducedMotion) {
      this.trees.forEach((tree, index) => { tree.rotation.z = Math.sin(this.time * 0.5 + index) * 0.006; });
    }
    const gap = this.plan.gaps[this.plan.focusGap];
    const progress = this.reducedMotion || this.paused ? 1 : Math.min(this.sceneTime / 3.2, 1);
    const angle = gap.startAngle + (gap.endAngle - gap.startAngle) * progress;
    this.walkMarker.position.set(Math.cos(angle) * this.plan.radius, 0.19, Math.sin(angle) * this.plan.radius);
    this.renderer.render(this.scene, this.camera);
    if (!this.paused && !this.reducedMotion) this._requestFrame();
  }

  _disposeObject(object, preserveTemplates = true) {
    const sharedGeometry = new Set(); const sharedMaterial = new Set(Object.values(this.materials || {}));
    if (preserveTemplates) for (const template of [this.treeTemplate, this.shrubTemplate]) template?.traverse(item => { if (item.geometry) sharedGeometry.add(item.geometry); });
    object.traverse(item => {
      if (item.isInstancedMesh) item.dispose();
      if (item.geometry && !sharedGeometry.has(item.geometry)) item.geometry.dispose();
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) {
        if (!material || (preserveTemplates && sharedMaterial.has(material))) continue;
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.raf); this.raf = null;
    this.resizeObserver.disconnect(); this.intersectionObserver?.disconnect();
    this.motionQuery.removeEventListener?.('change', this._motionChange);
    document.removeEventListener('visibilitychange', this._visibilityChange);
    this.canvas.removeEventListener('webglcontextlost', this._contextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._contextRestored);
    this.canvas.removeEventListener('pointerup', this._pointerUp);
    if (this.scene) this._disposeObject(this.scene, false);
    this._disposeObject(this.treeTemplate || { traverse() {} }, false);
    this._disposeObject(this.shrubTemplate || { traverse() {} }, false);
    this.environmentTarget?.dispose(); this.renderer?.dispose();
    this.summary.remove(); this.fallback.remove(); if (this.ownsCanvas) this.canvas.remove();
    delete this.canvas.dataset.renderer;
  }
}

export default PondStage;
