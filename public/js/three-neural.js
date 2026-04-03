/**
 * Fond Aurore / Nébuleuse gazeuse — Three.js (plein écran, GPU)
 *
 * - Bruit FBM 2D + coordonnées déformées (flux organique), palette Flaynn (violet, émeraude,
 *   ambre, cyan) en fusion additive.
 * - Idle : uTime + parallaxe souris (uniform uMouse) dans le fragment.
 * - Warp : uTransitionProgress 0→1 — étirement radial, accélération du flux, explosion
 *   d’intensité (effet « hyperspace gazeux »).
 *
 * triggerWarpTransition(targetUrl, duration) — inchangé côté API (GSAP ou fallback RAF).
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

/* ─── GLSL — utilitaires bruit (compact, sans boucles dynamiques) ───────── */
const noiseCommon = `
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    v += a * noise2(p); p = m * p;
    a *= 0.5;
    v += a * noise2(p); p = m * p;
    a *= 0.5;
    v += a * noise2(p); p = m * p;
    a *= 0.5;
    v += a * noise2(p);
    return v;
  }
`;

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  ${noiseCommon}

  varying vec2 vUv;

  uniform float uTime;
  uniform float uTransitionProgress;
  uniform vec2  uMouse;
  uniform vec2  uResolution;

  /* Ramps palette (sRGB-friendly, mélangées en linéaire approximatif) */
  vec3 colViolet  = vec3(0.545, 0.361, 0.965);
  vec3 colEmerald = vec3(0.063, 0.725, 0.506);
  vec3 colAmber   = vec3(0.961, 0.620, 0.043);
  vec3 colCyan    = vec3(0.231, 0.510, 0.965);
  vec3 colVoid    = vec3(0.012, 0.016, 0.027);

  void main() {
    float w = clamp(uTransitionProgress, 0.0, 1.0);
    float t = uTime;

    /* Aspect ratio — bruit isotrope à l’écran */
    vec2 uv = vUv;
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    vec2 p = (uv - 0.5) * aspect * 2.8;

    /* Parallaxe souris (léger décalage du champ de bruit) */
    vec2 mouse = uMouse * 0.22;
    p += mouse;

    /* ── Warp : aspiration / tunnel gazeux ───────────────────────────── */
    vec2 center = uv - 0.5;
    float rad = length(center);
    vec2 dir = rad > 1e-4 ? center / rad : vec2(0.0, 1.0);
    float tunnel = w * w * (3.0 - 2.0 * w);
    /* Étire le champ vers l’extérieur + renforce le centre = rush vers la caméra */
    p += dir * tunnel * (0.85 + rad * 2.4);
    p *= 1.0 + tunnel * 1.35;

    /* Temps accéléré en warp = flux hyperespace */
    float tFlow = t * (0.11 + tunnel * 0.95);

    /* Couches FBM décalées (domaine warped — type domain repetition organique) */
    vec2 q = vec2(
      fbm(p + vec2(tFlow * 0.7, tFlow * 0.5)),
      fbm(p + vec2(-tFlow * 0.4, tFlow * 0.8))
    );
    vec2 r = p + (q - 0.5) * 2.1;

    float n1 = fbm(r + vec2(tFlow * 1.2, -tFlow * 0.6));
    float n2 = fbm(r * 1.65 + vec2(tFlow * 2.0, tFlow * 1.1));
    float n3 = fbm(r * 2.4 + vec2(-tFlow * 1.5, tFlow * 2.2));

    /* Voiles aurore : bandes minces = pow + mix */
    float veil = smoothstep(0.28, 0.92, n1 * 0.55 + n2 * 0.35 + n3 * 0.18);
    float wisp = smoothstep(0.45, 0.98, n2 * n3);

    /* Couleur organique : poids selon les couches */
    vec3 col = mix(colVoid, colViolet, n1 * 0.55);
    col = mix(col, colEmerald, n2 * veil * 0.65);
    col = mix(col, colCyan, wisp * 0.45 + n3 * 0.25);
    col = mix(col, colAmber, smoothstep(0.5, 1.0, n2 * n1) * 0.35);

    /* Courbure type curtain (vertical bias — aurore) */
    float curtain = smoothstep(0.0, 0.85, 1.0 - abs(uv.y - 0.45) * 1.8);
    col *= 0.35 + curtain * 0.65;

    /* Intensité de base + explosion warp */
    float intensity = 0.15 + veil * 0.55 + wisp * 0.35;
    intensity *= 0.55 + curtain * 0.45;
    float warpGlow = 1.0 + tunnel * 14.0 + w * w * 8.0;
    intensity *= warpGlow;

    /* Saturation boost warp */
    col = mix(col, col * vec3(1.15, 1.08, 1.2), tunnel * 0.85);

    vec3 rgb = col * intensity;

    /* Alpha : additive — contrôle la densité du voile */
    float alpha = length(rgb) * (0.45 + (1.0 - w) * 0.25);
    alpha = min(alpha * (1.0 + tunnel * 0.5), 1.0);

    gl_FragColor = vec4(rgb, alpha);
  }
`;

export class FlaynnNeuralBackground {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ particles?: number }} [config] — `particles` ignoré (rétrocompatibilité API)
   */
  constructor(canvas, config) {
    void config;

    this.clock = new THREE.Clock();
    this.mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.rafId = 0;
    this._transitioning = false;

    this._onMouseMove = (e) => {
      this.mouse.targetX = e.clientX / window.innerWidth - 0.5;
      this.mouse.targetY = e.clientY / window.innerHeight - 0.5;
    };
    this._onOrient = (e) => {
      if (e.gamma == null) return;
      this.mouse.targetX = e.gamma / 45;
      this.mouse.targetY = (e.beta - 45) / 45;
    };
    this._onResize = () => this.#syncSize();

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        powerPreference: 'low-power',
        stencil: false,
        depth: false
      });
    } catch {
      canvas.classList.add('three-canvas--fallback');
      return;
    }

    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(0, 0, 40);
    this.camera.lookAt(0, 0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uTransitionProgress: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uResolution: { value: new THREE.Vector2(1, 1) }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });

    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(0, 0, 0);
    this.scene.add(this.mesh);

    window.addEventListener('mousemove', this._onMouseMove, { passive: true });
    window.addEventListener('deviceorientation', this._onOrient, { passive: true });
    window.addEventListener('resize', this._onResize, { passive: true });

    this.#syncSize();
    document.documentElement.classList.add('has-three-bg');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.material.uniforms.uTime.value = 0;
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      if (!document.hidden) this.#frame();
    };
    loop();
  }

  #syncSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);

    this.material.uniforms.uResolution.value.set(w, h);

    /* Plan calé au champ de vue : remplit l’écran sans sur-échantillonnage inutile */
    const dist = this.camera.position.z;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hh = Math.tan(vFov / 2) * dist;
    const hw = hh * this.camera.aspect;
    const margin = 1.15;
    this.mesh.scale.set(hw * 2 * margin, hh * 2 * margin, 1);
  }

  #frame() {
    const t = this.clock.getElapsedTime();
    this.material.uniforms.uTime.value = t;

    const w = this.material.uniforms.uTransitionProgress.value;
    /* Lissage souris — réduit en warp pour l’effet « tunnel » */
    const smooth = w > 0.05 ? 0.02 : 0.06;
    this.mouse.x += (this.mouse.targetX - this.mouse.x) * smooth;
    this.mouse.y += (this.mouse.targetY - this.mouse.y) * smooth;
    this.material.uniforms.uMouse.value.set(this.mouse.x * 2, -this.mouse.y * 2);

    /* Léger roll de la caméra au repos seulement */
    if (w < 0.05) {
      this.camera.rotation.z = Math.sin(t * 0.08) * 0.02;
    } else {
      this.camera.rotation.z *= 0.92;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * @param {string} targetUrl
   * @param {number} [duration=0.85]
   */
  triggerWarpTransition(targetUrl, duration = 0.85) {
    if (this._transitioning) return;
    this._transitioning = true;

    const uniform = this.material.uniforms.uTransitionProgress;
    const onComplete = () => {
      window.location.href = targetUrl;
    };

    if (typeof window.gsap !== 'undefined') {
      window.gsap.to(uniform, {
        value: 1,
        duration,
        ease: 'power3.in',
        onComplete
      });
      return;
    }

    const startTime = performance.now();
    const durationMs = duration * 1000;
    const tick = (now) => {
      const raw = Math.min((now - startTime) / durationMs, 1);
      uniform.value = raw * raw * raw;
      if (raw < 1) {
        requestAnimationFrame(tick);
      } else {
        onComplete();
      }
    };
    requestAnimationFrame(tick);
  }

  destroy() {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('deviceorientation', this._onOrient);
    window.removeEventListener('resize', this._onResize);
    cancelAnimationFrame(this.rafId);
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
    document.documentElement.classList.remove('has-three-bg');
  }
}
