// World: atoms (nucleus + electrons + orbitals), covalent bonds, soft-body physics,
// molecule recognition, and all instanced rendering.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ELEMENTS, ANGSTROM, bondLengthA, bondEnergy, MOLECULES, subscript } from './data.js';
import { orbitalGeometry, makeCloudMaterial } from './orbitals.js';

export const MAX_ATOMS = 32;
const MAX_NUCLEONS = MAX_ATOMS * 16;
const MAX_ELECTRONS = MAX_ATOMS * 8;
const MAX_BOND_LINES = 256;
const TRAIL = 42;
export const NUCLEON_R = 0.27;
const ELECTRON_R = 0.085;
const VALENCE_E = { H: 1, C: 4, N: 5, O: 6 };
const SCALE_F = { H: 1, C: 1, N: 0.96, O: 0.92 };

const RING_DEFS = {
  '1s': { R: 1.15, w: 2.4, euler: [0.45, 0, 0.25], prec: 0.10 },
  '2s': { R: 2.35, w: 1.55, euler: [1.25, 0.3, -0.35], prec: -0.07 },
  '2px': { R: 2.75, w: 1.30, euler: [-0.6, 0, 1.05], prec: 0.06 },
  '2py': { R: 2.75, w: -1.22, euler: [0.75, 0.9, 1.2], prec: -0.05 },
  '2pz': { R: 2.75, w: 1.36, euler: [1.55, -0.5, 0.15], prec: 0.08 }
};
const RING_COLORS = {
  '1s': new THREE.Color(1.0, 0.72, 0.32), '2s': new THREE.Color(0.25, 1.0, 0.85), '2p': new THREE.Color(0.45, 0.62, 1.0)
};
const E_COLORS = {
  '1s': new THREE.Color(2.6, 2.0, 1.1), '2s': new THREE.Color(1.1, 2.8, 2.5), '2p': new THREE.Color(1.4, 1.9, 3.2),
  bond: new THREE.Color(2.4, 2.8, 3.4)
};
const GLOW_COL = {
  H: new THREE.Color(0.75, 0.85, 1.0), C: new THREE.Color(0.45, 0.95, 1.0),
  N: new THREE.Color(0.45, 0.55, 1.0), O: new THREE.Color(1.0, 0.42, 0.42)
};
const SUBSCRIPT_P = { '2px': '2p<sub>x</sub>', '2py': '2p<sub>y</sub>', '2pz': '2p<sub>z</sub>' };
const SUP = ['⁰', '¹', '²', '³', '⁴'];

export function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss() { let u = 0, v = 0; while (u === 0) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

function packNucleus(n, rand) {
  if (n === 1) return [new THREE.Vector3()];
  const pts = [];
  const R0 = NUCLEON_R * 1.6 * Math.cbrt(n);
  for (let i = 0; i < n; i++) {
    let p; do { p = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1); } while (p.lengthSq() > 1);
    pts.push(p.multiplyScalar(R0));
  }
  const min = NUCLEON_R * 2 * 0.97, tmp = new THREE.Vector3();
  for (let it = 0; it < 400; it++) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      tmp.subVectors(pts[j], pts[i]); const d = tmp.length() || 1e-4;
      if (d < min) { tmp.multiplyScalar((min - d) / d * 0.5); pts[i].sub(tmp); pts[j].add(tmp); }
    }
    for (const p of pts) p.multiplyScalar(0.985);
  }
  const c = new THREE.Vector3(); pts.forEach(p => c.add(p)); c.divideScalar(n); pts.forEach(p => p.sub(c));
  return pts;
}

function makeLabel(text, cls) {
  const div = document.createElement('div'); div.className = cls; div.innerHTML = text;
  const o = new CSS2DObject(div); o.center.set(0.5, 0.5); return o;
}

const ringGeoCache = {};
function ringGeo(R, tube) {
  const k = R.toFixed(3) + '_' + tube;
  if (!ringGeoCache[k]) { const g = new THREE.TorusGeometry(R, tube, 8, 220); g.rotateX(Math.PI / 2); ringGeoCache[k] = g; }
  return ringGeoCache[k];
}

let ATOM_ID = 0, BOND_ID = 0;

export class Atom {
  constructor(world, sym, pos) {
    this.world = world; this.sym = sym; this.el = ELEMENTS[sym]; this.id = ++ATOM_ID;
    this.pos = pos.clone(); this.vel = new THREE.Vector3(); this.force = new THREE.Vector3();
    this.mass = this.el.massPhys; this.bonds = []; this.nb = new Set(); this.molecule = null;
    this.targetAngle = 109.5; this.domains = 0; this.size = this.el.size;
    const rand = rng(this.el.Z * 7919 + 3);
    const f = SCALE_F[sym]; this.f = f;

    // ---- nucleus
    const pts = packNucleus(this.el.Z + this.el.N, rand);
    const types = [...Array(this.el.Z).fill('proton'), ...Array(this.el.N).fill('neutron')];
    for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [types[i], types[j]] = [types[j], types[i]]; }
    this.nucleons = pts.map((p, i) => ({
      type: types[i], base: p, atom: this,
      ph: [rand() * 6.28, rand() * 6.28, rand() * 6.28], fr: [3 + rand() * 3, 3 + rand() * 3, 3 + rand() * 3],
      world: new THREE.Vector3()
    }));
    this.nucleusRadius = Math.max(...pts.map(p => p.length())) + NUCLEON_R;

    this.group = new THREE.Group(); this.group.position.copy(this.pos); world.scene.add(this.group);

    // ---- shells / electrons (Bohr view)
    const occ = [];
    for (const [sub, cnt] of this.el.config) {
      if (sub === '2p') { const c = [0, 0, 0]; for (let i = 0; i < cnt; i++) c[i % 3]++; ['2px', '2py', '2pz'].forEach((k, i) => occ.push([k, c[i]])); }
      else occ.push([sub, cnt]);
    }
    this.occupancy = Object.fromEntries(occ);
    this.rings = []; this.electrons = [];
    for (const [key, count] of occ) {
      if (count === 0) continue;
      const def = RING_DEFS[key]; const sub = key.slice(0, 2);
      const R = (sym === 'H' ? 1.35 : def.R * f);
      const col = RING_COLORS[sub];
      const mat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const glowMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.22), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(ringGeo(R, 0.014), mat);
      const glow = new THREE.Mesh(ringGeo(R, 0.07), glowMat);
      const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(...def.euler));
      this.group.add(mesh, glow);
      const label = makeLabel(`${key.length > 2 ? SUBSCRIPT_P[key] : key}${SUP[count]}`, 'shell-label');
      this.group.add(label);
      const ring = { key, sub, R, w: def.w, prec: def.prec, base, q: base.clone(), mesh, glow, mat, glowMat, count, label, opacity: 0, electrons: [] };
      for (let j = 0; j < count; j++) {
        const e = {
          atom: this, ring, orbital: key, sub, j, phase0: j * Math.PI + rand() * 0.6, spin: j === 0 ? '↑' : '↓',
          bond: null, slot: 0, side: 0, trans: 1, from: new THREE.Vector3(), pos: new THREE.Vector3(),
          trail: new Float32Array(TRAIL * 3), head: 0, trailInit: false
        };
        ring.electrons.push(e); this.electrons.push(e);
      }
      this.rings.push(ring);
    }
    // valence electrons in bonding preference order: unpaired p first, then 2s, then paired p
    const val = this.electrons.filter(e => sym === 'H' || e.orbital !== '1s');
    val.sort((a, b) => (a.ring.count === 1 ? 0 : a.sub === '2s' ? 1 : 2) - (b.ring.count === 1 ? 0 : b.sub === '2s' ? 1 : 2));
    this.valenceElectrons = val;

    // ---- orbital clouds (quantum view)
    this.clouds = [];
    const kinds = sym === 'H' ? ['1s'] : ['1s', '2s', '2px', '2py', '2pz'];
    for (const k of kinds) {
      const mat = makeCloudMaterial(k);
      mat.uniforms.uScale.value = k === '1s' ? (sym === 'H' ? 0.75 : 0.42 * f) : 0.5 * f;
      const pts = new THREE.Points(orbitalGeometry(k), mat); pts.frustumCulled = false; pts.renderOrder = 2;
      this.group.add(pts);
      const o = this.occupancy[k] || 0;
      const label = makeLabel(`${k.length > 2 ? SUBSCRIPT_P[k] : k}${SUP[o]}${o === 0 ? ' <span>(empty)</span>' : ''}`, 'orbital-label');
      const L = 4.0 * f;
      const lp = { '1s': [0, -0.95, 0.6], '2s': [-2.9 * f, -2.6 * f, 0], '2px': [L, 0, 0], '2py': [0, L, 0], '2pz': [0, 0, L] }[k];
      if (sym === 'H') lp[1] = -2.4;
      label.position.set(...lp); this.group.add(label);
      this.clouds.push({ kind: k, pts, mat, occ: o, label, base: k === '1s' ? (sym === 'H' ? 0.5 : 0.45) : k === '2s' ? 0.16 : 0.55 });
    }

    // ---- element tag
    this.tag = makeLabel(`<b>${sym}</b>`, `atom-tag el-${sym}`);
    this.group.add(this.tag);
  }

  get freeValence() { let u = 0; for (const b of this.bonds) u += b.order; return this.el.valence - u; }
  get multiBond() { let best = null; for (const b of this.bonds) if (b.order > 1 && (!best || b.order > best.order)) best = b; return best; }
  get effectiveFree() { return this.freeValence + (this.multiBond ? 1 : 0); }
  get hybridization() {
    if (this.sym === 'H') return 's';
    if (this.bonds.length === 0) return 'ground state';
    return { 4: 'sp³', 3: 'sp²', 2: 'sp' }[this.domains] || '—';
  }

  dispose() {
    this.world.scene.remove(this.group);
    for (const r of this.rings) { r.mat.dispose(); r.glowMat.dispose(); }
    for (const c of this.clouds) c.mat.dispose();
    this.group.traverse(o => { if (o.isCSS2DObject) o.element.remove(); });
  }
}

function plusTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#fff2ea'; g.lineWidth = 11; g.lineCap = 'round';
  g.shadowColor = '#ffd0c0'; g.shadowBlur = 8;
  for (const x of [128]) { g.beginPath(); g.moveTo(x - 20, 128); g.lineTo(x + 20, 128); g.moveTo(x, 108); g.lineTo(x, 148); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function ringSpriteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 70, 128, 128, 126);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.55, 'rgba(160,230,255,0.0)');
  grd.addColorStop(0.75, 'rgba(160,230,255,0.9)'); grd.addColorStop(0.85, 'rgba(160,230,255,0.25)'); grd.addColorStop(1, 'rgba(160,230,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(220,250,255,0.9)'; g.lineWidth = 3; g.setLineDash([18, 14]);
  g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const bondVert = /* glsl */`
  attribute vec3 aColA; attribute vec3 aColB; attribute float aGlow;
  uniform float uRadius;
  varying vec3 vCol; varying float vGlow; varying vec3 vN; varying vec3 vV; varying float vY;
  void main() {
    vec3 p = position; p.xz *= uRadius;
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vec4 mv = viewMatrix * wp;
    vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * vec3(normal.x, 0.0, normal.z));
    vV = normalize(-mv.xyz);
    vY = position.y + 0.5;
    vCol = mix(aColA, aColB, smoothstep(0.3, 0.7, vY));
    vGlow = aGlow;
    gl_Position = projectionMatrix * mv;
  }`;
const bondFrag = /* glsl */`
  uniform float uIntensity; uniform float uPow; uniform float uOpacity;
  varying vec3 vCol; varying float vGlow; varying vec3 vN; varying vec3 vV; varying float vY;
  void main() {
    float f = abs(dot(normalize(vN), normalize(vV)));
    float a = pow(f, uPow);
    float ends = smoothstep(0.08, 0.26, vY) * smoothstep(0.92, 0.74, vY);
    gl_FragColor = vec4(vCol * a * ends * vGlow * uIntensity * uOpacity, 1.0);
  }`;

export class World {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.atoms = []; this.bonds = []; this.t = 0; this.realT = 0;
    this.params = { speed: 1, heat: 0, playing: true, labels: true, shells: true, trails: true, clouds: true, view: 'bohr', highlight: 'none', assist: true };
    this.viewMix = 0; this.selected = null; this.drag = null; this.kbd = null; this.cooldown = new Map();
    this.onChange = () => {}; this.events = [];
    this.pixelRatio = 1;
    this._tmp = { v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), c: new THREE.Color() };
    this._initRenderables();
  }

  _initRenderables() {
    const sph = new THREE.SphereGeometry(1, 40, 28);
    this.protonMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.3, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.15,
      sheen: 0.0, sheenColor: new THREE.Color(1, 0.35, 0.25), sheenRoughness: 0.5,
      emissive: 0xffffff, emissiveMap: plusTexture(), emissiveIntensity: 1.0, envMapIntensity: 0.35, transparent: true
    });
    this.neutronMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.38, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.25,
      iridescence: 0.25, envMapIntensity: 0.5, transparent: true
    });
    this.protonMesh = new THREE.InstancedMesh(sph, this.protonMat, MAX_NUCLEONS);
    this.neutronMesh = new THREE.InstancedMesh(sph, this.neutronMat, MAX_NUCLEONS);
    this.electronMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    this.electronMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), this.electronMat, MAX_ELECTRONS);
    const white = new THREE.Color(1, 1, 1);
    for (const m of [this.protonMesh, this.neutronMesh, this.electronMesh]) {
      for (let i = 0; i < m.count; i++) m.setColorAt(i, white);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; m.count = 0; this.scene.add(m);
    }
    this.electronMesh.renderOrder = 3;

    // trails
    const tv = MAX_ELECTRONS * (TRAIL - 1) * 2;
    const tg = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(tv * 3); this.trailCol = new Float32Array(tv * 3);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setDrawRange(0, 0);
    this.trails = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trails.frustumCulled = false; this.trails.renderOrder = 2; this.scene.add(this.trails);

    // bonds: one shared instance buffer, two materials (soft halo + bright core)
    const bg = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    this.bondColA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOND_LINES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.bondColB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOND_LINES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.bondGlow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOND_LINES), 1).setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('aColA', this.bondColA); bg.setAttribute('aColB', this.bondColB); bg.setAttribute('aGlow', this.bondGlow);
    const mk = (radius, intensity, pow) => new THREE.ShaderMaterial({
      vertexShader: bondVert, fragmentShader: bondFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uRadius: { value: radius }, uIntensity: { value: intensity }, uPow: { value: pow }, uOpacity: { value: 1 } }
    });
    this.bondHalo = new THREE.InstancedMesh(bg, mk(1.0, 0.32, 2.4), MAX_BOND_LINES);
    this.bondCore = new THREE.InstancedMesh(bg, mk(0.2, 1.05, 0.6), MAX_BOND_LINES);
    this.bondCore.instanceMatrix = this.bondHalo.instanceMatrix;
    this.bondHalo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const m of [this.bondHalo, this.bondCore]) { m.frustumCulled = false; m.count = 0; m.renderOrder = 1; this.scene.add(m); }

    // selection marker
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringSpriteTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0.8 }));
    this.marker.renderOrder = 5; this.scene.add(this.marker);
  }

  // ------------------------------------------------------------------ atoms
  spawn(sym, pos = null, opts = {}) {
    if (this.atoms.length >= MAX_ATOMS) return null;
    if (!pos) pos = this._spawnPosition(sym);
    const a = new Atom(this, sym, pos);
    this.atoms.push(a);
    if (opts.select !== false && !this.selected) this.selected = a;
    this._topologyChanged();
    return a;
  }

  _spawnPosition(sym) {
    const ref = this.selected || this.atoms[0];
    const cam = this.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const center = ref ? ref.pos : new THREE.Vector3();
    const dist = ref ? 2.1 * bondLengthA(ref.sym, sym, 1) * ANGSTROM + 0.6 : 0;
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * Math.PI * 2 + 0.3;
      const ring = 1 + Math.floor(k / 12) * 0.5;
      const p = center.clone().addScaledVector(right, Math.cos(ang) * dist * ring).addScaledVector(up, Math.sin(ang) * dist * ring * 0.8);
      let minD = Infinity; for (const a of this.atoms) minD = Math.min(minD, a.pos.distanceTo(p) - a.size);
      const score = Math.min(minD, 3.0) - Math.abs(Math.sin(ang)) * 0.6 - (ring > 1 ? 1.5 : 0);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    return best ? best.addScaledVector(fwd, (Math.random() - 0.5) * 2.0) : new THREE.Vector3();
  }

  remove(atom) {
    for (const b of [...atom.bonds]) this._breakBond(b, false);
    atom.dispose();
    this.atoms.splice(this.atoms.indexOf(atom), 1);
    if (this.selected === atom) this.selected = this.atoms[0] || null;
    if (this.drag && this.drag.atom === atom) this.drag = null;
    if (this.kbd && this.kbd.atom === atom) this.kbd = null;
    this._topologyChanged();
  }

  clear() { for (const a of [...this.atoms]) this.remove(a); this.cooldown.clear(); }

  // ------------------------------------------------------------------ bonds
  restLength(a, b, order) { return bondLengthA(a.sym, b.sym, order) * ANGSTROM; }
  bondBetween(a, b) { return a.bonds.find(x => x.a === b || x.b === b) || null; }

  _assignElectron(atom, bond, slot, side) {
    const e = atom.valenceElectrons.find(x => !x.bond);
    if (!e) return null;
    e.from.copy(e.pos).sub(atom.pos); e.trans = e.trailInit ? 0 : 1;
    e.bond = bond; e.slot = slot; e.side = side;
    return e;
  }
  _releaseElectron(e) { if (!e) return; e.from.copy(e.pos).sub(e.atom.pos); e.trans = 0; e.bond = null; }

  formBond(a, b, order = 1, instant = false) {
    if (this.bondBetween(a, b)) return null;
    if (a.freeValence <= 0) { const m = a.multiBond; if (m) this._downgrade(m); else return null; }
    if (b.freeValence <= 0) { const m = b.multiBond; if (m) this._downgrade(m); else return null; }
    const bond = { id: ++BOND_ID, a, b, order: 0, age: 0, strength: instant ? 1 : 0, flash: instant ? 0 : 1, slots: [], rest: 0, restCur: a.pos.distanceTo(b.pos),
      c: new THREE.Vector3(), u: new THREE.Vector3(), e1: new THREE.Vector3(), e2: new THREE.Vector3(), L: 1 };
    this.bonds.push(bond); a.bonds.push(bond); b.bonds.push(bond); a.nb.add(b); b.nb.add(a);
    this._upgrade(bond);
    while (bond.order < order && a.freeValence > 0 && b.freeValence > 0) this._upgrade(bond);
    if (instant) bond.restCur = bond.rest;
    this.events.push({ type: 'form', bond });
    this._topologyChanged();
    return bond;
  }
  _upgrade(bond) {
    const slot = bond.order;
    const ea = this._assignElectron(bond.a, bond, slot, 0), eb = this._assignElectron(bond.b, bond, slot, 1);
    bond.slots.push([ea, eb]); bond.order++; bond.flash = 1;
    bond.rest = this.restLength(bond.a, bond.b, bond.order);
  }
  _downgrade(bond) {
    const s = bond.slots.pop(); if (s) s.forEach(e => this._releaseElectron(e));
    bond.order--; bond.rest = this.restLength(bond.a, bond.b, Math.max(1, bond.order));
    if (bond.order <= 0) this._breakBond(bond, true);
  }
  _breakBond(bond, impulse = true) {
    for (const s of bond.slots) s.forEach(e => this._releaseElectron(e));
    bond.slots = []; bond.order = 0;
    const { a, b } = bond;
    a.bonds.splice(a.bonds.indexOf(bond), 1); b.bonds.splice(b.bonds.indexOf(bond), 1);
    a.nb.delete(b); b.nb.delete(a);
    this.bonds.splice(this.bonds.indexOf(bond), 1);
    if (impulse) {
      const u = this._tmp.v1.subVectors(b.pos, a.pos).normalize();
      const kick = 2.2 + this.params.heat * 2.5;
      a.vel.addScaledVector(u, -kick / Math.sqrt(a.mass)); b.vel.addScaledVector(u, kick / Math.sqrt(b.mass));
    }
    this.cooldown.set(this._pairKey(a, b), 1.4);
    this.events.push({ type: 'break', a, b });
    this._topologyChanged();
  }
  breakAll() { for (const b of [...this.bonds]) this._breakBond(b, true); }
  _pairKey(a, b) { return a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id; }

  _topologyChanged() {
    // target bond angles from VSEPR-style domain counting
    for (const a of this.atoms) {
      const nb = a.bonds.length; let used = 0; for (const b of a.bonds) used += b.order;
      const nonbond = Math.max(0, VALENCE_E[a.sym] - used);
      const lp = a.sym === 'H' ? 0 : Math.ceil(nonbond / 2);
      const dom = nb + lp; a.domains = dom; a.lonePairs = a.sym === 'C' ? 0 : Math.floor(nonbond / 2);
      a.targetAngle = dom <= 2 ? 180 : dom === 3 ? 120 - 2 * lp : 109.5 - 2.5 * lp;
    }
    this._computeMolecules();
    this.onChange();
  }

  _computeMolecules() {
    const seen = new Set(); this.molecules = [];
    for (const a of this.atoms) {
      if (seen.has(a)) continue;
      const members = []; const stack = [a]; seen.add(a);
      while (stack.length) { const x = stack.pop(); members.push(x); for (const n of x.nb) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
      const counts = {}; let free = 0;
      for (const m of members) { counts[m.sym] = (counts[m.sym] || 0) + 1; free += m.freeValence; }
      const order = counts.C ? ['C', 'H', ...Object.keys(counts).filter(k => k !== 'C' && k !== 'H').sort()] : Object.keys(counts).sort();
      const hill = order.filter(k => counts[k]).map(k => k + (counts[k] > 1 ? counts[k] : '')).join('');
      let info = MOLECULES[hill] ? { ...MOLECULES[hill] } : null;
      if (hill === 'CHN') {
        const h = members.find(m => m.sym === 'H'); const onC = h && [...h.nb][0]?.sym === 'C';
        if (!onC) info = { name: 'Hydrogen isocyanide', display: 'HNC', shape: 'linear' };
      }
      if (hill === 'C2H6O') {
        const o = members.find(m => m.sym === 'O'); const oh = o && [...o.nb].some(n => n.sym === 'H');
        if (!oh) info = { name: 'Dimethyl ether', display: 'CH3OCH3', shape: 'bent C–O–C' };
      }
      let name, shape, display = hill;
      if (info && (free === 0 || info.shape === 'radical' || members.length === 1 || hill === 'CO')) {
        name = info.name; shape = info.shape; display = info.display || hill;
      } else if (free > 0) {
        name = members.length === 1 ? 'Free atom' : 'Reactive fragment (radical)'; shape = `${free} unpaired valence`;
      } else { name = 'Stable molecule'; shape = `${members.length} atoms`; }
      const mol = { atoms: members, hill, display, name, shape, free, html: subscript(display) };
      for (const m of members) m.molecule = mol;
      this.molecules.push(mol);
    }
    this.molecules.sort((x, y) => y.atoms.length - x.atoms.length);
  }

  // ------------------------------------------------------------------ physics
  _step(h, heat) {
    const atoms = this.atoms, T = this._tmp;
    for (const a of atoms) a.force.set(0, 0, 0);

    for (const b of this.bonds) {
      const A = b.a, B = b.b;
      const d = T.v1.subVectors(B.pos, A.pos); const L = d.length() || 1e-4; d.divideScalar(L);
      const relV = T.v2.subVectors(B.vel, A.vel).dot(d);
      const k = (70 + 15 * (b.order - 1)) * (0.15 + 0.85 * b.strength);
      const f = k * (L - b.restCur) + 4.5 * relV;
      A.force.addScaledVector(d, f); B.force.addScaledVector(d, -f);
    }

    const KA = 95;
    for (const c of atoms) {
      const n = c.bonds.length; if (n < 2) continue;
      const th0 = c.targetAngle * Math.PI / 180;
      const nbs = c.bonds.map(b => b.a === c ? b.b : b.a);
      const sMin = Math.min(...c.bonds.map(b => b.strength));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const ni = nbs[i], nj = nbs[j];
        // Urey–Bradley 1–3 spring: keeps the ideal geometry but removes the spurious
        // "umbrella" minimum that a purely angle-harmonic potential has for 4 neighbours.
        if (th0 < 3.1) {
          const ra = c.bonds[i].restCur, rb = c.bonds[j].restCur;
          const d0 = Math.sqrt(ra * ra + rb * rb - 2 * ra * rb * Math.cos(th0));
          const dv = T.v3.subVectors(nj.pos, ni.pos); const dl = dv.length() || 1e-4;
          const fu = 28 * (dl - d0) * (0.3 + 0.7 * sMin) / dl;
          ni.force.addScaledVector(dv, fu); nj.force.addScaledVector(dv, -fu);
        }
        const u = T.v1.subVectors(ni.pos, c.pos), v = T.v2.subVectors(nj.pos, c.pos);
        const lu = u.length(), lv = v.length(); if (lu < 1e-3 || lv < 1e-3) continue;
        u.divideScalar(lu); v.divideScalar(lv);
        const cs = THREE.MathUtils.clamp(u.dot(v), -1, 1); const th = Math.acos(cs); const sn = Math.sin(th);
        if (sn < 1e-3) continue;
        const mag = KA * (th - th0) * (0.3 + 0.7 * sMin);
        const wi = T.v3.copy(v).addScaledVector(u, -cs).divideScalar(sn).multiplyScalar(mag / lu);
        ni.force.add(wi); c.force.sub(wi);
        const wj = u.addScaledVector(v, -cs).divideScalar(sn).multiplyScalar(mag / lv);
        nj.force.add(wj); c.force.sub(wj);
      }
    }

    const assist = this.params.assist;
    for (let i = 0; i < atoms.length; i++) {
      const A = atoms[i];
      for (let j = i + 1; j < atoms.length; j++) {
        const B = atoms[j];
        if (A.nb.has(B)) continue;
        let share = false; for (const x of A.nb) if (B.nb.has(x)) { share = true; break; }
        const d = T.v1.subVectors(B.pos, A.pos); const L = d.length() || 1e-4; d.divideScalar(L);
        const same = A.molecule && A.molecule === B.molecule;
        const bondable = !same && A.effectiveFree > 0 && B.effectiveFree > 0 && !this.cooldown.has(this._pairKey(A, B));
        let dRep;
        if (bondable) {
          const r1 = this.restLength(A, B, 1); dRep = 0.5 * r1;
          if (assist && L < 5.5 * r1) {
            const f = 11 * Math.pow(1 - L / (5.5 * r1), 0.6) * (1 - heat * 0.7);
            A.force.addScaledVector(d, f); B.force.addScaledVector(d, -f);
          } else if (assist && heat < 0.25) {
            // weak long-range "find a partner" pull once the system has cooled down
            const f = 1.6 * (1 - heat * 4);
            A.force.addScaledVector(d, f); B.force.addScaledVector(d, -f);
          }
        } else dRep = (share ? 0.45 : same ? 0.6 : 0.82) * (A.size + B.size);
        if (L < dRep) { const f = 38 * (dRep - L); A.force.addScaledVector(d, -f); B.force.addScaledVector(d, f); }
      }
    }

    const gamma = 2.0, kT = heat * 26 + 0.008;
    for (const a of atoms) {
      const tgt = (this.drag && this.drag.atom === a) ? this.drag.target : (this.kbd && this.kbd.atom === a) ? this.kbd.target : null;
      if (tgt) a.force.addScaledVector(T.v1.subVectors(tgt, a.pos), 140 * a.mass).addScaledVector(a.vel, -24 * a.mass);
      const r = a.pos.length(); if (r > 20) a.force.addScaledVector(a.pos, -(r - 20) * 20 / r);
      a.vel.addScaledVector(a.force, h / a.mass);
      if (kT > 0 && !tgt) { const s = Math.sqrt(2 * gamma * kT * h / a.mass); a.vel.x += gauss() * s; a.vel.y += gauss() * s; a.vel.z += gauss() * s; }
      a.vel.multiplyScalar(Math.exp(-gamma * h));
      const sp = a.vel.length(); if (sp > 45) a.vel.multiplyScalar(45 / sp);
      a.pos.addScaledVector(a.vel, h);
    }
    // remove net (centre-of-mass) drift caused by random thermal kicks so the scene stays in view
    if (!this.drag && !this.kbd && atoms.length > 1 && heat > 0) {
      const cm = T.v1.set(0, 0, 0); let M = 0;
      for (const a of atoms) { cm.addScaledVector(a.vel, a.mass); M += a.mass; }
      cm.divideScalar(M).multiplyScalar(1 - Math.exp(-3 * h));
      for (const a of atoms) a.vel.sub(cm);
    }
  }

  _chemistry(dt, heat) {
    for (const [k, v] of this.cooldown) { const nv = v - dt; if (nv <= 0) this.cooldown.delete(k); else this.cooldown.set(k, nv); }
    // bond formation
    const formRate = 40 * Math.pow(1 - Math.min(heat, 0.95), 3);
    const cands = [];
    for (let i = 0; i < this.atoms.length; i++) for (let j = i + 1; j < this.atoms.length; j++) {
      const A = this.atoms[i], B = this.atoms[j];
      if (A.nb.has(B) || (A.molecule && A.molecule === B.molecule)) continue;
      if (A.effectiveFree <= 0 || B.effectiveFree <= 0 || this.cooldown.has(this._pairKey(A, B))) continue;
      const r1 = this.restLength(A, B, 1); const L = A.pos.distanceTo(B.pos);
      const needsDown = A.freeValence <= 0 || B.freeValence <= 0;
      if (L < (needsDown ? 1.15 : 1.45) * r1) cands.push([L / r1, A, B]);
    }
    cands.sort((x, y) => x[0] - y[0]);
    let changed = false;
    for (const [, A, B] of cands) {
      if (A.molecule && A.molecule === B.molecule) continue;
      if (A.effectiveFree <= 0 || B.effectiveFree <= 0) continue;
      if (Math.random() < 1 - Math.exp(-formRate * dt)) { this.formBond(A, B, 1); changed = true; }
    }
    // bond order upgrades (double / triple bonds) once nothing else is about to bond
    for (const b of this.bonds) {
      b.age += dt;
      if (b.order >= 3 || b.age < 0.45 || b.a.freeValence <= 0 || b.b.freeValence <= 0) continue;
      if (this._pendingNear(b.a) || this._pendingNear(b.b)) continue;
      if (Math.random() < 1 - Math.exp(-formRate * 0.5 * dt)) { this._upgrade(b); b.age = 0; this._topologyChanged(); }
    }
    // thermal dissociation
    if (heat > 0.05) {
      for (const b of [...this.bonds]) {
        const Eb = bondEnergy(b.a.sym, b.b.sym, b.order) / 400;
        const rate = 60 * Math.exp(-Eb * 5.5 / heat);
        const stretched = b.a.pos.distanceTo(b.b.pos) > 2.4 * b.rest;
        if (stretched || Math.random() < 1 - Math.exp(-rate * dt)) {
          if (b.order > 1 && !stretched) { this._downgrade(b); this._topologyChanged(); } else this._breakBond(b, true);
        }
      }
    }
  }
  _pendingNear(x) {
    if (x.freeValence <= 0) return false;
    for (const y of this.atoms) {
      if (y === x || y.molecule === x.molecule || y.effectiveFree <= 0) continue;
      if (x.pos.distanceTo(y.pos) < 2.2 * this.restLength(x, y, 1)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ frame update
  update(dt, camera) {
    const p = this.params; this.realT += dt;
    const simDt = p.playing ? dt * p.speed : 0; this.t += simDt;
    this.viewMix += ((p.view === 'quantum' ? 1 : 0) - this.viewMix) * (1 - Math.exp(-dt * 5));
    const heat = p.playing ? p.heat : 0;
    if (p.playing || this.drag || this.kbd) {
      const n = 4, h = Math.min(dt, 1 / 30) / n;
      for (let i = 0; i < n; i++) this._step(h, heat);
    }
    for (const b of this.bonds) {
      b.strength = Math.min(1, b.strength + dt * 2.2);
      b.flash = Math.max(0, b.flash - dt * 1.6);
      b.restCur += (b.rest - b.restCur) * (1 - Math.exp(-dt * 4));
    }
    if (p.playing) this._chemistry(Math.min(dt, 1 / 20), heat);
    this._render(dt, camera);
  }

  // fast-forward the simulation (physics + chemistry) without rendering; used by tests/debug hook
  advance(seconds, step = 1 / 60) {
    const heat = this.params.heat;
    for (let t = 0; t < seconds; t += step) {
      for (let i = 0; i < 4; i++) this._step(step / 4, heat);
      for (const b of this.bonds) { b.strength = Math.min(1, b.strength + step * 2.2); b.flash = Math.max(0, b.flash - step * 1.6); b.restCur += (b.rest - b.restCur) * (1 - Math.exp(-step * 4)); }
      this._chemistry(step, heat);
    }
    for (const a of this.atoms) for (const e of a.electrons) { e.trailInit = false; e.trans = 1; }
  }

  _render(dt, camera) {
    const T = this._tmp, p = this.params, t = this.t, bohr = 1 - this.viewMix, quantum = this.viewMix;
    const hl = p.highlight, pulse = 0.5 + 0.5 * Math.sin(this.realT * 4);
    const jig = 0.02 * (1 + 4 * p.heat);

    // bond frames
    for (const b of this.bonds) {
      const A = b.a.pos, B = b.b.pos;
      b.u.subVectors(B, A); b.L = b.u.length() || 1e-4; b.u.divideScalar(b.L);
      const pol = THREE.MathUtils.clamp((b.b.el.en - b.a.el.en) * 0.07, -0.1, 0.1);
      b.c.copy(A).addScaledVector(b.u, b.L * (0.5 + pol));
      const view = T.v1.subVectors(camera.position, b.c).normalize();
      b.e1.crossVectors(b.u, view); if (b.e1.lengthSq() < 1e-6) b.e1.set(0, 1, 0).cross(b.u);
      b.e1.normalize(); b.e2.crossVectors(b.u, b.e1).normalize();
    }

    // ---- atoms: rings, clouds, labels
    for (const a of this.atoms) {
      a.group.position.copy(a.pos);
      const isSel = a === this.selected;
      for (const r of a.rings) {
        const qp = T.q.setFromAxisAngle(T.v1.set(0, 1, 0), t * r.prec * 2);
        r.q.copy(qp).multiply(r.base);
        r.mesh.quaternion.copy(r.q); r.glow.quaternion.copy(r.q);
        const free = r.electrons.filter(e => !e.bond).length / r.count;
        r.opacity += (free - r.opacity) * (1 - Math.exp(-dt * 3));
        const vis = (p.shells ? 1 : 0) * bohr * (0.15 + 0.85 * r.opacity) * (hl === 'electron' ? 1.3 : hl !== 'none' ? 0.35 : 1);
        r.mat.opacity = 0.85 * vis; r.glowMat.opacity = 0.35 * vis;
        r.mesh.visible = r.glow.visible = vis > 0.003;
        r.label.position.set(0, 0, r.R + 0.25).applyQuaternion(r.q);
        r.label.visible = p.labels && isSel && bohr > 0.5 && p.shells && r.opacity > 0.3;
      }
      for (const c of a.clouds) {
        const occF = c.occ === 0 ? 0.12 : c.occ === 1 ? 0.75 : 1.0;
        const op = (p.clouds ? 1 : 0) * quantum * occF * c.base * (hl !== 'none' && hl !== 'electron' ? 0.4 : 1);
        c.mat.uniforms.uOpacity.value = op; c.mat.uniforms.uTime.value = this.t; c.mat.uniforms.uPR.value = this.pixelRatio;
        c.pts.visible = op > 0.002;
        c.label.visible = p.labels && isSel && quantum > 0.5 && p.clouds;
      }
      a.tag.position.set(0, (a.sym === 'H' ? 1.35 : 2.75 * a.f) * (bohr > 0.5 ? 1 : 1.25) + 0.45, 0);
      a.tag.visible = p.labels;
      a.tag.element.classList.toggle('selected', isSel);
    }

    // ---- nucleons
    const pCol = T.c, protonBase = new THREE.Color(0.95, 0.07, 0.045), neutronBase = new THREE.Color(0.28, 0.40, 0.68);
    const pBoost = hl === 'proton' ? 1 + 0.5 * pulse : 1, nBoost = hl === 'neutron' ? 1 + 0.7 * pulse : 1;
    let np = 0, nn = 0;
    const camQ = camera.quaternion;
    const nScale = 1 - 0.55 * quantum; // nucleus shrinks in the quantum view so orbital cores are visible
    for (const a of this.atoms) {
      for (const n of a.nucleons) {
        const w = n.world.copy(n.base).multiplyScalar(nScale);
        w.x += Math.sin(t * n.fr[0] + n.ph[0]) * jig; w.y += Math.sin(t * n.fr[1] + n.ph[1]) * jig; w.z += Math.sin(t * n.fr[2] + n.ph[2]) * jig;
        w.add(a.pos);
        T.s.setScalar(NUCLEON_R * nScale);
        if (n.type === 'proton') {
          T.m.compose(w, camQ, T.s); this.protonMesh.setMatrixAt(np, T.m);
          this.protonMesh.setColorAt(np, pCol.copy(protonBase).multiplyScalar(pBoost)); np++;
        } else {
          T.m.compose(w, camQ, T.s); this.neutronMesh.setMatrixAt(nn, T.m);
          this.neutronMesh.setColorAt(nn, pCol.copy(neutronBase).multiplyScalar(nBoost)); nn++;
        }
      }
    }
    this.protonMesh.count = np; this.neutronMesh.count = nn;
    for (const m of [this.protonMesh, this.neutronMesh]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    const dimP = hl === 'neutron' || hl === 'electron', dimN = hl === 'proton' || hl === 'electron';
    this.protonMat.opacity += ((dimP ? 0.18 : 1) - this.protonMat.opacity) * Math.min(1, dt * 6);
    this.neutronMat.opacity += ((dimN ? 0.18 : 1) - this.neutronMat.opacity) * Math.min(1, dt * 6);
    this.protonMat.depthWrite = this.protonMat.opacity > 0.98; this.neutronMat.depthWrite = this.neutronMat.opacity > 0.98;
    this.protonMat.emissiveIntensity = p.labels ? 0.8 : 0.0;

    // ---- electrons
    let ne = 0; const eBoost = hl === 'electron' ? 1.4 + 1.2 * pulse : hl !== 'none' ? 0.4 : 1;
    const trailsOn = p.trails && p.playing;
    let tv = 0; const tp = this.trailPos, tc = this.trailCol;
    const trailVis = (p.trails ? 1 : 0) * bohr * (hl !== 'none' && hl !== 'electron' ? 0.3 : 1);
    for (const a of this.atoms) {
      for (const e of a.electrons) {
        const tgt = T.v2;
        if (e.bond) this._bondElectronPos(e, tgt);
        else {
          const r = e.ring; const th = e.phase0 + t * r.w;
          tgt.set(r.R * Math.cos(th), 0, r.R * Math.sin(th)).applyQuaternion(r.q).add(a.pos);
        }
        if (e.trans < 1) {
          e.trans = Math.min(1, e.trans + dt / 0.9);
          const k = ease(e.trans);
          e.pos.copy(a.pos).add(e.from).lerp(tgt, k);
        } else e.pos.copy(tgt);
        if (!e.trailInit) { for (let i = 0; i < TRAIL; i++) e.trail.set([e.pos.x, e.pos.y, e.pos.z], i * 3); e.trailInit = true; }
        if (trailsOn) { e.head = (e.head + 1) % TRAIL; e.trail[e.head * 3] = e.pos.x; e.trail[e.head * 3 + 1] = e.pos.y; e.trail[e.head * 3 + 2] = e.pos.z; }

        const col = e.bond ? E_COLORS.bond : E_COLORS[e.sub];
        T.s.setScalar(ELECTRON_R * (1 + (e.bond ? 0.15 : 0)) * (0.6 + 0.4 * bohr) * (hl === 'electron' ? 1.35 : 1));
        T.m.compose(e.pos, camQ, T.s);
        this.electronMesh.setMatrixAt(ne, T.m);
        this.electronMesh.setColorAt(ne, pCol.copy(col).multiplyScalar(eBoost));
        ne++;

        if (trailVis > 0.01) {
          const cr = col.r * 0.35 * trailVis, cg = col.g * 0.35 * trailVis, cb = col.b * 0.35 * trailVis;
          for (let k = 0; k < TRAIL - 1; k++) {
            const i0 = ((e.head - k) % TRAIL + TRAIL) % TRAIL, i1 = ((e.head - k - 1) % TRAIL + TRAIL) % TRAIL;
            const a0 = Math.pow(1 - k / (TRAIL - 1), 1.6), a1 = Math.pow(1 - (k + 1) / (TRAIL - 1), 1.6);
            const o = tv * 3;
            tp[o] = e.trail[i0 * 3]; tp[o + 1] = e.trail[i0 * 3 + 1]; tp[o + 2] = e.trail[i0 * 3 + 2];
            tp[o + 3] = e.trail[i1 * 3]; tp[o + 4] = e.trail[i1 * 3 + 1]; tp[o + 5] = e.trail[i1 * 3 + 2];
            tc[o] = cr * a0; tc[o + 1] = cg * a0; tc[o + 2] = cb * a0;
            tc[o + 3] = cr * a1; tc[o + 4] = cg * a1; tc[o + 5] = cb * a1;
            tv += 2;
          }
        }
      }
    }
    this.electronMesh.count = ne;
    this.electronMesh.instanceMatrix.needsUpdate = true; this.electronMesh.instanceColor.needsUpdate = true;
    this.electronMat.opacity = Math.max(0, bohr * 1.15 - 0.15);
    this.electronMesh.visible = this.electronMat.opacity > 0.01;
    this.trails.geometry.setDrawRange(0, tv);
    this.trails.geometry.attributes.position.needsUpdate = true; this.trails.geometry.attributes.color.needsUpdate = true;
    this.trails.visible = tv > 0;

    // ---- bonds
    let nb = 0;
    for (const b of this.bonds) {
      const lines = b.order;
      const spacing = lines === 2 ? 0.17 : 0.24;
      const glow = (0.35 + 0.65 * b.strength) * (1 + b.flash * 2.2);
      const ca = GLOW_COL[b.a.sym], cb = GLOW_COL[b.b.sym];
      for (let i = 0; i < lines && nb < MAX_BOND_LINES; i++) {
        const off = lines === 1 ? 0 : lines === 2 ? (i === 0 ? -spacing : spacing) : (i - 1) * spacing;
        T.v1.copy(b.a.pos).add(b.b.pos).multiplyScalar(0.5).addScaledVector(b.e1, off);
        T.q.setFromUnitVectors(T.v3.set(0, 1, 0), b.u);
        const rad = (lines === 1 ? 0.19 : 0.13) * (0.4 + 0.6 * b.strength);
        T.s.set(rad, b.L, rad);
        T.m.compose(T.v1, T.q, T.s); this.bondHalo.setMatrixAt(nb, T.m);
        this.bondColA.setXYZ(nb, ca.r, ca.g, ca.b); this.bondColB.setXYZ(nb, cb.r, cb.g, cb.b); this.bondGlow.setX(nb, glow);
        nb++;
      }
    }
    this.bondHalo.count = this.bondCore.count = nb;
    this.bondHalo.instanceMatrix.needsUpdate = true;
    this.bondColA.needsUpdate = this.bondColB.needsUpdate = this.bondGlow.needsUpdate = true;
    const bondOp = 0.55 + 0.45 * bohr;
    this.bondHalo.material.uniforms.uOpacity.value = bondOp; this.bondCore.material.uniforms.uOpacity.value = bondOp;

    // ---- selection marker
    const s = this.selected;
    this.marker.visible = !!s && camera.position.distanceTo(s.pos) > 4.5 && quantum < 0.5;
    if (s) {
      this.marker.position.copy(s.pos);
      const sc = Math.max(1.1, s.nucleusRadius * 3.0); this.marker.scale.set(sc, sc, 1);
      this.marker.material.rotation = this.realT * 0.4;
      this.marker.material.opacity = 0.45 + 0.2 * Math.sin(this.realT * 2.5);
    }
  }

  _bondElectronPos(e, out) {
    const b = e.bond, t = this.t, L = b.L;
    const phi = t * 2.6 + e.side * Math.PI + b.id * 0.7 + e.slot * 1.3;
    if (e.slot === 0) {
      const psi = t * 0.9 + b.id;
      const w = this._tmp.v3.copy(b.e1).multiplyScalar(Math.cos(psi)).addScaledVector(b.e2, Math.sin(psi));
      out.copy(b.c).addScaledVector(b.u, Math.sin(phi) * 0.3 * L).addScaledVector(w, Math.cos(phi) * 0.3);
    } else {
      const off = e.slot === 1 ? b.e1 : b.e2, perp = e.slot === 1 ? b.e2 : b.e1, s = e.side ? -1 : 1;
      out.copy(b.c).addScaledVector(off, (b.order === 3 && e.slot === 2 ? 0.0 : 0.0) + 0.42 * s)
        .addScaledVector(b.u, Math.sin(phi) * 0.27 * L).addScaledVector(perp, Math.cos(phi) * 0.12);
    }
    return out;
  }

  // ------------------------------------------------------------------ picking
  pick(ray) {
    let best = null; const tmp = this._tmp.v1, sphere = new THREE.Sphere();
    const consider = (t, hit) => { if (t != null && (!best || t < best.t)) best = { t, ...hit }; };
    for (const a of this.atoms) {
      for (const n of a.nucleons) {
        sphere.set(n.world, NUCLEON_R * 1.05);
        if (ray.intersectSphere(sphere, tmp)) consider(tmp.distanceTo(ray.origin), { kind: n.type, atom: a, nucleon: n });
      }
      if (this.viewMix < 0.5) for (const e of a.electrons) {
        sphere.set(e.pos, 0.26);
        if (ray.intersectSphere(sphere, tmp)) consider(tmp.distanceTo(ray.origin) - 0.4, { kind: 'electron', atom: a, electron: e });
      }
    }
    const pr = new THREE.Vector3(), ps = new THREE.Vector3();
    for (const b of this.bonds) {
      const d2 = ray.distanceSqToSegment(b.a.pos, b.b.pos, pr, ps);
      const fromA = ps.distanceTo(b.a.pos), fromB = ps.distanceTo(b.b.pos);
      if (d2 < 0.2 * 0.2 && fromA > b.a.nucleusRadius + 0.2 && fromB > b.b.nucleusRadius + 0.2) consider(pr.distanceTo(ray.origin), { kind: 'bond', bond: b });
    }
    return best;
  }

  // atom whose nucleus is under the pointer (generous screen-space radius for touch)
  pickAtomScreen(x, y, camera, w, h, minPx = 22) {
    let best = null, bestD = Infinity; const v = this._tmp.v1;
    const f = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    for (const a of this.atoms) {
      v.copy(a.pos).project(camera); if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      const dist = camera.position.distanceTo(a.pos);
      const rPx = Math.max(minPx, a.nucleusRadius * 1.5 * f / dist);
      const d = Math.hypot(sx - x, sy - y);
      if (d < rPx && dist < bestD) { best = a; bestD = dist; }
    }
    return best;
  }

  measuredAngles(atom) {
    const nbs = [...atom.nb]; const out = [];
    for (let i = 0; i < nbs.length; i++) for (let j = i + 1; j < nbs.length; j++) {
      const u = new THREE.Vector3().subVectors(nbs[i].pos, atom.pos).normalize(), v = new THREE.Vector3().subVectors(nbs[j].pos, atom.pos).normalize();
      out.push(THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1))));
    }
    return out;
  }
}
