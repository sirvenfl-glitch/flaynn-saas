/**
 * Flaynn Starfield — Canvas 2D cinematic background
 *
 * Multi-layer starfield + organic nebula glows. Pure Canvas 2D.
 *
 * - 4 depth layers (dust / far / mid / near) with seeded star placement
 * - Visceral Z-parallax on scroll: near stars zoom 6x faster than dust
 * - Organic nebula glows with slow breathing + inverse mouse tracking
 * - Scroll-velocity warp with inertia (friction asymmetrique)
 * - Warp transition (hyperspace streaks) for navigation
 *
 * Exported class: FlaynnNeuralBackground (same name for drop-in compat)
 * Used by: script.js → bootDeferred() → window.globalBg
 */

/* ── Seeded PRNG (mulberry32) — deterministic starfield across sessions ── */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Star layer definitions ─────────────────────────────────────────────── */
/* ARCHITECT-PRIME: 4 couches avec ecart de speedZ massivement amplifie
   pour une sensation de voyage en profondeur (ratio near/dust = 12x) */
const LAYER_DEFS = [
  // Layer 0 — Cosmic dust (barely moves, creates depth anchor)
  { count: 200, rMin: 0.2, rMax: 0.5, aMin: 0.06, aMax: 0.18,
    twinkleMin: 0.15, twinkleMax: 0.5, speedZ: 0.08, mousePx: 0.003, halos: 0 },
  // Layer 1 — Far stars
  { count: 160, rMin: 0.4, rMax: 0.9, aMin: 0.12, aMax: 0.32,
    twinkleMin: 0.25, twinkleMax: 0.8, speedZ: 0.25, mousePx: 0.010, halos: 0 },
  // Layer 2 — Mid stars
  { count: 90,  rMin: 0.7, rMax: 1.5, aMin: 0.22, aMax: 0.52,
    twinkleMin: 0.4, twinkleMax: 1.2, speedZ: 0.65, mousePx: 0.028, halos: 3 },
  // Layer 3 — Near stars (foreground — zoom hard on scroll)
  { count: 35,  rMin: 1.2, rMax: 2.8, aMin: 0.45, aMax: 0.85,
    twinkleMin: 0.6, twinkleMax: 1.8, speedZ: 1.0, mousePx: 0.050, halos: 6 },
];

function generateLayers(seed) {
  const rand = mulberry32(seed);
  return LAYER_DEFS.map((def) => {
    const stars = [];
    for (let i = 0; i < def.count; i++) {
      stars.push({
        x: rand(),
        y: rand(),
        r: def.rMin + rand() * (def.rMax - def.rMin),
        a: def.aMin + rand() * (def.aMax - def.aMin),
        tw: def.twinkleMin + rand() * (def.twinkleMax - def.twinkleMin),
        tp: rand() * Math.PI * 2,
        halo: i < def.halos,
        // ARCHITECT-PRIME: couleur teintee pour les etoiles de fond (bleu/violet subtle)
        tint: i < def.halos ? (rand() > 0.5 ? 1 : 2) : 0, // 0=white, 1=violet-tint, 2=warm-tint
      });
    }
    return { stars, speedZ: def.speedZ, mousePx: def.mousePx };
  });
}

/* ── Main class ─────────────────────────────────────────────────────────── */

export class FlaynnNeuralBackground {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ particles?: number }} [_config] — kept for API compat, ignored
   */
  constructor(canvas, _config) {
    void _config;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.classList.add('three-canvas--fallback');
      return;
    }

    this.canvas = canvas;
    this.ctx = ctx;
    this.w = 0;
    this.h = 0;
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.time = 0;
    this.rafId = 0;
    this._transitioning = false;
    this.warpProgress = 0;
    this.scrollProgress = 0;
    this._gsapConnected = false;

    // Scroll velocity + inertie
    this.scrollVelocity = 0;
    this._lastScrollY = 0;
    this._scrollWarp = 0;

    // Mouse (lerped — heavy inertia for cinematic feel)
    this.mx = 0;
    this.my = 0;
    this._mtx = 0;
    this._mty = 0;

    // Stars
    this.layers = generateLayers(7734991);

    // ── Events ──
    this._onMM = (e) => {
      this._mtx = (e.clientX / window.innerWidth - 0.5) * 2;
      this._mty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    this._onOr = (e) => {
      if (e.gamma == null) return;
      this._mtx = (e.gamma / 45) * 2;
      this._mty = ((e.beta - 45) / 45) * 2;
    };
    this._onScroll = () => {
      const top = window.scrollY;
      const delta = Math.abs(top - this._lastScrollY);
      this._lastScrollY = top;
      this.scrollVelocity = Math.min(delta / 10, 1);

      if (this._gsapConnected) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      this.scrollProgress = max > 0 ? Math.min(top / max, 1) : 0;
    };
    this._onResize = () => this._syncSize();

    window.addEventListener('mousemove', this._onMM, { passive: true });
    window.addEventListener('deviceorientation', this._onOr, { passive: true });
    window.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onResize, { passive: true });

    this._syncSize();
    document.documentElement.classList.add('has-three-bg');

    // ── GSAP ScrollTrigger (async — may load after us) ──
    this._tryGsap();

    // ── Reduced motion: single frame then stop ──
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this._frame(0);
      return;
    }

    // ── Render loop ──
    let prev = performance.now();
    const loop = (now) => {
      this.rafId = requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min((now - prev) / 1000, 0.1);
      prev = now;
      this.time += dt;
      this._frame(dt);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /* ── Resize ──────────────────────────────────────────────────────────── */

  _syncSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.w = w;
    this.h = h;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /* ── GSAP ScrollTrigger integration ──────────────────────────────────── */

  _tryGsap() {
    const connect = () => {
      const gsap = window.gsap;
      const ST = window.ScrollTrigger;
      if (!gsap || !ST) return false;
      gsap.registerPlugin(ST);
      gsap.to(this, {
        scrollProgress: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: document.documentElement,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1.2,
        },
      });
      this._gsapConnected = true;
      return true;
    };
    if (connect()) return;
    let tries = 0;
    const id = setInterval(() => {
      if (connect() || ++tries > 16) clearInterval(id);
    }, 500);
  }

  /* ── Render pipeline ─────────────────────────────────────────────────── */

  _frame(dt) {
    const { ctx, w, h } = this;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    // ARCHITECT-PRIME: Mouse lerp — slow (1.5/s) pour inertie cinematique lourde
    const lr = Math.min(dt * 1.5, 1) || 0.03;
    this.mx += (this._mtx - this.mx) * lr;
    this.my += (this._mty - this.my) * lr;

    // Scroll warp avec friction (inertie luxueuse)
    const targetWarp = this.scrollVelocity;
    const friction = targetWarp > this._scrollWarp ? 0.10 : 0.03;
    this._scrollWarp += (targetWarp - this._scrollWarp) * Math.min(dt * (1 / friction), 1);
    if (this._scrollWarp < 0.001) this._scrollWarp = 0;
    this.scrollVelocity *= Math.max(1 - dt * 2.8, 0);

    const scroll = this.scrollProgress;
    const warp = this.warpProgress;
    const scrollWarp = this._scrollWarp;

    this._drawNebulas(ctx, w, h, scroll, warp, scrollWarp);
    this._drawStars(ctx, w, h, scroll, warp, scrollWarp);

    // Warp white-out veil (last 30% of transition)
    if (warp > 0.7) {
      const veil = (warp - 0.7) / 0.3;
      ctx.globalAlpha = veil * veil * 0.95;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  /* ── Nebula glows ────────────────────────────────────────────────────── */

  _drawNebulas(ctx, w, h, scroll, warp, scrollWarp) {
    const t = this.time;
    const mx = this.mx;
    const my = this.my;
    const dim = Math.max(w, h);
    const sw = scrollWarp * 0.25;

    // ARCHITECT-PRIME: oscillateurs lents, dephasés, amplitudes profondes
    const b1 = Math.sin(t * 0.08) * 0.5 + 0.5;             // ~12.5s cycle
    const b2 = Math.sin(t * 0.06 + 2.1) * 0.5 + 0.5;       // ~16.7s cycle
    const b3 = Math.sin(t * 0.10 + 4.0) * 0.5 + 0.5;       // ~10s cycle
    const b4 = Math.sin(t * 0.045 + 0.8) * 0.5 + 0.5;      // ~22s ultra-lent

    // ARCHITECT-PRIME: les nebulas se deplacent avec le scroll (parallax propre)
    const scrollShift = scroll * h * 0.15;

    // 1 — Violet principal (bottom-left, large, dominant)
    const vx = w * 0.12 - mx * 50 + b4 * w * 0.03;
    const vy = h * 0.78 + my * 40 - scrollShift * 0.5;
    const vr = dim * (0.60 + b1 * 0.10 + warp * 0.40 + sw * 1.5);
    const va = 0.16 + b1 * 0.07 + warp * 0.20 + sw * 0.4;
    const gv = ctx.createRadialGradient(vx, vy, 0, vx, vy, vr);
    gv.addColorStop(0, `rgba(123,45,142,${va})`);
    gv.addColorStop(0.35, `rgba(123,45,142,${va * 0.40})`);
    gv.addColorStop(0.65, `rgba(123,45,142,${va * 0.10})`);
    gv.addColorStop(1, 'rgba(123,45,142,0)');
    ctx.fillStyle = gv;
    ctx.fillRect(0, 0, w, h);

    // 2 — Orange chaud (top-right, medium)
    const ox = w * 0.88 + mx * 40 - b4 * w * 0.02;
    const oy = h * 0.10 - my * 35 - scrollShift * 0.3;
    const or2 = dim * (0.48 + b2 * 0.08 + warp * 0.30 + sw);
    const oa = 0.09 + b2 * 0.05 + warp * 0.15 + sw * 0.3;
    const go = ctx.createRadialGradient(ox, oy, 0, ox, oy, or2);
    go.addColorStop(0, `rgba(232,101,26,${oa})`);
    go.addColorStop(0.40, `rgba(232,101,26,${oa * 0.30})`);
    go.addColorStop(0.70, `rgba(232,101,26,${oa * 0.06})`);
    go.addColorStop(1, 'rgba(232,101,26,0)');
    ctx.fillStyle = go;
    ctx.fillRect(0, 0, w, h);

    // 3 — Rose profond (center, tres subtil — couche de profondeur)
    const rx = w * 0.48 - mx * 25 + b3 * w * 0.02;
    const ry = h * 0.60 + my * 20 - scrollShift * 0.4;
    const rr = dim * (0.42 + b3 * 0.06 + warp * 0.25);
    const ra = 0.05 + b3 * 0.03 + warp * 0.10;
    const gr = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
    gr.addColorStop(0, `rgba(193,53,132,${ra})`);
    gr.addColorStop(0.50, `rgba(193,53,132,${ra * 0.20})`);
    gr.addColorStop(1, 'rgba(193,53,132,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);

    // 4 — Bleu froid (bottom-right, nouveau — contre-point froid)
    const bx = w * 0.75 + mx * 20;
    const by = h * 0.85 - my * 15 - scrollShift * 0.2;
    const br = dim * (0.30 + b4 * 0.05);
    const ba = 0.03 + b4 * 0.02;
    const gb = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    gb.addColorStop(0, `rgba(59,130,246,${ba})`);
    gb.addColorStop(0.50, `rgba(59,130,246,${ba * 0.15})`);
    gb.addColorStop(1, 'rgba(59,130,246,0)');
    ctx.fillStyle = gb;
    ctx.fillRect(0, 0, w, h);
  }

  /* ── Starfield ───────────────────────────────────────────────────────── */

  _drawStars(ctx, w, h, scroll, warp, scrollWarp) {
    const t = this.time;
    const mx = this.mx;
    const my = this.my;
    const cx = w * 0.5;
    const cy = h * 0.5;

    for (const layer of this.layers) {
      const { stars, speedZ, mousePx } = layer;

      // ARCHITECT-PRIME: Z-parallax massivement amplifie
      // Dust (speedZ 0.08) → +8% zoom total
      // Near (speedZ 1.0)  → +100% zoom total (2x scale at bottom)
      const zScale = 1 + scroll * speedZ;
      // Warp: explosive zoom
      const wScale = 1 + warp * warp * speedZ * 18;
      // Scroll velocity warp (inertie)
      const sWarpScale = 1 + scrollWarp * speedZ * 2.5;
      const totalScale = zScale * wScale * sWarpScale;

      // ARCHITECT-PRIME: Mouse parallax amplifie (facteur 2.5x)
      const px = -mx * mousePx * w * 2.5;
      const py = -my * mousePx * h * 2.5;

      // Vertical drift on scroll (near layers drift more dramatically)
      const yDrift = -scroll * speedZ * h * 0.08;

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];

        // Position: expand from center
        let sx = (s.x * w - cx) * totalScale + cx + px;
        let sy = (s.y * h - cy) * totalScale + cy + py + yDrift;

        // Wrap during normal scroll (not during warp — let them fly out)
        if (warp < 0.05 && scrollWarp < 0.3) {
          sx = ((sx % w) + w) % w;
          sy = ((sy % h) + h) % h;
        }

        // ARCHITECT-PRIME: Twinkle amplifie — oscillation 0.5 ± 0.5 (variation totale)
        const twinkle = 0.5 + 0.5 * Math.sin(t * s.tw + s.tp);

        // Radius + alpha
        let r = s.r * totalScale;
        let alpha = s.a * twinkle;

        // Warp intensity + scroll warp glow
        alpha = Math.min(alpha + warp * 0.5 + scrollWarp * 0.20, 1);
        r = Math.min(r + warp * speedZ * 5 + scrollWarp * speedZ * 1.2, 12);

        if (r < 0.1 || alpha < 0.01) continue;

        // Warp streak direction (from center outward)
        const dx = sx - cx;
        const dy = sy - cy;
        const warpStretch = warp * warp * speedZ * 4;

        ctx.globalAlpha = alpha;

        if (warpStretch > 0.08) {
          // ── Hyperspace streaks ──
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const ndx = dx / dist;
          const ndy = dy / dist;
          const len = warpStretch * 24 * (0.5 + r);

          ctx.beginPath();
          ctx.moveTo(sx - ndx * len * 0.3, sy - ndy * len * 0.3);
          ctx.lineTo(sx + ndx * len, sy + ndy * len);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(r * 0.7, 0.5);
          ctx.lineCap = 'round';
          ctx.stroke();
        } else {
          // ── Halo stars (tinted) ──
          if (s.halo) {
            const hr = r * 6;
            const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, hr);
            // ARCHITECT-PRIME: teinte subtile violet ou chaude sur les halos
            const hCol = s.tint === 1
              ? `180,130,255`   // violet pale
              : s.tint === 2
                ? `255,200,150` // chaud pale
                : `255,255,255`;
            hg.addColorStop(0, `rgba(${hCol},${alpha * 0.7})`);
            hg.addColorStop(0.10, `rgba(${hCol},${alpha * 0.15})`);
            hg.addColorStop(0.30, `rgba(${hCol},${alpha * 0.04})`);
            hg.addColorStop(1, `rgba(${hCol},0)`);
            ctx.fillStyle = hg;
            ctx.beginPath();
            ctx.arc(sx, sy, hr, 0, Math.PI * 2);
            ctx.fill();
          }

          // ── Core dot ──
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
        }
      }
    }

    ctx.globalAlpha = 1;
  }

  /* ── Warp transition (same API as old Three.js version) ──────────────── */

  /**
   * @param {string} targetUrl
   * @param {number} [duration=0.85]
   */
  triggerWarpTransition(targetUrl, duration = 0.85) {
    if (this._transitioning) return;
    this._transitioning = true;

    const onComplete = () => {
      window.location.href = targetUrl;
    };

    if (typeof window.gsap !== 'undefined') {
      window.gsap.to(this, {
        warpProgress: 1,
        duration,
        ease: 'power3.in',
        onComplete,
      });
      return;
    }

    // RAF fallback
    const start = performance.now();
    const ms = duration * 1000;
    const tick = (now) => {
      const raw = Math.min((now - start) / ms, 1);
      this.warpProgress = raw * raw * raw;
      if (raw < 1) {
        requestAnimationFrame(tick);
      } else {
        onComplete();
      }
    };
    requestAnimationFrame(tick);
  }

  /* ── Cleanup ─────────────────────────────────────────────────────────── */

  destroy() {
    window.removeEventListener('mousemove', this._onMM);
    window.removeEventListener('deviceorientation', this._onOr);
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
    cancelAnimationFrame(this.rafId);
    document.documentElement.classList.remove('has-three-bg');
  }
}
