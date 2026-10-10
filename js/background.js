// Gradient sky dome + twinkling starfield.
import * as THREE from 'three';

export function createBackground(scene) {
  const group = new THREE.Group();

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uHeat: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform float uHeat;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        float noise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          float h = vDir.y * 0.5 + 0.5;
          vec3 top = vec3(0.002, 0.003, 0.010);
          vec3 mid = vec3(0.008, 0.006, 0.022);
          vec3 bot = vec3(0.002, 0.006, 0.014);
          vec3 col = mix(bot, mid, smoothstep(0.0, 0.5, h));
          col = mix(col, top, smoothstep(0.5, 1.0, h));
          float n = noise(vDir * 3.0) * 0.6 + noise(vDir * 7.0) * 0.4;
          col += vec3(0.014, 0.005, 0.026) * smoothstep(0.45, 0.85, n);
          col += vec3(0.0, 0.008, 0.014) * smoothstep(0.55, 0.9, noise(vDir * 4.0 + 7.0));
          col += vec3(0.03, 0.008, 0.0) * uHeat * smoothstep(0.3, 0.8, n);
          gl_FragColor = vec4(col, 1.0);
        }`
    })
  );
  group.add(sky);

  const N = 4000;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, phi = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const R = 180 + Math.random() * 150;
    pos[i * 3] = s * Math.cos(phi) * R; pos[i * 3 + 1] = u * R; pos[i * 3 + 2] = s * Math.sin(phi) * R;
    size[i] = Math.pow(Math.random(), 6) * 3.0 + 0.6; seed[i] = Math.random();
    const t = Math.random();
    const c = t < 0.15 ? [1.0, 0.85, 0.7] : t < 0.3 ? [0.7, 0.8, 1.0] : [1, 1, 1];
    col.set(c, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aSize; attribute float aSeed; attribute vec3 aColor; uniform float uTime; uniform float uPR;
      varying float vA; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPR; vA = 0.55 + 0.45 * sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 100.0); vC = aColor; }`,
    fragmentShader: `varying float vA; varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d));
      gl_FragColor = vec4(vC * a * vA * 0.9, 1.0); }`
  });
  const stars = new THREE.Points(g, starMat);
  group.add(stars);
  scene.add(group);

  return {
    group,
    update(t, camera, pr, heat) {
      starMat.uniforms.uTime.value = t; starMat.uniforms.uPR.value = pr;
      sky.material.uniforms.uHeat.value = heat;
      group.position.copy(camera.position);
      stars.rotation.y = t * 0.004;
    }
  };
}
