/**
 * Flaynn — landing (vanilla, pas d'innerHTML pour données dynamiques)
 */

const MORPH_PHRASES = [
  'avant la diligence.',
  'avec des données.',
  'sans storytelling creux.'
];

function initMorph(el) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = 0;
  window.setInterval(() => {
    i = (i + 1) % MORPH_PHRASES.length;
    el.textContent = MORPH_PHRASES[i];
  }, 4000);
}

function initScoreCounter(el) {
  const raw = el.dataset?.score ?? el.textContent.trim();
  const target = Number.parseInt(raw, 10);
  if (Number.isNaN(target)) return;
  let n = 0;
  const step = () => {
    n = Math.min(target, n + Math.max(1, Math.ceil((target - n) / 10)));
    el.textContent = String(n);
    if (n < target) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const focusable = el.querySelector('input, button, select, textarea');
  if (focusable) window.setTimeout(() => focusable.focus(), 400);
}

function showToast(root, message, variant) {
  if (!root) return;
  const t = document.createElement('div');
  t.className = `toast toast--${variant}`;
  t.setAttribute('role', 'alert');
  t.textContent = message;
  root.appendChild(t);
  window.requestAnimationFrame(() => {
    t.classList.add('is-visible');
  });
  window.setTimeout(() => {
    t.classList.remove('is-visible');
    window.setTimeout(() => t.remove(), 300);
  }, 4200);
}

function buildSuccessView(reference) {
  const wrap = document.createElement('div');
  wrap.className = 'form-success-inner';

  const icon = document.createElement('div');
  icon.className = 'form-success__icon';
  icon.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--accent-emerald)');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', 'M5 13l4 4L19 7');
  svg.appendChild(path);
  icon.appendChild(svg);

  const title = document.createElement('h3');
  title.className = 'form-success__title';
  title.textContent = 'Scoring enregistré';

  const text = document.createElement('p');
  text.className = 'form-success__text';
  text.textContent =
    'Nous analysons votre dossier. Vous recevrez une synthèse sous 24h ouvrées à l’adresse indiquée.';

  const ref = document.createElement('p');
  ref.className = 'form-success__ref';
  ref.textContent = `Référence : ${reference}`;

  const cta = document.createElement('a');
  cta.className = 'btn-primary btn-inline form-success__cta';
  cta.href = `/dashboard/?id=${encodeURIComponent(reference)}`;
  cta.textContent = 'Ouvrir mon espace membre';

  wrap.appendChild(icon);
  wrap.appendChild(title);
  wrap.appendChild(text);
  wrap.appendChild(ref);
  wrap.appendChild(cta);
  return wrap;
}

class ScoringFormController {
  constructor(form) {
    this.form = form;
    this.currentStep = 1;
    this.totalSteps = 3;
    this.toastRoot = document.getElementById('toast-root');
    this.successEl = document.getElementById('form-success');
    this.progressFill = document.getElementById('progress-fill');
    this.stepLabel = document.getElementById('step-current');
    this.#bind();
    this.#initChips();
    this.#updateProgress();
    this.#updateStepButtons();
  }

  #bind() {
    this.form.querySelectorAll('.field__input').forEach((input) => {
      input.addEventListener('input', () => this.#validateField(input, false));
      input.addEventListener('blur', () => this.#validateField(input, true));
    });

    this.form.querySelector('#stage')?.addEventListener('input', () => {
      const h = this.form.querySelector('#stage');
      if (h) this.#validateField(h, false);
    });

    this.form.querySelector('#sector')?.addEventListener('change', () => {
      const s = this.form.querySelector('#sector');
      if (s) this.#validateField(s, false);
    });

    this.form.querySelectorAll('.btn-form--next').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = Number(btn.getAttribute('data-next'), 10);
        if (!this.#validateStep(this.currentStep, true)) return;
        this.#goToStep(next);
      });
    });

    this.form.querySelectorAll('.btn-form--ghost').forEach((btn) => {
      btn.addEventListener('click', () => {
        const back = Number(btn.getAttribute('data-back'), 10);
        this.#goToStep(back);
      });
    });

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#submit();
    });
  }

  #initChips() {
    this.form.querySelectorAll('.field__chips').forEach((group) => {
      group.querySelectorAll('.chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          // Liquid UX: Retour haptique natif sur les boutons tactiles
          if (typeof navigator.vibrate === 'function') {
            navigator.vibrate(15);
          }

          group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', 'false'));
          chip.setAttribute('aria-checked', 'true');
          const hidden = group.parentElement.querySelector('input[type="hidden"][name="stage"]');
          if (hidden) {
            hidden.value = chip.dataset.value || '';
            hidden.dispatchEvent(new Event('input', { bubbles: true }));
          }
          this.#updateStepButtons();
        });
      });
    });
  }

  #validateField(input, showError) {
    const field = input.closest('.field');
    if (!field || !field.dataset.validate) return true;
    if (input.type === 'hidden' && input.id !== 'stage') return true;
    const rules = field.dataset.validate.split('|');
    const value = input.value.trim();
    let error = '';

    for (const rule of rules) {
      if (rule === 'required' && !value) {
        error = 'Ce champ est requis.';
        break;
      }
      if (rule.startsWith('min:') && value.length < Number(rule.split(':')[1])) {
        error = `Minimum ${rule.split(':')[1]} caractères.`;
        break;
      }
      if (rule.startsWith('max:') && value.length > Number(rule.split(':')[1])) {
        error = `Maximum ${rule.split(':')[1]} caractères.`;
        break;
      }
      if (rule === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        error = 'Email invalide.';
        break;
      }
      if (rule === 'urlopt' && value) {
        try {
          new URL(value);
        } catch {
          error = 'URL invalide.';
          break;
        }
      }
      if (rule === 'numopt' && value) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          error = 'Nombre invalide.';
          break;
        }
      }
    }

    field.classList.toggle('field--valid', !error && !!value);
    field.classList.toggle('field--error', !!error && showError);
    const errEl = field.querySelector('.field__error');
    if (errEl) errEl.textContent = showError ? error : '';
    this.#updateStepButtons();
    return !error;
  }

  #validateStep(step, showError) {
    const container = this.form.querySelector(`.form-step[data-step="${step}"]`);
    if (!container) return false;
    let ok = true;
    container.querySelectorAll('.field__input, input[type="hidden"]').forEach((input) => {
      if (input.type === 'hidden' && input.name === 'stage') {
        const field = input.closest('.field');
        if (field && field.dataset.validate?.includes('required') && !input.value.trim()) {
          ok = false;
          if (showError) {
            field.classList.add('field--error');
            const errEl = field.querySelector('.field__error');
            if (errEl) errEl.textContent = 'Sélectionnez un stade.';
          }
        }
        return;
      }
      if (!this.#validateField(input, showError)) ok = false;
    });
    return ok;
  }

  #updateStepButtons() {
    const step = this.form.querySelector(`.form-step[data-step="${this.currentStep}"]`);
    if (!step) return;

    if (this.currentStep === 3) {
      const email = this.form.querySelector('#email');
      const submitBtn = this.form.querySelector('#btn-submit');
      if (email && submitBtn) {
        const ok = this.#validateField(email, false);
        submitBtn.disabled = !ok;
      }
      return;
    }

    const nextBtn = step.querySelector('.btn-form--next');
    if (!nextBtn) return;
    const valid = this.#validateStep(this.currentStep, false);
    nextBtn.disabled = !valid;
  }

  #goToStep(target) {
    if (target < 1 || target > this.totalSteps) return;
    const currentEl = this.form.querySelector(`.form-step[data-step="${this.currentStep}"]`);
    const nextEl = this.form.querySelector(`.form-step[data-step="${target}"]`);
    if (!currentEl || !nextEl) return;

    currentEl.classList.remove('is-active');
    currentEl.hidden = true;
    currentEl.classList.add('is-hidden');

    nextEl.hidden = false;
    nextEl.classList.remove('is-hidden');
    nextEl.classList.add('is-active');

    this.currentStep = target;
    this.#updateProgress();
    this.#updateStepButtons();

    const first = nextEl.querySelector('.field__input, .chip');
    if (first) first.focus();
  }

  #updateProgress() {
    if (this.progressFill) {
      this.progressFill.style.width = `${(this.currentStep / this.totalSteps) * 100}%`;
    }
    if (this.stepLabel) {
      this.stepLabel.textContent = String(this.currentStep);
    }
    const dots = this.form.closest('.scoring-form-wrap')
      ?.querySelectorAll('.progress-dot');
    if (dots) {
      dots.forEach((dot, i) => {
        dot.classList.toggle('progress-dot--active', i < this.currentStep);
      });
    }
  }

  async #submit() {
    if (!this.#validateStep(3, true)) return;

    const btn = this.form.querySelector('#btn-submit');
    const label = btn?.querySelector('.btn-form__text');
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Envoi…';

    const payload = {
      startup_name: this.form.querySelector('#startup-name')?.value.trim() ?? '',
      sector: this.form.querySelector('#sector')?.value ?? '',
      stage: this.form.querySelector('#stage')?.value ?? '',
      pitch: this.form.querySelector('#pitch')?.value.trim() ?? '',
      email: this.form.querySelector('#email')?.value.trim() ?? ''
    };

    const urlVal = this.form.querySelector('#url')?.value.trim() ?? '';
    if (urlVal) payload.url = urlVal;

    const rev = this.form.querySelector('#revenue_monthly')?.value.trim() ?? '';
    if (rev !== '') payload.revenue_monthly = Number(rev);

    const team = this.form.querySelector('#team_size')?.value.trim() ?? '';
    if (team !== '') payload.team_size = Number(team);

    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Flaynn-Source': 'web-form' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000)
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          data.error === 'VALIDATION_FAILED'
            ? 'Vérifiez les champs et réessayez.'
            : 'Service temporairement indisponible.';
        throw new Error(msg);
      }

      const ref = data.reference || '—';
      this.form.classList.add('is-hidden');
      this.form.hidden = true;
      if (this.successEl) {
        this.successEl.replaceChildren();
        this.successEl.appendChild(buildSuccessView(ref));
        this.successEl.hidden = false;
        this.successEl.classList.remove('is-hidden');
        this.successEl.focus();
      }
    } catch (err) {
      showToast(this.toastRoot, err.message || 'Erreur réseau.', 'error');
      if (btn) btn.disabled = false;
      if (label) label.textContent = 'Soumettre';
    }
  }
}

function getDeviceTier() {
  const mem = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 4;
  const conn = navigator.connection;
  const ect = conn?.effectiveType || '4g';
  if (conn?.saveData || ect === '2g' || ect === 'slow-2g') return 1;
  if (mem <= 2 || ect === '3g') return 2;
  return 3;
}

window.__FLAYNN_TIER = getDeviceTier();

async function bootDeferred() {
  const tier = window.__FLAYNN_TIER;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const morphEl = document.querySelector('.js-morph-text');
  const counterEl = document.querySelector('[data-score]');

  if (reduced) {
    if (counterEl) {
      const t = Number.parseInt(counterEl.dataset.score || counterEl.textContent, 10);
      if (!Number.isNaN(t)) {
        counterEl.textContent = String(t);
        const r = t / 100;
        counterEl.style.color =
          r < 0.4 ? 'var(--accent-rose)' : r < 0.7 ? 'var(--accent-amber)' : 'var(--accent-emerald)';
      }
    }
  } else if (tier >= 2) {
    try {
      const { loadGsapBundle, initMorphGsap, initScrollReveal, initGsapScoreCounters } = await import(
        './js/landing-motion.js'
      );
      await loadGsapBundle();
      const gsap = window.gsap;
      if (morphEl) initMorphGsap(gsap, morphEl, MORPH_PHRASES);
      initScrollReveal(gsap);
      initGsapScoreCounters(gsap);
    } catch {
      if (morphEl) initMorph(morphEl);
      if (counterEl) initScoreCounter(counterEl);
    }
  } else if (counterEl) {
    const target = Number.parseInt(counterEl.dataset.score || counterEl.textContent, 10);
    if (!Number.isNaN(target)) {
      counterEl.textContent = String(target);
      const r = target / 100;
      counterEl.style.color =
        r < 0.4 ? 'var(--accent-rose)' : r < 0.7 ? 'var(--accent-amber)' : 'var(--accent-emerald)';
    }
  }

  const debugThree = new URLSearchParams(window.location.search).get('debug_three') === '1';
  /* Three.js : tier 2 = léger (cf. .md), tier 3 = dense */
  if ((tier >= 2 || debugThree) && !reduced) {
    try {
      const { FlaynnNeuralBackground } = await import('./js/three-neural.js');
      const canvas = document.getElementById('bg-canvas');
      if (canvas) {
        const particles = debugThree ? 1200 : tier >= 3 ? 2800 : 600;
        new FlaynnNeuralBackground(canvas, { particles });
      }
    } catch {
      /* WebGL / module indisponible : fond CSS (.ambient-bg) */
    }
  }

  const scoringForm = document.getElementById('scoring-form');
  if (scoringForm) {
    new ScoringFormController(scoringForm);
  }
}

document.getElementById('footer-year').textContent = String(new Date().getFullYear());

document.getElementById('btn-header-cta')?.addEventListener('click', () => scrollToId('scoring'));
document.getElementById('btn-hero-cta')?.addEventListener('click', () => scrollToId('scoring'));
document.getElementById('btn-sticky-cta')?.addEventListener('click', () => scrollToId('scoring'));
document.getElementById('btn-mobile-cta')?.addEventListener('click', () => {
  closeMobileMenu();
  scrollToId('scoring');
});

// ── Nav mobile ──────────────────────────────────────────────────────────────
function openMobileMenu() {
  const btn = document.getElementById('nav-hamburger');
  const menu = document.getElementById('nav-mobile-menu');
  if (!btn || !menu) return;
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  window.requestAnimationFrame(() => menu.removeAttribute('hidden'));
}

function closeMobileMenu() {
  const btn = document.getElementById('nav-hamburger');
  const menu = document.getElementById('nav-mobile-menu');
  if (!btn || !menu) return;
  btn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  menu.hidden = true;
}

document.getElementById('nav-hamburger')?.addEventListener('click', () => {
  const isOpen = document.getElementById('nav-hamburger')?.getAttribute('aria-expanded') === 'true';
  if (isOpen) closeMobileMenu();
  else openMobileMenu();
});

document.getElementById('nav-mobile-menu')?.querySelectorAll('.nav-mobile-link').forEach((link) => {
  link.addEventListener('click', () => closeMobileMenu());
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMobileMenu();
});

// ── Sticky CTA ──────────────────────────────────────────────────────────────
const stickyCtaEl = document.getElementById('mobile-sticky-cta');
if (stickyCtaEl) {
  stickyCtaEl.removeAttribute('aria-hidden');
  const heroSection = document.querySelector('.hero');
  const formSection = document.getElementById('scoring');
  const observer = new IntersectionObserver(
    () => {
      const heroVisible = heroSection
        ? [...document.querySelectorAll('.hero')].some((el) => {
            const r = el.getBoundingClientRect();
            return r.bottom > 0;
          })
        : false;
      const formVisible = formSection
        ? formSection.getBoundingClientRect().top < window.innerHeight
        : false;
      if (!heroVisible && !formVisible) {
        stickyCtaEl.classList.add('is-visible');
      } else {
        stickyCtaEl.classList.remove('is-visible');
      }
    },
    { threshold: 0 }
  );
  if (heroSection) observer.observe(heroSection);
  if (formSection) observer.observe(formSection);
}

function initLiquidUX() {
  // 1. Glow effect dynamique (Bento Cards & Inputs)
  const applyGlow = () => {
    document.querySelectorAll('.card-glass, .field__input').forEach((el) => {
      if (el.dataset.glowBound) return;
      el.dataset.glowBound = 'true';
      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
      });
    });
  };
  applyGlow();
  // MutationObserver pour appliquer l'effet aux éléments créés dynamiquement
  const observer = new MutationObserver(() => applyGlow());
  observer.observe(document.body, { childList: true, subtree: true });

  // 2. Physique du Mouvement "Spring" globale
  const interactives = 'button, a, .chip, .nav-link, [role="button"]';
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(interactives);
    if (el && !el.disabled) {
      el.style.transform = 'scale(0.96)';
      el.style.transition = 'transform 0.1s cubic-bezier(0.4, 0, 0.2, 1)';
    }
  });
  const resetSpring = (e) => {
    const el = e.target.closest(interactives);
    if (el) {
      el.style.transform = '';
      el.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    }
  };
  document.addEventListener('pointerup', resetSpring);
  document.addEventListener('pointercancel', resetSpring);
  document.addEventListener('pointerout', resetSpring);

  // 3. Retour haptique visuel au clavier (Flash sur la bordure)
  document.addEventListener('input', (e) => {
    if (e.target.matches('.field__input')) {
      e.target.animate([
        { boxShadow: '0 0 0 4px rgba(139, 92, 246, 0.3)' },
        { boxShadow: '0 0 0 0px rgba(139, 92, 246, 0)' }
      ], { duration: 350, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
  });
}

const scheduleIdle = (fn) => {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(fn, { timeout: 2000 });
  } else {
    window.setTimeout(fn, 200);
  }
};
scheduleIdle(() => {
  void bootDeferred();
  initLiquidUX();
});

// PWA: Enregistrement du Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker non enregistré:', err);
    });
  });
}
