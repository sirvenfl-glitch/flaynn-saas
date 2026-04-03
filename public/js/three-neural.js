/**
 * Fond Étoiles (Investisseurs & Projets) — Three.js
 * Rendu optimisé via Custom ShaderMaterial (God-Tier Level)
 *
 * Métaphore visuelle :
 *  - 80% des points → masse de projets (violet/bleu, petits, discrets)
 *  - 15% des points → bons projets (émeraude, luminosité moyenne)
 *  - 5%  des points → "Superstars" à fort potentiel (ambre, grandes, scintillantes)
 *
 * Architecture : le scintillement est 100% GPU (GLSL uTime + sin()),
 * la rotation lente de la galaxie est CPU (une seule ligne par frame).
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

/* ─── GLSL — Vertex Shader ──────────────────────────────────────────────── */
const vertexShader = `
  attribute float size;
  attribute float phase;
  attribute float brightness;

  varying vec3  vColor;
  varying float vPhase;
  varying float vBrightness;

  uniform float uTime;

  void main() {
    vColor      = color;
    vPhase      = phase;
    vBrightness = brightness;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    /* Atténuation perspective : les étoiles lointaines restent visibles */
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position  = projectionMatrix * mvPosition;
  }
`;

/* ─── GLSL — Fragment Shader ────────────────────────────────────────────── */
const fragmentShader = `
  varying vec3  vColor;
  varying float vPhase;
  varying float vBrightness;

  uniform float uTime;

  void main() {
    /* Particule circulaire douce avec halo (sans texture externe) */
    float d = distance(gl_PointCoord, vec2(0.5));
    float strength = 0.05 / d - 0.1;
    if (strength < 0.0) discard; /* Discard pixels hors du cercle — opti GPU */

    /* Scintillement : les Superstars (brightness > 1) oscillent plus vite */
    float twinkle = sin(uTime * (1.0 + vBrightness) + vPhase) * 0.5 + 0.5;

    /* Opacité : faible pour la masse, élevée pour les Superstars */
    float alpha = strength * (0.2 + twinkle * vBrightness * 0.8);

    gl_FragColor = vec4(vColor, alpha);
  }
`;

/* ─── Classe principale ─────────────────────────────────────────────────── */
export class FlaynnNeuralBackground {
  /** @param {HTMLCanvasElement} canvas @param {{ particles?: number }} config */
  constructor(canvas, config) {
    /* Cap à 3 000 particules pour rester sous 16 ms/frame sur mobile */
    const count = Math.min(config?.particles ?? 1500, 3000);

    this.clock  = new THREE.Clock();
    this.mouse  = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.rafId  = 0;

    /* Handlers stockés pour pouvoir les détacher proprement */
    this._onMouseMove = (e) => {
      this.mouse.targetX = (e.clientX / window.innerWidth  - 0.5) * 2;
      this.mouse.targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    this._onOrient = (e) => {
      if (e.gamma == null) return;
      this.mouse.targetX =  e.gamma  / 45;
      this.mouse.targetY = (e.beta - 45) / 45;
    };
    this._onResize = () => this.#syncSize();

    /* Initialisation WebGL — fallback CSS si indisponible */
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        powerPreference: 'low-power',
        stencil: false,
        depth:   false,
      });
    } catch {
      canvas.classList.add('three-canvas--fallback');
      return;
    }

    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene  = new THREE.Scene();
    /* Brouillard calé sur --surface-void : les étoiles lointaines fondent dans le noir */
    this.scene.fog = new THREE.FogExp2('#030407', 0.015);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.z = 40;

    this.#createStarfield(count);

    window.addEventListener('mousemove',        this._onMouseMove, { passive: true });
    window.addEventListener('deviceorientation', this._onOrient,   { passive: true });
    window.addEventListener('resize',           this._onResize,   { passive: true });

    this.#syncSize();
    document.documentElement.classList.add('has-three-bg');

    /* Respect de prefers-reduced-motion : rendu statique, pas de boucle RAF */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    /* Boucle de rendu — stoppée si onglet inactif (économie CPU/GPU) */
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      if (!document.hidden) this.#frame();
    };
    loop();
  }

  /* ── Construction du champ d'étoiles ────────────────────────────────── */
  #createStarfield(count) {
    const positions   = new Float32Array(count * 3);
    const colors      = new Float32Array(count * 3);
    const sizes       = new Float32Array(count);
    const phases      = new Float32Array(count);
    const brightnesses = new Float32Array(count);

    /* Palette Dark Clarity (tokens CSS → THREE.Color) */
    const cViolet  = new THREE.Color('#8b5cf6'); /* masse projets */
    const cBlue    = new THREE.Color('#3b82f6'); /* masse projets */
    const cEmerald = new THREE.Color('#10b981'); /* bons projets   */
    const cAmber   = new THREE.Color('#f59e0b'); /* Superstars      */

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      /* Distribution sphérique étirée — évite les clusters trop denses */
      positions[i3]     = (Math.random() - 0.5) * 80;
      positions[i3 + 1] = (Math.random() - 0.5) * 50;
      positions[i3 + 2] = (Math.random() - 0.5) * 60;

      const r = Math.random();
      let color, brightness, size;

      if (r > 0.95) {
        /* 5% — Superstars : ambre, halo fort, grande taille */
        color      = cAmber;
        brightness = 1.5 + Math.random();
        size       = 3.0 + Math.random() * 2.0;
      } else if (r > 0.80) {
        /* 15% — Bons projets : émeraude, luminosité intermédiaire */
        color      = cEmerald;
        brightness = 0.8 + Math.random() * 0.5;
        size       = 2.0 + Math.random();
      } else {
        /* 80% — Masse : violet ou bleu, très discrets */
        color      = Math.random() > 0.5 ? cViolet : cBlue;
        brightness = 0.2 + Math.random() * 0.3;
        size       = 0.8 + Math.random();
      }

      colors[i3]     = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;

      sizes[i]       = size;
      phases[i]      = Math.random() * Math.PI * 2; /* déphasage aléatoire */
      brightnesses[i] = brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',   new THREE.BufferAttribute(positions,    3));
    geometry.setAttribute('color',      new THREE.BufferAttribute(colors,       3));
    geometry.setAttribute('size',       new THREE.BufferAttribute(sizes,        1));
    geometry.setAttribute('phase',      new THREE.BufferAttribute(phases,       1));
    geometry.setAttribute('brightness', new THREE.BufferAttribute(brightnesses, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms:      { uTime: { value: 0 } },
      transparent:   true,
      blending:      THREE.AdditiveBlending,
      depthWrite:    false,
      vertexColors:  true,
    });

    this.particles = new THREE.Points(geometry, this.material);
    this.particles.rotation.x = -0.15; /* Inclinaison initiale façon plan galactique */
    this.scene.add(this.particles);
  }

  /* ── Synchronisation taille renderer / caméra ───────────────────────── */
  #syncSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false); /* false = pas de style CSS forcé */
  }

  /* ── Frame — appelée ~60 fps ─────────────────────────────────────────── */
  #frame() {
    const t = this.clock.getElapsedTime();

    /* Scintillement : uniforme passé au GPU, zéro calcul CPU par particule */
    this.material.uniforms.uTime.value = t * 0.5;

    /* Rotation lente et majestueuse de la galaxie */
    this.particles.rotation.y = t * 0.018;

    /* Parallaxe souris — lerp smooth (facteur 0.05) */
    this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.05;
    this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.05;
    this.camera.position.x =  this.mouse.x * 2.0;
    this.camera.position.y = -this.mouse.y * 2.0;
    this.camera.lookAt(this.scene.position);

    this.renderer.render(this.scene, this.camera);
  }

  /* ── Nettoyage propre (SPA navigation, tests) ────────────────────────── */
  destroy() {
    window.removeEventListener('mousemove',        this._onMouseMove);
    window.removeEventListener('deviceorientation', this._onOrient);
    window.removeEventListener('resize',           this._onResize);
    cancelAnimationFrame(this.rafId);
    this.particles?.geometry.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
    document.documentElement.classList.remove('has-three-bg');
  }
}
