// Hydrogen-like orbital probability clouds rendered as GPU point sprites.
// Samples are drawn from |ψ|² with exact / rejection sampling (Z = 1 units, a₀ = 1)
// and scaled per atom so the 1s, 2s and 2p clouds stay readable together.
import * as THREE from 'three';

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gammaInt = (k, scale, r) => { let p = 1; for (let i = 0; i < k; i++) p *= (1 - r()); return -Math.log(p) * scale; };

function uniformDir(r) {
  const z = 2 * r() - 1, phi = 2 * Math.PI * r(), s = Math.sqrt(1 - z * z);
  return [s * Math.cos(phi), s * Math.sin(phi), z];
}

// returns { positions, signs, rands }
function sample(kind, count, seed) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3), sign = new Float32Array(count), rnd = new Float32Array(count), den = new Float32Array(count);
  let maxDen = 0;
  for (let i = 0; i < count; i++) {
    let x, y, z, s = 1;
    if (kind === '1s') {
      // P(r) ∝ r² e^{-2r}  → Gamma(3, ½)
      const rad = gammaInt(3, 0.5, r); const d = uniformDir(r);
      x = d[0] * rad; y = d[1] * rad; z = d[2] * rad;
      den[i] = rad * rad * Math.exp(-2 * rad); // radial probability r²|ψ|²
    } else if (kind === '2s') {
      // P(r) ∝ r² (2 − r)² e^{−r}; propose Gamma(3,1), accept ∝ (2−r)²
      let rad;
      for (;;) { rad = gammaInt(3, 1, r); if (rad > 16) continue; if (r() * 196 < (2 - rad) * (2 - rad)) break; }
      const d = uniformDir(r);
      x = d[0] * rad; y = d[1] * rad; z = d[2] * rad; s = rad < 2 ? -1 : 1; // radial node at r = 2a₀
      den[i] = rad * rad * (2 - rad) * (2 - rad) * Math.exp(-rad);
    } else {
      // 2p: P(r) ∝ r⁴ e^{−r} → Gamma(5,1); angular ∝ cos²θ → |cosθ| = u^{1/3}
      const rad = gammaInt(5, 1, r);
      const c = Math.cbrt(r()) * (r() < 0.5 ? -1 : 1);
      const sn = Math.sqrt(1 - c * c), phi = 2 * Math.PI * r();
      const a = c * rad, b1 = sn * Math.cos(phi) * rad, b2 = sn * Math.sin(phi) * rad;
      s = c >= 0 ? 1 : -1;
      den[i] = a * a * Math.exp(-rad); // |ψ|² ∝ r²cos²θ e^{-r}
      if (kind === '2px') { x = a; y = b1; z = b2; }
      else if (kind === '2py') { x = b1; y = a; z = b2; }
      else { x = b1; y = b2; z = a; }
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; sign[i] = s; rnd[i] = r();
    if (den[i] > maxDen) maxDen = den[i];
  }
  for (let i = 0; i < count; i++) den[i] = Math.pow(den[i] / maxDen, 1.1);
  return { pos, sign, rnd, den };
}

const COUNTS = { '1s': 9000, '2s': 14000, '2px': 18000, '2py': 18000, '2pz': 18000 };
const geoCache = {};
export function orbitalGeometry(kind) {
  if (geoCache[kind]) return geoCache[kind];
  const { pos, sign, rnd, den } = sample(kind, COUNTS[kind], 1337 + kind.length * 101 + kind.charCodeAt(kind.length - 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSign', new THREE.BufferAttribute(sign, 1));
  g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  g.setAttribute('aDen', new THREE.BufferAttribute(den, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);
  return (geoCache[kind] = g);
}

// [positive-phase colour, negative-phase colour]
export const ORBITAL_COLORS = {
  '1s': [new THREE.Color(1.0, 0.78, 0.38), new THREE.Color(1.0, 0.78, 0.38)],
  '2s': [new THREE.Color(0.2, 0.95, 0.8), new THREE.Color(0.9, 0.3, 0.95)],
  '2px': [new THREE.Color(0.3, 0.62, 1.0), new THREE.Color(0.1, 0.22, 0.75)],
  '2py': [new THREE.Color(0.35, 1.0, 0.45), new THREE.Color(0.08, 0.5, 0.2)],
  '2pz': [new THREE.Color(1.0, 0.45, 0.85), new THREE.Color(0.6, 0.12, 0.5)]
};

const vert = /* glsl */`
  attribute float aSign; attribute float aRand; attribute float aDen;
  varying float vDen;
  uniform float uTime; uniform float uSize; uniform float uPR; uniform float uScale;
  varying float vSign; varying float vRand; varying float vCut; varying float vDepthFade;
  uniform float uCut;
  void main() {
    vec3 p = position;
    // gentle quantum "shimmer": each sample breathes slightly around its spot
    float w = uTime * (0.6 + aRand) + aRand * 40.0;
    p += 0.035 * vec3(sin(w), cos(w * 1.3), sin(w * 0.7 + 1.0));
    vCut = (uCut > 0.5 && p.x > 0.0 && p.z > 0.0 && p.y > -999.0) ? 1.0 : 0.0;
    vec4 mv = modelViewMatrix * vec4(p * uScale, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uPR * (14.0 / -mv.z), 1.5, 40.0);
    vSign = aSign; vRand = aRand; vDen = aDen;
  }`;
const frag = /* glsl */`
  uniform vec3 uColPos; uniform vec3 uColNeg; uniform float uOpacity; uniform float uTime;
  varying float vSign; varying float vRand; varying float vCut; varying float vDen;
  void main() {
    if (vCut > 0.5) discard;
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float a = exp(-r2 * 18.0);
    float tw = 0.6 + 0.4 * sin(uTime * 2.5 + vRand * 60.0);
    vec3 c = vSign > 0.0 ? uColPos : uColNeg;
    gl_FragColor = vec4(c * a * tw * uOpacity * (0.04 + 0.96 * vDen) * 2.6, 1.0);
  }`;

export function makeCloudMaterial(kind) {
  const [cp, cn] = ORBITAL_COLORS[kind];
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: {
      uTime: { value: 0 }, uSize: { value: kind === '1s' ? 2.6 : kind === '2s' ? 2.6 : 3.3 }, uPR: { value: 1 },
      uScale: { value: 1 }, uOpacity: { value: 0 }, uCut: { value: kind.endsWith('s') ? 1 : 0 },
      uColPos: { value: cp.clone() }, uColNeg: { value: cn.clone() }
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
}
