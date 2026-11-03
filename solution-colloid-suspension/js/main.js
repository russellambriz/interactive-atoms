// Mixtures lab: solution, colloid, and suspension in three glass beakers.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
if (isTouch) document.body.classList.add('touch');
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
}

const R = {
  outer: 0.86,
  inner: 0.78,
  height: 2.16,
  bottom: 0.1,
  liquid: 1.52,
};
const XS = [-2.72, 0, 2.72];
const KINDS = ['solution', 'colloid', 'suspension'];
const ACCENT = { solution: 0x8fdfff, colloid: 0xf4ecdf, suspension: 0xf0b27a };
const BEAM_Y = R.bottom + R.liquid * 0.62;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const tmp = new THREE.Vector3();
const dummy = new THREE.Object3D();
const colorA = new THREE.Color();
const colorB = new THREE.Color();

function boot() {
  const container = $('app');

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: params.has('capture'),
  });
  if (!renderer.getContext()) throw new Error('WebGL is unavailable.');
  renderer.setClearColor(0x070b12, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  let pixelRatio = Math.min(window.devicePixelRatio || 1, innerWidth < 800 ? 1.5 : 1.75);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.08, 80);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.5 - 0.04;
  controls.minPolarAngle = 0.18;
  controls.minDistance = 2.6;
  controls.maxDistance = 30;
  controls.target.set(0, 1.0, 0);

  buildEnvironment(renderer, scene);
  buildStudio(scene);

  const glassMat = makeGlassMaterial(1);
  const glassBaseMat = makeGlassMaterial(1.35);
  const glassRimMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.04,
    transparent: true,
    opacity: 0.55,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const gradTex = makeGraduationTexture();
  const shadowTex = makeShadowTexture();

  const beakers = {};
  const pickables = [];
  KINDS.forEach((kind, i) => {
    const b = buildBeaker(kind, XS[i], glassMat, glassBaseMat, glassRimMat, gradTex, shadowTex);
    scene.add(b.group);
    beakers[kind] = b;
    b.pick.forEach(mesh => pickables.push({ mesh, kind }));
  });

  const beam = buildBeam(scene, camera);

  const state = {
    settle: params.has('settle') ? clamp(parseFloat(params.get('settle')) || 0, 0, 1) : 0,
    playing: params.get('pause') === '1' || params.has('settle') || reduceMotion ? false : params.get('play') !== '0',
    laser: params.get('laser') === '0' ? false : true,
    magnify: params.get('magnify') === '1' ? 1 : 0,
    magTarget: params.get('magnify') === '1' ? 1 : 0,
    stirring: 0,
    stirPhase: 0,
    focus: null,
    time: 0,
    userMoved: false,
    camAnim: null,
    fps: 0,
  };
  if (params.get('play') === '1') state.playing = true;
  if (params.get('ui') === '0') document.body.classList.add('ui-off');
  if (params.get('focus') && beakers[params.get('focus')]) state.focus = params.get('focus');

  const home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  function computeHome(mag) {
    const aspect = innerWidth / Math.max(innerHeight, 1);
    const fov = aspect < 0.8 ? 46 : 32;
    camera.aspect = aspect;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    // Fit the laser and all three beakers in the band above the comparison table.
    const halfNeed = (aspect < 0.8 ? 4.15 : 5.35) * (mag > 0.5 ? 0.72 : 1);
    const dist = halfNeed / (Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect) * 1.02;
    const pitch = mag > 0.5 ? 0.38 : 0.42;
    const panelShift = aspect > 1.05 && innerWidth > 900 ? -0.15 : 0;
    home.target.set(panelShift, mag > 0.5 ? 1.15 : 1.28, 0);
    home.pos.set(
      home.target.x + 0.15,
      home.target.y + Math.sin(pitch) * dist * (mag > 0.5 ? 0.85 : 0.72),
      home.target.z + Math.cos(pitch) * dist
    );
  }
  function goHome(animated) {
    state.focus = null;
    computeHome(state.magTarget);
    if (!animated) {
      camera.position.copy(home.pos);
      controls.target.copy(home.target);
      controls.update();
      state.camAnim = null;
      return;
    }
    state.camAnim = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      pos: home.pos.clone(),
      target: home.target.clone(),
      t: 0,
    };
  }
  computeHome(state.magTarget);
  camera.position.copy(home.pos);
  controls.target.copy(home.target);
  controls.update();

  controls.addEventListener('start', () => {
    state.userMoved = true;
    state.camAnim = null;
  });

  const ui = wireUI(state, { beakers, goHome, stir: () => beginStir(state, beakers, true) });
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pointerDown = null;
  canvas.addEventListener('pointerdown', e => { pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', e => {
    if (!pointerDown) return;
    const dx = e.clientX - pointerDown.x, dy = e.clientY - pointerDown.y;
    pointerDown = null;
    if (dx * dx + dy * dy > 36) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables.map(p => p.mesh), false);
    if (!hits.length) return;
    const found = pickables.find(p => p.mesh === hits[0].object);
    if (found) focusKind(found.kind);
  });

  function focusKind(kind) {
    if (state.focus === kind) {
      goHome(true);
      return;
    }
    state.focus = kind;
    state.userMoved = true;
    const origin = beakers[kind].group.position;
    const target = new THREE.Vector3(origin.x, 1.02, origin.z);
    const offset = camera.position.clone().sub(controls.target);
    if (offset.length() < 0.01) offset.set(0.4, 1.6, 4);
    const dist = state.magTarget > 0.5 ? 3.15 : 4.15;
    offset.setLength(dist);
    state.camAnim = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      pos: target.clone().add(offset),
      target,
      t: 0,
    };
  }

  document.querySelectorAll('[data-focus]').forEach(el => {
    el.addEventListener('click', () => focusKind(el.dataset.focus));
  });

  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 's' || e.key === 'S') beginStir(state, beakers, true);
    else if (e.key === 'l' || e.key === 'L') { state.laser = !state.laser; ui.sync(); }
    else if (e.key === 'm' || e.key === 'M') { state.magTarget = state.magTarget > 0.5 ? 0 : 1; ui.sync(); }
    else if (e.key === 'f' || e.key === 'F') { state.userMoved = false; goHome(true); }
    else if (e.key === '1') focusKind('solution');
    else if (e.key === '2') focusKind('colloid');
    else if (e.key === '3') focusKind('suspension');
  });

  function togglePlay() {
    if (state.playing) { state.playing = false; ui.sync(); return; }
    if (state.settle >= 0.995) beginStir(state, beakers, true);
    else state.playing = true;
    ui.sync();
  }
  ui.playBtn.addEventListener('click', togglePlay);

  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (!state.userMoved && !state.camAnim) goHome(false);
  }
  window.addEventListener('resize', onResize);

  let frames = 0;
  let acc = 0;
  let last = performance.now();
  let fpsWindow = 0;
  let hidden = false;
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; last = performance.now(); });

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000) || 0;
    last = now;
    if (!hidden) step(dt);
    controls.update();
    renderer.render(scene, camera);
    placeTags();
    frames++;
    acc += dt;
    if (frames === 1) $('loading').classList.add('done');
    if (acc >= 0.4) {
      state.fps = frames / acc;
      frames = 0;
      acc = 0;
      adaptPixelRatio(state.fps);
      fpsWindow++;
    }
  }

  function step(dt) {
    state.time += dt;
    state.magnify = lerp(state.magnify, state.magTarget, 1 - Math.pow(0.001, dt));

    if (state.stirring > 0) {
      state.stirring = Math.max(0, state.stirring - dt);
      state.stirPhase += dt * 7.5;
      state.settle = lerp(state.settle, 0, 1 - Math.pow(0.04, dt));
      if (state.stirring === 0) {
        KINDS.forEach(k => beakers[k].onStirEnd && beakers[k].onStirEnd());
        if (state.resumeAfterStir) state.playing = true;
        state.resumeAfterStir = false;
      }
    } else if (state.playing) {
      state.settle = Math.min(1, state.settle + dt / 16);
      if (state.settle >= 1) state.playing = false;
    }

    if (state.camAnim) {
      state.camAnim.t = Math.min(1, state.camAnim.t + dt / 0.85);
      const k = 1 - Math.pow(1 - state.camAnim.t, 3);
      camera.position.lerpVectors(state.camAnim.fromPos, state.camAnim.pos, k);
      controls.target.lerpVectors(state.camAnim.fromTarget, state.camAnim.target, k);
      if (state.camAnim.t >= 1) state.camAnim = null;
    }

    const turb = 1 - smooth((state.settle - 0.08) / 0.85);
    KINDS.forEach(k => beakers[k].update(dt, state, turb));
    beam.update(state, turb);
    ui.sync();
  }

  function placeTags() {
    const tags = document.querySelectorAll('.mix-tag');
    tags.forEach(el => {
      const b = beakers[el.dataset.focus];
      tmp.set(b.group.position.x, R.height + 0.18, b.group.position.z);
      tmp.project(camera);
      const behind = tmp.z > 1;
      el.hidden = behind;
      if (behind) return;
      const x = (tmp.x * 0.5 + 0.5) * innerWidth;
      const y = (-tmp.y * 0.5 + 0.5) * innerHeight;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -120%)`;
      el.classList.toggle('on', state.focus === el.dataset.focus);
    });
  }

  function adaptPixelRatio(fps) {
    if (fpsWindow < 2) return;
    if (fps < 42 && pixelRatio > 1) {
      pixelRatio = Math.max(1, +(pixelRatio - 0.25).toFixed(2));
      renderer.setPixelRatio(pixelRatio);
    }
  }

  function meanY(parts) {
    let s = 0;
    for (let i = 0; i < parts.length; i++) s += parts[i].y;
    return s / parts.length;
  }

  window.mixturesLab = {
    setSettle(v) { state.playing = false; state.stirring = 0; state.settle = clamp(+v || 0, 0, 1); },
    setLaser(on) { state.laser = !!on; },
    setMagnify(on) { state.magTarget = on ? 1 : 0; },
    stir() { beginStir(state, beakers, false); },
    play() { state.playing = true; },
    pause() { state.playing = false; },
    focus(kind) { if (!kind) goHome(false); else focusKind(kind); },
    advance(seconds) {
      const n = Math.max(1, Math.round((seconds || 0) * 60));
      for (let i = 0; i < n; i++) step(1 / 60);
    },
    state() {
      return {
        settle: +state.settle.toFixed(4),
        laser: state.laser,
        magnify: +state.magnify.toFixed(3),
        playing: state.playing,
        stirring: state.stirring > 0,
        focus: state.focus,
        turb: +((1 - smooth((state.settle - 0.08) / 0.85)).toFixed(3)),
        fps: +state.fps.toFixed(1),
        pixelRatio,
        meanY: {
          solution: +meanY(beakers.solution.parts).toFixed(4),
          colloid: +meanY(beakers.colloid.parts).toFixed(4),
          suspension: +meanY(beakers.suspension.parts).toFixed(4),
        },
        counts: {
          solution: beakers.solution.parts.length,
          colloid: beakers.colloid.parts.length,
          suspension: beakers.suspension.parts.length,
        },
      };
    },
  };

  requestAnimationFrame(frame);
}

function beginStir(state, beakers, resumeIfPlaying) {
  state.resumeAfterStir = resumeIfPlaying ? (state.playing || state.resumeAfterStir) : false;
  state.playing = false;
  state.stirring = 1.65;
  state.stirPhase = 0;
  beakers.suspension.remix();
  beakers.colloid.kick();
}

function buildEnvironment(renderer, scene) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x101826);
  const add = (r, g, b, w, h, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ toneMapped: false })
    );
    m.material.color.setRGB(r, g, b);
    m.position.set(x, y, z);
    m.lookAt(0, 1.1, 0);
    env.add(m);
  };
  add(6.5, 7.2, 8.2, 7, 3.4, -5, 5.2, -3);
  add(7.2, 6.4, 4.6, 6, 2.2, 1.2, 6.4, 2);
  add(2.4, 3.2, 5.4, 5, 3, 6, 2.2, 3);
  add(0.45, 0.32, 0.22, 10, 3, 0, -1.5, 3);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
}

function buildStudio(scene) {
  scene.add(new THREE.HemisphereLight(0xc5d7ff, 0x2a211c, 0.55));
  const key = new THREE.DirectionalLight(0xfff4e8, 2.6);
  key.position.set(-5.5, 8.2, 4.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc5d8ff, 1.05);
  fill.position.set(6.2, 3.2, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xd7e6ff, 1.7);
  rim.position.set(0.5, 4.2, -5);
  scene.add(rim);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(42, 32, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vP;
        void main(){
          vec3 d = normalize(vP);
          float h = d.y * 0.5 + 0.5;
          vec3 top = vec3(0.02, 0.035, 0.07);
          vec3 mid = vec3(0.055, 0.07, 0.11);
          vec3 bot = vec3(0.09, 0.07, 0.06);
          vec3 col = mix(bot, mid, smoothstep(0.05, 0.5, h));
          col = mix(col, top, smoothstep(0.45, 1.0, h));
          float win = exp(-pow((d.x + 0.35) * 2.4, 2.0) - pow((d.y - 0.35) * 3.0, 2.0));
          col += vec3(0.10, 0.14, 0.2) * win;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -2;
  scene.add(sky);

  const benchTex = makeBenchTexture();
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(12.4, 0.32, 5.3),
    new THREE.MeshPhysicalMaterial({
      map: benchTex,
      color: 0xffffff,
      roughness: 0.46,
      metalness: 0.08,
      clearcoat: 0.42,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.7,
    })
  );
  bench.position.set(0, -0.16, 0.15);
  scene.add(bench);

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 7.2),
    new THREE.MeshStandardMaterial({ color: 0x141a28, roughness: 0.96, metalness: 0 })
  );
  wall.position.set(0, 3.15, -2.55);
  scene.add(wall);
}

function makeGlassMaterial(strength) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uStrength: { value: strength } },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vN;
      varying vec3 vV;
      uniform float uStrength;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float fres = pow(1.0 - ndv, 2.15);
        float band = smoothstep(0.35, 0.55, ndv) * smoothstep(0.82, 0.62, ndv);
        vec3 col = mix(vec3(0.62, 0.78, 0.9), vec3(0.95, 0.98, 1.0), fres);
        col += vec3(0.75, 0.88, 1.0) * band;
        float a = (0.035 + fres * 0.62 + band * 0.18) * uStrength;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
      }
    `,
  });
}

function makeLiquidMaterial(kind) {
  const presets = {
    solution: { color: '#eaf7ff', deep: '#d3ebf6', opacity: 0.16 },
    colloid: { color: '#f7f3ec', deep: '#e4d5c4', opacity: 0.55 },
    suspension: { color: '#8f6236', deep: '#4e3018', opacity: 0.62 },
  };
  const p = presets[kind];
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(p.color) },
      uDeep: { value: new THREE.Color(p.deep) },
      uOpacity: { value: p.opacity },
      uGlow: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        vH = position.y + 0.5;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      uniform vec3 uColor;
      uniform vec3 uDeep;
      uniform float uOpacity;
      uniform vec3 uGlow;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float fres = pow(1.0 - ndv, 1.8);
        float h = clamp(vH, 0.0, 1.0);
        vec3 col = mix(uDeep, uColor, smoothstep(0.0, 0.85, h));
        col += uGlow;
        col += vec3(1.0) * fres * 0.18;
        float a = uOpacity * mix(1.15, 0.55, h) + fres * 0.12;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
      }
    `,
  });
}

function buildBeaker(kind, x, glassMat, glassBaseMat, glassRimMat, gradTex, shadowTex) {
  const group = new THREE.Group();
  group.position.set(x, 0, 0);
  const pick = [];

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(R.outer, R.outer * 0.98, R.height, 64, 1, true),
    glassMat
  );
  wall.position.y = R.height / 2;
  wall.renderOrder = 4;
  group.add(wall);
  pick.push(wall);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(R.outer * 0.98, R.outer * 0.96, R.bottom, 64),
    glassBaseMat
  );
  base.position.y = R.bottom / 2;
  group.add(base);

  const lip = new THREE.Mesh(new THREE.TorusGeometry(R.outer - 0.02, 0.045, 12, 64), glassRimMat);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = R.height - 0.02;
  group.add(lip);

  const innerLip = new THREE.Mesh(
    new THREE.RingGeometry(R.inner, R.outer - 0.01, 64),
    glassRimMat
  );
  innerLip.rotation.x = -Math.PI / 2;
  innerLip.position.y = R.height - 0.015;
  group.add(innerLip);

  const grad = new THREE.Mesh(
    new THREE.CylinderGeometry(R.outer + 0.012, R.outer * 0.98 + 0.012, R.height * 0.86, 32, 1, true, -0.7, 1.4),
    new THREE.MeshBasicMaterial({
      map: gradTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.8,
      side: THREE.DoubleSide,
    })
  );
  grad.position.y = R.bottom + R.height * 0.40;
  grad.renderOrder = 6;
  group.add(grad);

  const liquidMat = makeLiquidMaterial(kind);
  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(R.inner - 0.02, R.inner - 0.025, 1, 64),
    liquidMat
  );
  liquid.scale.y = R.liquid;
  liquid.position.y = R.bottom + R.liquid / 2;
  liquid.renderOrder = 3;
  group.add(liquid);
  pick.push(liquid);

  const sedimentMat = new THREE.MeshStandardMaterial({
    color: 0x4a3018,
    roughness: 0.92,
    metalness: 0.02,
  });
  const sediment = new THREE.Mesh(new THREE.CylinderGeometry(R.inner - 0.03, R.inner - 0.04, 1, 48), sedimentMat);
  sediment.visible = false;
  sediment.position.y = R.bottom;
  group.add(sediment);

  const lineMat = new THREE.MeshBasicMaterial({
    color: kind === 'colloid' ? 0xfff6ea : kind === 'suspension' ? 0xd7b48a : 0xf4fbff,
    transparent: true,
    opacity: kind === 'solution' ? 0.35 : 0.55,
    depthWrite: false,
  });
  const line = new THREE.Mesh(new THREE.TorusGeometry(R.inner - 0.03, 0.012, 8, 48), lineMat);
  line.rotation.x = Math.PI / 2;
  line.position.y = R.bottom + R.liquid;
  line.renderOrder = 4;
  group.add(line);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.15, 2.15),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.008;
  shadow.renderOrder = 1;
  group.add(shadow);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(R.outer + 0.08, 0.012, 8, 64),
    new THREE.MeshBasicMaterial({ color: ACCENT[kind] })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.012;
  group.add(ring);

  let rod = null;
  if (kind === 'suspension') {
    const pivot = new THREE.Group();
    pivot.position.y = R.height + 0.05;
    const rodMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.02, 1.7, 16),
      makeGlassMaterial(1.15)
    );
    rodMesh.position.y = -0.55;
    rodMesh.rotation.z = 0.42;
    rodMesh.rotation.x = 0.08;
    pivot.add(rodMesh);
    group.add(pivot);
    rod = pivot;
  }

  const spec = particleSpec(kind);
  const mesh = new THREE.InstancedMesh(spec.geo, spec.mat, spec.count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = spec.count;
  group.add(mesh);
  const parts = [];
  for (let i = 0; i < spec.count; i++) {
    const p = makeParticle(kind, i, spec.count);
    parts.push(p);
    if (spec.colors) mesh.setColorAt(i, spec.colors(p, i));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const muddy = new THREE.Color('#8f6236');
  const muddyDeep = new THREE.Color('#4e3018');
  const clearW = new THREE.Color('#e7f5fb');
  const clearDeep = new THREE.Color('#c5dde8');
  const bed = new THREE.Color('#3e2916');

  function writeInstances(mag) {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const rad = displayRadius(kind, p, mag);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.set(rad * p.sx, rad * p.sy, rad * p.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function update(dt, state, turb) {
    const mag = state.magnify;
    if (kind === 'solution') updateSolution(parts, state.time, dt);
    else if (kind === 'colloid') updateColloid(parts, dt, state);
    else updateSuspension(parts, dt, state);

    if (kind === 'suspension') {
      const s = smooth(state.settle);
      const sedimentH = 0.02 + 0.34 * s;
      const superH = Math.max(0.08, R.liquid - sedimentH + 0.02);
      sediment.visible = s > 0.04;
      sediment.scale.y = sedimentH;
      sediment.position.y = R.bottom + sedimentH / 2;
      sediment.material.color.copy(bed);
      liquid.scale.y = superH;
      liquid.position.y = R.bottom + sedimentH + superH / 2 - 0.02;
      liquidMat.uniforms.uColor.value.copy(muddy).lerp(clearW, s);
      liquidMat.uniforms.uDeep.value.copy(muddyDeep).lerp(clearDeep, s);
      liquidMat.uniforms.uOpacity.value = lerp(0.62, 0.16, s);
      liquidMat.uniforms.uGlow.value.setRGB(0.08 * (state.laser ? turb : 0), 0.015 * turb, 0.01 * turb);
      lineMat.color.copy(colorA.set('#e0b27a')).lerp(colorB.set('#f4fbff'), s);
      lineMat.opacity = lerp(0.7, 0.35, s);
      line.position.y = R.bottom + R.liquid + Math.sin(state.stirPhase * 2.2) * 0.01 * (state.stirring > 0 ? 1 : 0);
      if (rod) {
        const spinning = state.stirring > 0;
        const rest = 0.7;
        rod.rotation.y = spinning ? state.stirPhase : lerp(rod.rotation.y, rest, 1 - Math.pow(0.05, dt));
        rod.children[0].rotation.z = spinning ? 0.22 + Math.sin(state.stirPhase * 2) * 0.08 : 0.42;
      }
    } else if (kind === 'colloid') {
      line.position.y = R.bottom + R.liquid + Math.sin(state.time * 1.4) * 0.006;
      const glow = state.laser ? 0.07 : 0;
      liquidMat.uniforms.uGlow.value.setRGB(glow, glow * 0.25, glow * 0.2);
    }

    const selected = state.focus === kind;
    ring.scale.setScalar(selected ? 1.06 : 1);
    const pulse = selected ? 0.65 + 0.35 * Math.sin(state.time * 3) : 0.55;
    ring.material.color.setHex(ACCENT[kind]).multiplyScalar(pulse);
    writeInstances(mag);
  }

  function remix() {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const m = sampleCylinder(i + 3, parts.length, R.inner - 0.12, R.bottom + 0.08, R.bottom + R.liquid - 0.08);
      p.mx = m.x; p.my = m.y; p.mz = m.z;
    }
  }

  function kick() {
    for (const p of parts) {
      p.vx += -p.z * 3.2;
      p.vz += p.x * 3.2;
      p.vy += 0.25;
    }
  }

  function onStirEnd() {
    if (kind !== 'suspension') return;
    for (const p of parts) {
      p.x = p.mx; p.y = p.my; p.z = p.mz;
    }
  }

  writeInstances(0);
  return { group, kind, parts, pick, update, remix, kick, onStirEnd, liquidMat };
}

function particleSpec(kind) {
  if (kind === 'solution') {
    return {
      count: 56,
      geo: new THREE.SphereGeometry(1, 14, 10),
      mat: new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.28,
        metalness: 0,
        clearcoat: 0.7,
        clearcoatRoughness: 0.2,
        emissive: 0x1a2433,
        emissiveIntensity: 0.35,
      }),
      colors: (_p, i) => new THREE.Color(i % 2 ? 0xffc27a : 0x8fd4ff),
    };
  }
  if (kind === 'colloid') {
    return {
      count: 72,
      geo: new THREE.SphereGeometry(1, 16, 12),
      mat: new THREE.MeshPhysicalMaterial({
        color: 0xfff8ef,
        roughness: 0.32,
        metalness: 0,
        clearcoat: 0.85,
        clearcoatRoughness: 0.18,
      }),
      colors: null,
    };
  }
  return {
    count: 40,
    geo: new THREE.SphereGeometry(1, 12, 10),
    mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0.03 }),
    colors: p => new THREE.Color().setHSL(0.07, 0.42, 0.16 + (1 - p.sizeN) * 0.14),
  };
}

function makeParticle(kind, i, n) {
  const y0 = R.bottom + 0.08;
  const y1 = R.bottom + R.liquid - 0.08;
  const c = sampleCylinder(i, n, R.inner - 0.14, y0, y1);
  const sizeN = kind === 'suspension' ? 0.22 + ((i * 0.61803398875) % 1) * 0.78 : 0.5;
  const settledR = (R.inner - 0.16) * 0.72 * Math.sqrt((i * 0.38196601125) % 1);
  const settledA = i * 2.399963229728653;
  return {
    x: c.x, y: c.y, z: c.z,
    mx: c.x, my: c.y, mz: c.z,
    hx: c.x, hy: c.y, hz: c.z,
    sx2: Math.cos(settledA) * settledR,
    sy2: R.bottom + 0.28 + (1 - sizeN) * 0.14,
    sz2: Math.sin(settledA) * settledR,
    vx: 0, vy: 0, vz: 0,
    sizeN,
    sx: kind === 'suspension' ? 0.75 + ((i * 0.37) % 1) * 0.7 : 1,
    sy: kind === 'suspension' ? 0.7 + ((i * 0.53) % 1) * 0.55 : 1,
    sz: kind === 'suspension' ? 0.75 + ((i * 0.91) % 1) * 0.6 : 1,
    rx: kind === 'suspension' ? i * 0.7 : 0,
    ry: i * 0.4,
    rz: kind === 'suspension' ? i * 0.5 : 0,
    spin: 0.4 + sizeN * 1.6,
  };
}

function sampleCylinder(i, n, radius, y0, y1) {
  const u = (i * 0.61803398875 + 0.17) % 1;
  const v = (i * 0.7548776662 + 0.31) % 1;
  const w = (i * 0.5698402909 + 0.09) % 1;
  const rad = radius * Math.sqrt(v);
  const ang = w * Math.PI * 2;
  return {
    x: Math.cos(ang) * rad,
    y: y0 + ((i + 0.5) / n) * 0.15 * (y1 - y0) + u * 0.85 * (y1 - y0),
    z: Math.sin(ang) * rad,
  };
}

function displayRadius(kind, p, mag) {
  if (kind === 'solution') return lerp(0.0045, 0.034, mag);
  if (kind === 'colloid') return lerp(0.016, 0.055, mag);
  return lerp(0.05 + p.sizeN * 0.06, 0.062 + p.sizeN * 0.075, mag);
}

function updateSolution(parts, time) {
  for (const p of parts) {
    p.x = p.hx + Math.sin(time * 1.3 + p.hy * 8) * 0.006;
    p.z = p.hz + Math.cos(time * 1.1 + p.hx * 8) * 0.006;
    p.y = p.hy + Math.sin(time * 1.6 + p.hz * 9) * 0.006;
  }
}

function updateColloid(parts, dt, state) {
  const damp = Math.pow(0.12, dt);
  const confineR = R.inner - 0.1;
  const y0 = R.bottom + 0.07;
  const y1 = R.bottom + R.liquid - 0.07;
  const boost = state.stirring > 0 ? 1.8 : 1;
  for (const p of parts) {
    p.vx += (Math.random() - 0.5) * 1.8 * boost * dt * 60 * 0.016;
    p.vy += (Math.random() - 0.5) * 1.8 * boost * dt * 60 * 0.016;
    p.vz += (Math.random() - 0.5) * 1.8 * boost * dt * 60 * 0.016;
    p.vx += (p.hx - p.x) * 0.55 * dt;
    p.vy += (p.hy - p.y) * 0.55 * dt;
    p.vz += (p.hz - p.z) * 0.55 * dt;
    p.vx *= damp; p.vy *= damp; p.vz *= damp;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const r = Math.hypot(p.x, p.z);
    if (r > confineR) {
      p.x *= confineR / r; p.z *= confineR / r;
      p.vx *= -0.4; p.vz *= -0.4;
    }
    if (p.y < y0) { p.y = y0; p.vy *= -0.4; }
    if (p.y > y1) { p.y = y1; p.vy *= -0.4; }
  }
}

function updateSuspension(parts, dt, state) {
  const s = state.settle;
  const stirring = state.stirring > 0;
  const y0 = R.bottom + 0.06;
  const y1 = R.bottom + R.liquid - 0.08;
  for (const p of parts) {
    const rate = 0.4 + p.sizeN * p.sizeN * 2.1;
    const prog = stirring ? 0 : (1 - Math.exp(-s * rate * 2.6));
    const tx = lerp(p.mx, p.sx2, prog);
    const ty = lerp(p.my, p.sy2, prog);
    const tz = lerp(p.mz, p.sz2, prog);
    if (stirring) {
      const ang = Math.atan2(p.z, p.x) + dt * 6.2;
      const rad = Math.min(R.inner - 0.12, Math.hypot(p.x, p.z) * 0.98 + 0.01);
      const mix = clamp(state.stirring / 1.65, 0, 1);
      const swirlX = Math.cos(ang) * Math.max(0.08, rad);
      const swirlZ = Math.sin(ang) * Math.max(0.08, rad);
      p.x = lerp(swirlX, p.mx, 1 - mix);
      p.z = lerp(swirlZ, p.mz, 1 - mix);
      p.y = lerp(p.y, p.my, 1 - Math.pow(0.08, dt));
    } else {
      p.x = tx; p.y = ty; p.z = tz;
    }
    p.y = clamp(p.y, y0, y1);
    p.ry += dt * p.spin * (1 - prog);
    p.rx += dt * p.spin * 0.6 * (1 - prog);
  }
}

function buildBeam(scene, camera) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const planes = [];
  function make(x0, x1) {
    const len = Math.max(0.001, x1 - x0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(1, 0.22, 0.26) },
        uOpacity: { value: 1 },
        uTight: { value: 10 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTight;
        void main() {
          float d = abs(vUv.y - 0.5) * 2.0;
          float core = exp(-uTight * d * d);
          float ends = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
          gl_FragColor = vec4(uColor, core * ends * uOpacity);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2, BEAM_Y, 0);
    mesh.scale.set(len, 0.04, 1);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    scene.add(mesh);
    const rec = { mesh, mat, len };
    planes.push(rec);
    return rec;
  }

  // One beam through all three. It is drawn as a soft streak that faces the camera.
  // Inside a true solution the streak is omitted: light passes, it does not scatter.
  const air = [];
  air.push(make(-4.55, XS[0] - R.outer + 0.02));
  air.push(make(XS[0] + R.outer - 0.02, XS[1] - R.outer + 0.02));
  const colloid = make(XS[1] - R.inner + 0.05, XS[1] + R.inner - 0.05);
  const colloidCore = make(XS[1] - R.inner + 0.05, XS[1] + R.inner - 0.05);
  air.push(make(XS[1] + R.outer - 0.02, XS[2] - R.outer + 0.02));
  const suspension = make(XS[2] - R.inner + 0.05, XS[2] + R.inner - 0.05);
  const suspensionCore = make(XS[2] - R.inner + 0.05, XS[2] + R.inner - 0.05);

  const glintGeo = new THREE.SphereGeometry(1, 16, 12);
  const glintMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  glintMat.color.setRGB(1, 0.82, 0.84);
  const solutionExit = new THREE.Mesh(glintGeo, glintMat);
  solutionExit.scale.setScalar(0.045);
  solutionExit.position.set(XS[0] + R.inner - 0.02, BEAM_Y, 0);
  scene.add(solutionExit);
  const solutionEntry = new THREE.Mesh(glintGeo, glintMat);
  solutionEntry.position.set(XS[0] - R.inner + 0.02, BEAM_Y, 0);
  scene.add(solutionEntry);

  const exitMat = glintMat.clone();
  exitMat.color.setRGB(1, 0.45, 0.48);
  const farExit = new THREE.Mesh(glintGeo, exitMat);
  farExit.position.set(XS[2] + R.outer + 0.02, BEAM_Y, 0);
  scene.add(farExit);

  const housing = buildLaserHousing();
  housing.position.set(-4.85, BEAM_Y, 0);
  scene.add(housing);

  const colloidLight = new THREE.PointLight(0xff3355, 0, 2.4, 2);
  colloidLight.position.set(XS[1], BEAM_Y, 0);
  scene.add(colloidLight);
  const suspLight = new THREE.PointLight(0xff5533, 0, 2.2, 2);
  suspLight.position.set(XS[2], BEAM_Y, 0.05);
  scene.add(suspLight);

  function aim(mesh) {
    const ny = camera.position.y - mesh.position.y;
    const nz = camera.position.z - mesh.position.z;
    mesh.rotation.x = Math.atan2(-ny, nz);
  }
  function style(seg, height, opacity, tight, r, g, b) {
    seg.mesh.visible = opacity > 0.01 && height > 0.001;
    seg.mesh.scale.y = height;
    seg.mat.uniforms.uOpacity.value = opacity;
    seg.mat.uniforms.uTight.value = tight;
    seg.mat.uniforms.uColor.value.setRGB(r, g, b);
    aim(seg.mesh);
  }

  return {
    update(state, turb) {
      const on = state.laser;
      const lens = housing.userData.lens;
      lens.material.color.setRGB(on ? 1 : 0.15, on ? 0.1 : 0.04, on ? 0.12 : 0.04);
      const airH = on ? 0.045 : 0;
      air.forEach(seg => style(seg, airH, on ? 0.85 : 0, 16, 1, 0.16, 0.18));
      solutionExit.visible = on;
      solutionEntry.visible = on;
      const dot = on ? 0.07 : 0.001;
      solutionExit.scale.setScalar(dot);
      solutionEntry.scale.setScalar(dot * 0.75);

      const wobble = 1 + Math.sin(state.time * 5) * 0.05;
      style(colloid, on ? 0.26 : 0, on ? 0.75 * wobble : 0, 5.5, 1, 0.28, 0.32);
      style(colloidCore, on ? 0.07 : 0, on ? 0.95 : 0, 18, 1, 0.72, 0.74);
      style(suspension, on ? lerp(0.05, 0.24, turb) : 0, on ? lerp(0.2, 0.8, turb) : 0, 5.5, 1, 0.32, 0.24);
      style(suspensionCore, on ? lerp(0.02, 0.07, turb) : 0, on ? lerp(0.25, 0.9, turb) : 0, 16, 1, 0.7, 0.62);

      const far = on ? lerp(0.055, 0.028, turb) : 0.001;
      farExit.visible = on;
      farExit.scale.setScalar(far);
      colloidLight.intensity = on ? 1.1 : 0;
      suspLight.intensity = on ? 0.9 * turb : 0;
    },
  };
}

function buildLaserHousing() {
  const g = new THREE.Group();
  const metal = new THREE.MeshPhysicalMaterial({ color: 0xd5dbe4, metalness: 0.9, roughness: 0.24, clearcoat: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.45, metalness: 0.4 });
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, BEAM_Y, 12), metal);
  stand.position.set(0, -BEAM_Y / 2, 0);
  g.add(stand);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 20), dark);
  foot.position.y = -BEAM_Y + 0.02;
  g.add(foot);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.46, 20), dark);
  body.rotation.z = Math.PI / 2;
  body.position.x = 0.05;
  g.add(body);
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 16, 12),
    new THREE.MeshBasicMaterial({ toneMapped: false })
  );
  lens.material.color.setRGB(1, 0.12, 0.14);
  lens.position.x = 0.3;
  g.add(lens);
  g.userData.lens = lens;
  return g;
}

function makeGraduationTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 512);
  g.strokeStyle = 'rgba(230, 242, 255, 0.85)';
  g.fillStyle = 'rgba(230, 242, 255, 0.9)';
  g.lineWidth = 2;
  g.font = '600 28px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const marks = [0.22, 0.40, 0.58, 0.76];
  const labels = ['40', '80', '120', '160'];
  marks.forEach((t, i) => {
    const y = 512 - t * 512;
    g.beginPath();
    g.moveTo(150, y);
    g.lineTo(i % 2 === 0 ? 230 : 200, y);
    g.stroke();
    if (i % 2 === 0) g.fillText(labels[i], 24, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(128, 128, 30, 128, 128, 120);
  rg.addColorStop(0, 'rgba(0,0,0,0.45)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBenchTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#161b27';
  g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = 'rgba(255,255,255,0.028)';
  g.lineWidth = 1;
  for (let x = 0; x <= 1024; x += 64) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke();
  }
  for (let y = 0; y <= 512; y += 64) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke();
  }
  const lg = g.createLinearGradient(0, 0, 0, 512);
  lg.addColorStop(0, 'rgba(255,255,255,0.05)');
  lg.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.fillStyle = lg;
  g.fillRect(0, 0, 1024, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function wireUI(state, api) {
  const playBtn = $('playBtn');
  const slider = $('settle');
  const out = $('settleOut');
  const laser = $('tLaser');
  const mag = $('tMag');
  const lesson = $('lesson');
  const cmp = $('cmp');
  const magnote = $('magnote');
  laser.checked = state.laser;
  mag.checked = state.magTarget > 0.5;

  const paint = () => {
    const min = +slider.min, max = +slider.max;
    slider.style.setProperty('--p', ((+slider.value - min) / (max - min) * 100) + '%');
  };
  slider.addEventListener('input', () => {
    state.playing = false;
    state.stirring = 0;
    state.settle = +slider.value;
    paint();
  });
  $('stirBtn').addEventListener('click', () => api.stir());
  $('frameBtn').addEventListener('click', () => { state.userMoved = false; api.goHome(true); });
  laser.addEventListener('change', () => { state.laser = laser.checked; });
  mag.addEventListener('change', () => { state.magTarget = mag.checked ? 1 : 0; });

  document.querySelectorAll('[data-collapse]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.panel');
      panel.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', panel.classList.contains('collapsed') ? 'false' : 'true');
    });
  });
  if (matchMedia('(max-width: 900px)').matches) {
    const cmpPanel = $('compare');
    cmpPanel.classList.add('collapsed');
    cmpPanel.querySelector('.panel-head').setAttribute('aria-expanded', 'false');
  }

  function settleLabel(s) {
    if (state.stirring > 0) return 'Stirring';
    if (s < 0.04) return 'Just mixed';
    if (s > 0.97) return 'Settled';
    return `Settling ${Math.round(s * 100)}%`;
  }
  function lessonText() {
    if (state.magnify > 0.55) {
      return 'Magnified view. Blue and amber specks are dissolved ions. White spheres are colloid particles. The large grains are the suspension — and only those sink.';
    }
    if (state.stirring > 0) {
      return 'Stirring lifts the suspension back into the liquid. The solution and the colloid were already evenly dispersed.';
    }
    if (state.laser && state.settle > 0.82) {
      return 'The suspension has settled. Its clear liquid barely scatters the beam now. The colloid still glows (Tyndall effect). The solution never shows a path.';
    }
    if (state.laser && state.settle > 0.12) {
      return 'Watch the large grains sink. Colloid particles only jitter, and the solution stays clear. The beam is visible where particles scatter it.';
    }
    if (state.laser) {
      return 'One beam, three mixtures. It vanishes in the solution, glows through the milky colloid, and scatters in the cloudy suspension.';
    }
    return 'Turn on the light beam to see the Tyndall effect. Press Play to watch only the suspension settle.';
  }

  let lastLesson = '';
  function sync() {
    playBtn.textContent = state.playing ? '❚❚ Pause' : (state.settle >= 0.995 ? '▶ Replay' : '▶ Play');
    playBtn.classList.toggle('primary', state.playing || state.settle >= 0.995);
    playBtn.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
    laser.checked = state.laser;
    mag.checked = state.magTarget > 0.5;
    if (document.activeElement !== slider) {
      slider.value = String(state.settle);
      paint();
    }
    out.textContent = settleLabel(state.settle);
    const text = lessonText();
    if (text !== lastLesson) { lesson.textContent = text; lastLesson = text; }
    magnote.classList.toggle('show', state.magnify > 0.45);
    cmp.classList.toggle('on-solution', state.focus === 'solution');
    cmp.classList.toggle('on-colloid', state.focus === 'colloid');
    cmp.classList.toggle('on-suspension', state.focus === 'suspension');
  }
  sync();
  return { sync, playBtn };
}

try {
  boot();
} catch (err) {
  console.error(err);
  const el = $('loading');
  if (el) {
    el.classList.remove('done');
    const p = el.querySelector('p');
    if (p) p.textContent = 'This visualization needs WebGL.';
  }
}
