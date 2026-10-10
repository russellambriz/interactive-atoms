// Entry point: renderer, post-processing, camera, input, UI wiring, demos.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { World } from './world.js';
import { createBackground } from './background.js';
import { ELEMENTS, PARTICLES, ANGSTROM, bondLengthA, bondEnergy, subscript } from './data.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches;

// ------------------------------------------------------------------ renderer
const container = $('app');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const maxPixelRatio = pixelRatio;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.className = 'labels';
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 2000);
const HOME_POS = new THREE.Vector3(5.2, 3.6, 10.2);
camera.position.copy(HOME_POS);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x1a0f2e, 0.35));
const key = new THREE.DirectionalLight(0xfff1e0, 1.5); key.position.set(6, 9, 7); scene.add(key);
const rim = new THREE.DirectionalLight(0x6fb8ff, 1.3); rim.position.set(-8, -2, -9); scene.add(rim);
const fill = new THREE.DirectionalLight(0xc59bff, 0.6); fill.position.set(-6, 4, 6); scene.add(fill);

const bg = createBackground(scene);

// post-processing: MSAA HDR target → bloom → tone map / sRGB
const rt = new THREE.WebGLRenderTarget(innerWidth * pixelRatio, innerHeight * pixelRatio, {
  type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0
});
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------------ world + input
const world = new World(scene, camera);
world.pixelRatio = pixelRatio;
const canvas = renderer.domElement;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const tmpV = new THREE.Vector3();
let hoverPending = null, lastPointer = null;

function setNdc(ev) { ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); }

// must be registered BEFORE OrbitControls so we can veto orbiting when a nucleus is grabbed
canvas.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  if (world.drag) return;
  setNdc(ev);
  const hit = world.pick(raycaster.ray);
  let atom = hit && (hit.kind === 'proton' || hit.kind === 'neutron') ? hit.atom : null;
  if (!atom) atom = world.pickAtomScreen(ev.clientX, ev.clientY, camera, innerWidth, innerHeight, ev.pointerType === 'touch' ? 36 : 20);
  if (atom) {
    controls.enabled = false;
    selectAtom(atom);
    camera.getWorldDirection(tmpV);
    dragPlane.setFromNormalAndCoplanarPoint(tmpV, atom.pos);
    const p = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, p);
    world.drag = { atom, target: atom.pos.clone(), offset: atom.pos.clone().sub(p || atom.pos), id: ev.pointerId };
    canvas.setPointerCapture(ev.pointerId);
    canvas.style.cursor = 'grabbing';
    hideTooltip();
    ev.stopPropagation();
  } else if (hit && ev.pointerType !== 'mouse') {
    showTooltip(hit, ev.clientX, ev.clientY); clearTimeout(hideTooltip.t); hideTooltip.t = setTimeout(hideTooltip, 2600);
  }
}, { capture: true });

canvas.addEventListener('pointermove', ev => {
  lastPointer = ev;
  if (world.drag && ev.pointerId === world.drag.id) {
    setNdc(ev);
    const p = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, p)) world.drag.target.copy(p.add(world.drag.offset));
    return;
  }
  if (ev.pointerType === 'mouse') hoverPending = ev;
});
const endDrag = ev => {
  if (world.drag && ev.pointerId === world.drag.id) {
    world.drag = null; controls.enabled = true; canvas.style.cursor = '';
    try { canvas.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { if (!world.drag) hideTooltip(); });

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.07;
controls.rotateSpeed = 0.75; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
controls.minDistance = 1.0; controls.maxDistance = 90;
controls.target.set(0, 0, 0);
controls.addEventListener('start', () => { tween = null; });

// ------------------------------------------------------------------ camera tweens
let tween = null;
function flyTo(target, pos, dur = 1.2) {
  tween = { t: 0, dur, fromT: controls.target.clone(), toT: target.clone(), fromP: camera.position.clone(), toP: pos.clone() };
}
function frameAll(dur = 1.2) {
  if (!world.atoms.length) return flyTo(new THREE.Vector3(), HOME_POS, dur);
  const box = new THREE.Box3(); for (const a of world.atoms) box.expandByPoint(a.pos);
  const c = box.getCenter(new THREE.Vector3()); let r = 0; for (const a of world.atoms) r = Math.max(r, a.pos.distanceTo(c) + a.size + 0.6);
  const fov = THREE.MathUtils.degToRad(camera.fov); const aspect = Math.min(1, camera.aspect);
  const dist = Math.max(8, r / Math.sin(fov / 2) / Math.max(0.55, aspect) * 0.95);
  const dir = HOME_POS.clone().normalize();
  flyTo(c, c.clone().addScaledVector(dir, dist), dur);
}
function zoomNucleus() {
  const a = world.selected || world.atoms[0]; if (!a) return;
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyTo(a.pos, a.pos.clone().addScaledVector(dir, Math.max(1.6, a.nucleusRadius * 4.2)), 1.4);
}

// ------------------------------------------------------------------ UI wiring
function setRangeFill(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }
const speedEl = $('speed'), heatEl = $('heat');
function setSpeed(v) { world.params.speed = +v; speedEl.value = v; $('speedOut').textContent = (+v).toFixed(2) + '×'; setRangeFill(speedEl); }
function tempLabel(h) { const K = Math.round(300 + h * 5700); return K + ' K' + (h < 0.02 ? ' · room' : h > 0.75 ? ' · plasma-hot' : h > 0.45 ? ' · bonds breaking' : ''); }
function setHeat(v) { world.params.heat = +v; heatEl.value = v; $('heatOut').textContent = tempLabel(+v); setRangeFill(heatEl); }
speedEl.addEventListener('input', () => setSpeed(speedEl.value));
heatEl.addEventListener('input', () => setHeat(heatEl.value));

function setPlaying(on) { world.params.playing = on; $('playBtn').innerHTML = on ? '❚❚ Pause' : '▶ Play'; }
$('playBtn').onclick = () => setPlaying(!world.params.playing);
$('resetCam').onclick = () => frameAll();
$('zoomNucleus').onclick = zoomNucleus;
$('breakBtn').onclick = () => { world.breakAll(); };
$('removeBtn').onclick = () => { if (world.selected && world.atoms.length > 1) world.remove(world.selected); };
$('resetBtn').onclick = () => loadDemo('carbon');

const toggles = { tLabels: 'labels', tShells: 'shells', tTrails: 'trails', tClouds: 'clouds', tAssist: 'assist' };
for (const [id, key] of Object.entries(toggles)) $(id).addEventListener('change', e => { world.params[key] = e.target.checked; });
let follow = false; $('tFollow').addEventListener('change', e => { follow = e.target.checked; });

function setView(v) {
  world.params.view = v;
  document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('legend').classList.toggle('show', v === 'quantum');
}
document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => setView(b.dataset.view));
function setHighlight(h) {
  world.params.highlight = h;
  document.querySelectorAll('#hlSeg button').forEach(b => b.classList.toggle('on', b.dataset.hl === h));
}
document.querySelectorAll('#hlSeg button').forEach(b => b.onclick = () => setHighlight(b.dataset.hl));

document.querySelectorAll('[data-collapse]').forEach(h => h.onclick = () => $(h.dataset.collapse).classList.toggle('collapsed'));
if (innerWidth < 720) { $('info').classList.add('collapsed'); $('controls').classList.add('collapsed'); }

document.querySelectorAll('[data-spawn]').forEach(b => b.onclick = () => spawn(b.dataset.spawn));
$('demoSel').addEventListener('change', e => { if (e.target.value) loadDemo(e.target.value); e.target.value = ''; e.target.blur(); });

function spawn(sym) {
  const a = world.spawn(sym);
  if (!a) return toast('Atom limit reached (32)', 'break');
  a.vel.set(0, 0, 0);
  ensureVisible();
  return a;
}
function ensureVisible() {
  // if the scene grew beyond the view, gently re-frame
  const box = new THREE.Box3(); for (const a of world.atoms) box.expandByPoint(a.pos);
  const r = box.getSize(new THREE.Vector3()).length() / 2 + 3;
  if (camera.position.distanceTo(controls.target) < r * 1.9) frameAll(1.0);
}

function selectAtom(a) { world.selected = a; updateInfo(); }

// ------------------------------------------------------------------ info / status
function updateInfo() {
  const a = world.selected; if (!a) return;
  const el = a.el;
  $('elTile').className = 'el-tile el-' + a.sym;
  $('elSym').textContent = a.sym; $('elZ').textContent = el.Z; $('elMass').textContent = el.mass.toFixed(3);
  $('elName').textContent = el.name; $('elConfig').textContent = el.configText; $('elValence').textContent = el.valence;
  $('elBonds').textContent = `${el.valence - a.freeValence} / ${el.valence}`;
  $('elP').textContent = el.Z; $('elN').textContent = el.N; $('elE').textContent = el.Z;
  $('elEN').textContent = el.en.toFixed(2); $('elHyb').textContent = a.hybridization;
  $('elFacts').innerHTML = el.facts.map(f => `<li>${f}</li>`).join('');
  updateAngles();
  const mols = world.molecules || [];
  $('molList').innerHTML = mols.map((m, i) => `<li data-i="${i}" class="${m.atoms.includes(a) ? 'sel' : ''} ${m.free > 0 && m.atoms.length > 1 ? 'radical' : ''}"><b>${m.html}</b><span>${m.name}</span><em>${m.shape}</em></li>`).join('');
  $('molList').querySelectorAll('li').forEach(li => li.onclick = () => { const m = mols[+li.dataset.i]; const c = m.atoms.find(x => x.sym === 'C') || m.atoms[0]; selectAtom(c); });
  const m = a.molecule;
  if (m) { $('statusFormula').innerHTML = m.html; $('statusName').textContent = m.name; $('statusShape').textContent = m.shape; }
}
function updateAngles() {
  const a = world.selected; if (!a) return;
  const ang = world.measuredAngles(a);
  $('elAngle').textContent = ang.length ? `${(ang.reduce((s, x) => s + x, 0) / ang.length).toFixed(1)}° (ideal ${a.targetAngle}°)` : '—';
}
let prevMolKeys = new Set();
world.onChange = () => {
  updateInfo();
  const keys = new Set();
  for (const m of world.molecules) {
    if (m.atoms.length > 1 && m.free === 0) {
      const k = m.hill + ':' + m.atoms.map(x => x.id).sort().join(',');
      keys.add(k);
      if (!prevMolKeys.has(k) && !loadingDemo) {
        toast(`✦ ${m.html} — ${m.name} formed`, 'mol');
        $('status').classList.add('pop'); setTimeout(() => $('status').classList.remove('pop'), 900);
      }
    }
  }
  prevMolKeys = keys;
};
function processEvents() {
  for (const ev of world.events.splice(0)) {
    if (loadingDemo) continue;
    if (ev.type === 'form') {
      const b = ev.bond; const sym = ['', '–', '=', '≡'][b.order] || '–';
      toast(`Bond formed: ${b.a.sym}${sym}${b.b.sym}`);
    } else if (ev.type === 'break') toast(`Bond broken: ${ev.a.sym} · ${ev.b.sym}`, 'break');
  }
}
let toastCount = 0;
function toast(html, cls = '') {
  const box = $('toasts'); if (box.children.length > 3) box.firstChild.remove();
  const d = document.createElement('div'); d.className = 'toast ' + cls; d.innerHTML = html; box.appendChild(d);
  toastCount++; setTimeout(() => d.remove(), 3000);
}

// ------------------------------------------------------------------ tooltip
const tip = $('tooltip');
function hideTooltip() { tip.classList.remove('show'); }
const ORDER_NAME = ['', 'single bond (σ)', 'double bond (σ + π)', 'triple bond (σ + 2π)'];
function showTooltip(hit, x, y) {
  let h = '';
  if (hit.kind === 'proton' || hit.kind === 'neutron') {
    const P = PARTICLES[hit.kind], a = hit.atom;
    h = `<h4><b class="dot ${hit.kind[0]}"></b>${P.name} ${P.sym}</h4><p>Charge ${P.charge} · mass ${P.mass}</p><p>${P.extra}</p>
      <p class="dim">In ${a.el.name} nucleus: ${a.el.Z} p⁺ + ${a.el.N} n⁰ (${a.el.Z + a.el.N}${a.sym}). Held by the strong nuclear force. Drag to move the atom.</p>`;
  } else if (hit.kind === 'electron') {
    const e = hit.electron, a = hit.atom, P = PARTICLES.electron;
    const n = e.orbital[0], l = e.orbital[1] === 's' ? 0 : 1;
    let state = `Orbiting ${a.el.name} in the n=${n} shell`;
    if (e.bond) { const o = e.bond.a === a ? e.bond.b : e.bond.a; state = `Shared with ${o.el.name}: ${e.slot === 0 ? 'σ' : 'π'} bonding pair (${a.sym}–${o.sym})`; }
    h = `<h4><b class="dot e"></b>Electron e⁻</h4><p>Orbital <b>${e.orbital.replace(/p([xyz])/, 'p<sub>$1</sub>')}</b> · n=${n}, ℓ=${l}, spin ${e.spin}</p>
      <p>${state}</p><p class="dim">Charge ${P.charge} · mass ${P.mass}</p>`;
  } else if (hit.kind === 'bond') {
    const b = hit.bond; const L = bondLengthA(b.a.sym, b.b.sym, b.order);
    const sym = ['', '–', '=', '≡'][b.order];
    const dEN = Math.abs(b.a.el.en - b.b.el.en);
    h = `<h4>${b.a.sym}${sym}${b.b.sym} ${ORDER_NAME[b.order]}</h4><p>${b.order * 2} shared electrons · length ≈ ${L.toFixed(2)} Å</p>
      <p>Bond energy ≈ ${bondEnergy(b.a.sym, b.b.sym, b.order)} kJ/mol</p><p class="dim">ΔEN = ${dEN.toFixed(2)} → ${dEN < 0.4 ? 'nonpolar covalent' : 'polar covalent'}</p>`;
  }
  if (!h) return hideTooltip();
  tip.innerHTML = h; tip.classList.add('show');
  const w = tip.offsetWidth, hh = tip.offsetHeight;
  tip.style.left = Math.min(innerWidth - w - 8, x + 16) + 'px';
  tip.style.top = Math.min(innerHeight - hh - 8, y + 16) + 'px';
}
function processHover() {
  if (!hoverPending || world.drag) return;
  const ev = hoverPending; hoverPending = null;
  setNdc(ev);
  const hit = world.pick(raycaster.ray);
  const grab = world.pickAtomScreen(ev.clientX, ev.clientY, camera, innerWidth, innerHeight, 20);
  canvas.style.cursor = (hit && hit.kind !== 'bond' && hit.kind !== 'electron') || grab ? 'grab' : hit ? 'help' : '';
  if (hit) showTooltip(hit, ev.clientX, ev.clientY); else hideTooltip();
}

// ------------------------------------------------------------------ keyboard
const keys = new Set();
addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault(); return; }
  if (k === ' ') { setPlaying(!world.params.playing); e.preventDefault(); }
  else if (k === 'v') setView(world.params.view === 'bohr' ? 'quantum' : 'bohr');
  else if (k === 'l') { $('tLabels').click(); }
  else if (k === 'b') world.breakAll();
  else if (k === 'f') frameAll();
  else if (k === 'n') zoomNucleus();
  else if (k === 'r' && e.shiftKey) loadDemo('carbon');
  else if (k === 'delete' || k === 'backspace') $('removeBtn').click();
  else if (k === 'tab' && world.atoms.length) { e.preventDefault(); const i = world.atoms.indexOf(world.selected); selectAtom(world.atoms[(i + 1) % world.atoms.length]); }
  else if (['1', '2', '3', '4'].includes(k)) spawn(['H', 'C', 'N', 'O'][+k - 1]);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
function processKeys(dt) {
  const a = world.selected;
  if (!keys.size || !a) { world.kbd = null; return; }
  if (!world.kbd || world.kbd.atom !== a) world.kbd = { atom: a, target: a.pos.clone() };
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const d = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) d.add(up);
  if (keys.has('s') || keys.has('arrowdown')) d.sub(up);
  if (keys.has('d') || keys.has('arrowright')) d.add(right);
  if (keys.has('a') || keys.has('arrowleft')) d.sub(right);
  if (keys.has('e')) d.add(fwd);
  if (keys.has('q')) d.sub(fwd);
  if (d.lengthSq() > 0) d.normalize();
  const t = world.kbd.target.addScaledVector(d, dt * 9);
  const off = t.clone().sub(a.pos); if (off.length() > 2.5) t.copy(a.pos).add(off.setLength(2.5));
}

// ------------------------------------------------------------------ demos
let loadingDemo = false;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function len(a, b, o = 1) { return bondLengthA(a, b, o) * ANGSTROM; }
const TETRA = [V(1, 1, 1), V(1, -1, -1), V(-1, 1, -1), V(-1, -1, 1)].map(v => v.normalize());
function tetraAround(axis) {
  // 3 directions at 109.5° from `axis`
  const a = axis.clone().normalize();
  const p = Math.abs(a.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  const u = p.clone().cross(a).normalize(), w = a.clone().cross(u);
  const out = [], c = Math.cos(THREE.MathUtils.degToRad(109.47)), s = Math.sin(THREE.MathUtils.degToRad(109.47));
  for (let k = 0; k < 3; k++) { const ph = k * 2 * Math.PI / 3 + (axis.x < 0 ? Math.PI / 3 : 0); out.push(a.clone().multiplyScalar(c).addScaledVector(u, s * Math.cos(ph)).addScaledVector(w, s * Math.sin(ph))); }
  return out;
}
function loadDemo(name) {
  loadingDemo = true;
  world.clear(); world.selected = null;
  const S = (sym, p) => world.spawn(sym, p, { select: false });
  const B = (a, b, o = 1) => world.formBond(a, b, o, true);
  let sel = null;
  switch (name) {
    case 'ch4': { const c = S('C', V(0, 0, 0)); TETRA.forEach(d => B(c, S('H', d.clone().multiplyScalar(len('C', 'H'))))); sel = c; break; }
    case 'co2': { const c = S('C', V(0, 0, 0)); const r = len('C', 'O', 2); B(c, S('O', V(-r, 0, 0)), 2); B(c, S('O', V(r, 0, 0)), 2); sel = c; break; }
    case 'co': { const r = len('C', 'O', 2); const c = S('C', V(-r / 2, 0, 0)); B(c, S('O', V(r / 2, 0, 0)), 2); sel = c; break; }
    case 'c2h6': {
      const r = len('C', 'C'); const c1 = S('C', V(-r / 2, 0, 0)), c2 = S('C', V(r / 2, 0, 0)); B(c1, c2);
      tetraAround(V(-1, 0, 0)).forEach(d => B(c1, S('H', c1.pos.clone().addScaledVector(d, len('C', 'H')))));
      tetraAround(V(1, 0, 0)).forEach(d => B(c2, S('H', c2.pos.clone().addScaledVector(d, len('C', 'H')))));
      sel = c1; break;
    }
    case 'c2h4': {
      const r = len('C', 'C', 2); const c1 = S('C', V(-r / 2, 0, 0)), c2 = S('C', V(r / 2, 0, 0)); B(c1, c2, 2);
      const h = len('C', 'H'), a = THREE.MathUtils.degToRad(60);
      for (const [c, sx] of [[c1, -1], [c2, 1]]) for (const sy of [-1, 1]) B(c, S('H', c.pos.clone().add(V(sx * Math.cos(a) * h, sy * Math.sin(a) * h, 0))));
      sel = c1; break;
    }
    case 'c2h2': {
      const r = len('C', 'C', 3), h = len('C', 'H'); const c1 = S('C', V(-r / 2, 0, 0)), c2 = S('C', V(r / 2, 0, 0)); B(c1, c2, 3);
      B(c1, S('H', V(-r / 2 - h, 0, 0))); B(c2, S('H', V(r / 2 + h, 0, 0))); sel = c1; break;
    }
    case 'hcn': {
      const h = len('C', 'H'), r = len('C', 'N', 3); const c = S('C', V(0, 0, 0)); B(c, S('H', V(-h, 0, 0))); B(c, S('N', V(r, 0, 0)), 3); sel = c; break;
    }
    case 'h2o': {
      const o = S('O', V(0, 0, 0)), r = len('O', 'H'), a = THREE.MathUtils.degToRad(104.5 / 2);
      B(o, S('H', V(Math.sin(a) * r, -Math.cos(a) * r, 0))); B(o, S('H', V(-Math.sin(a) * r, -Math.cos(a) * r, 0))); sel = o; break;
    }
    case 'nh3': {
      const n = S('N', V(0, 0, 0)), r = len('N', 'H'), th = THREE.MathUtils.degToRad(68.2);
      for (let k = 0; k < 3; k++) { const ph = k * 2 * Math.PI / 3; B(n, S('H', V(Math.sin(th) * Math.cos(ph) * r, -Math.cos(th) * r, Math.sin(th) * Math.sin(ph) * r))); }
      sel = n; break;
    }
    case 'ch3oh': {
      const c = S('C', V(0, 0, 0)); const o = S('O', TETRA[0].clone().multiplyScalar(len('C', 'O'))); B(c, o);
      TETRA.slice(1).forEach(d => B(c, S('H', d.clone().multiplyScalar(len('C', 'H')))));
      const dir = tetraAround(TETRA[0].clone().negate())[0];
      B(o, S('H', o.pos.clone().addScaledVector(dir, len('O', 'H')))); sel = c; break;
    }
    case 'sandbox': {
      sel = S('C', V(0, 0, 0));
      [V(-9, 4, 0), V(9, 4, 1), V(-8, -5, -1), V(8, -5, 0)].forEach(p => S('H', p));
      S('O', V(0, 10, -1)); S('O', V(0, -10.5, 1));
      break;
    }
    default: sel = S('C', V(0, 0, 0));
  }
  world.selected = sel;
  world._topologyChanged();
  world.events.length = 0;
  loadingDemo = false;
  prevMolKeys = new Set(world.molecules.filter(m => m.atoms.length > 1 && m.free === 0).map(m => m.hill + ':' + m.atoms.map(x => x.id).sort().join(',')));
  updateInfo();
  if (name !== 'carbon' && name) { frameAll(0.9); const m = sel.molecule; if (m && m.atoms.length > 1) toast(`✦ ${m.html} — ${m.name}`, 'mol'); }
  else flyTo(V(0, 0, 0), HOME_POS, 0.9);
}

// ------------------------------------------------------------------ resize
function onResize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); composer.setSize(w, h); labelRenderer.setSize(w, h);
}
addEventListener('resize', onResize);
function setPixelRatio(pr) {
  pixelRatio = pr; world.pixelRatio = pr;
  renderer.setPixelRatio(pr); composer.setPixelRatio(pr); onResize();
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0, fps = 60, lowFpsTime = 0, infoTimer = 0;
const showFps = params.has('fps'); if (showFps) $('fps').style.display = 'block';

function frame() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  processKeys(dt);
  processHover();

  if (tween) {
    tween.t += dt / tween.dur; const k = tween.t >= 1 ? 1 : 1 - Math.pow(1 - tween.t, 3);
    controls.target.lerpVectors(tween.fromT, tween.toT, k); camera.position.lerpVectors(tween.fromP, tween.toP, k);
    if (tween.t >= 1) tween = null;
  } else if (follow && world.selected) {
    const d = world.selected.pos.clone().sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 3));
    controls.target.add(d); camera.position.add(d);
  }
  controls.update();

  world.update(dt, camera);
  processEvents();
  bg.update(clock.elapsedTime, camera, pixelRatio, world.params.heat);
  bloom.strength = 0.6 + world.params.heat * 0.3;
  composer.render();
  labelRenderer.render(scene, camera);

  infoTimer += dt; if (infoTimer > 0.25) { infoTimer = 0; updateAngles(); }

  // fps + adaptive resolution
  fpsAcc += rawDt; fpsFrames++;
  if (fpsAcc >= 1) {
    fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
    if (showFps) $('fps').textContent = `${fps.toFixed(0)} fps · ${pixelRatio.toFixed(2)}x`;
    if (!params.has('capture')) {
      if (fps < 45) lowFpsTime++; else lowFpsTime = 0;
      if (lowFpsTime >= 2 && pixelRatio > 1) { setPixelRatio(Math.max(1, pixelRatio - 0.25)); lowFpsTime = 0; }
      else if (fps > 58 && pixelRatio < maxPixelRatio && Math.random() < 0.05) setPixelRatio(Math.min(maxPixelRatio, pixelRatio + 0.25));
    }
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
setSpeed(params.get('speed') ?? 1);
setHeat(params.get('heat') ?? 0);
loadDemo(params.get('demo') || 'carbon');
if (params.get('view') === 'quantum') { setView('quantum'); world.viewMix = 1; }
if (params.get('labels') === '0') { $('tLabels').checked = false; world.params.labels = false; }
if (params.get('highlight')) setHighlight(params.get('highlight'));
if (params.get('paused') === '1') setPlaying(false);
if (params.get('ui') === '0') document.querySelectorAll('.glass').forEach(e => e.style.display = 'none');
tween = null;
if (params.get('demo') && params.get('demo') !== 'carbon') { frameAll(0.01); }
if (params.get('zoom') === 'nucleus') { tween = null; const a = world.selected; camera.position.copy(a.pos).add(V(1.2, 0.9, 2.2)); controls.target.copy(a.pos); }

requestAnimationFrame(frame);
requestAnimationFrame(() => setTimeout(() => $('loading').classList.add('done'), 150));

// debug / automation hook
window.atomLab = {
  world, camera, controls, loadDemo, advance: s => world.advance(s), spawn, setView, setHighlight, setHeat, setSpeed, setPlaying, frameAll,
  get fps() { return fps; },
  state: () => ({
    atoms: world.atoms.map(a => ({ id: a.id, sym: a.sym, pos: a.pos.toArray().map(v => +v.toFixed(2)), free: a.freeValence, hyb: a.hybridization })),
    bonds: world.bonds.map(b => ({ a: b.a.sym + b.a.id, b: b.b.sym + b.b.id, order: b.order, len: +(b.L / ANGSTROM).toFixed(2) })),
    molecules: world.molecules.map(m => ({ formula: m.display, name: m.name, free: m.free })),
    angles: world.selected ? world.measuredAngles(world.selected).map(x => +x.toFixed(1)) : [],
    fps: +fps.toFixed(1), pixelRatio
  })
};
